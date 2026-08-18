import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
// Never put the client *secret* in a VITE_ var -- it gets bundled into the
// shipped JS. gmail-reply reads it from Supabase's server-side secrets.

const C = { accent: '#0093DB', text: '#1F2937', muted: '#6B7280', border: '#E5E7EB', green: '#3d7a00', greenSoft: '#F0FAE0', red: '#DC2626', redSoft: '#FEE2E2' }

// Fill {{variable}} placeholders with real values. Any placeholder left
// with no matching variable is removed (not left as literal {{x}}).
// Also swaps the literal "Good Morning/Afternoon" text for a real
// time-of-day greeting, since templates use that as a placeholder too.
function fillTemplate(text, vars) {
  if (!text) return text
  let result = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const v = vars[key]
    return (v === undefined || v === null || v === '') ? '' : String(v)
  })
  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening'
  result = result.replace(/Good Morning\/Afternoon/g, greeting)
  return result
}

function cleanSubject(s) {
  return (s || '').replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/\u00a3/g, 'GBP').trim()
}

export default function SendEmailModal({
  onClose, onSent,
  to = '', subject = '', body = '',
  variables = {},              // e.g. { name, inspection_name, property_address }
  buildAttachment = null,      // optional: () => { base64, filename, mime } | Promise<...>
  buildAttachments = null,     // optional: () => [{ base64, filename, mime }] | Promise<...>
  title = 'Send Email',
  preferPersonal = true,       // default to the main business inbox, not cold accounts
}) {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [templates, setTemplates] = useState([])
  const [toAddr, setToAddr] = useState(to)
  const [subjectVal, setSubjectVal] = useState(fillTemplate(subject, variables))
  const [bodyVal, setBodyVal] = useState(fillTemplate(body, variables))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [attachmentInfo, setAttachmentInfo] = useState([]) // [{ filename }] once built
  const [buildingAttachment, setBuildingAttachment] = useState(!!(buildAttachment || buildAttachments))

  useEffect(() => {
    supabase.from('user_email_accounts')
      .select('id, gmail_address, display_name, account_type, token_expiry')
      .eq('is_active', true)
      .order('account_type')
      .then(({ data }) => {
        setAccounts(data || [])
        // Prefer the personal account if its token is still valid. If it's
        // expired, fall back to any account with a valid token rather than
        // silently picking an account that will fail to send — a personal
        // account with a lapsed refresh needs reconnecting in Email Inbox,
        // but that shouldn't block sending from a working cold account.
        const now = new Date()
        const hasValidToken = a => a.token_expiry && new Date(a.token_expiry) > now
        const personal = (data || []).find(a => a.account_type === 'personal' && hasValidToken(a))
        const anyValid = (data || []).find(hasValidToken)
        const preferred = preferPersonal ? personal : null
        if (preferred) setAccountId(preferred.id)
        else if (anyValid) setAccountId(anyValid.id)
        else if (data?.length) setAccountId(data[0].id)
      })

    supabase.from('email_templates').select('id, name, subject, body').then(({ data }) => setTemplates(data || []))
  }, [])

  // Pre-build the attachment(s) as soon as the modal opens, so the user
  // sees a clear error immediately if PDF generation fails — instead
  // of finding out only after clicking Send.
  useEffect(() => {
    const builder = buildAttachments || (buildAttachment ? async () => {
      const r = await buildAttachment()
      return [r]
    } : null)

    if (!builder) { setBuildingAttachment(false); return }
    let cancelled = false
    setBuildingAttachment(true)
    Promise.resolve()
      .then(builder)
      .then(results => {
        if (cancelled) return
        const valid = (Array.isArray(results) ? results : [results]).filter(r => r?.base64)
        if (valid.length === 0) throw new Error('No attachment data returned')
        setAttachmentInfo(valid)
        setBuildingAttachment(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('Attachment build failed:', err)
        setError('Could not prepare attachment: ' + err.message)
        setBuildingAttachment(false)
      })
    return () => { cancelled = true }
  }, [])

  function applyTemplate(t) {
    if (!t) return
    setSubjectVal(fillTemplate(t.subject, variables))
    setBodyVal(fillTemplate(t.body, variables))
  }

  async function send() {
    setError('')
    if (!toAddr || !subjectVal || !bodyVal) { setError('To, Subject and Message are required'); return }
    if (!accountId) { setError('No Gmail account connected. Connect one in Email Inbox first.'); return }
    const hasAttachmentBuilder = buildAttachment || buildAttachments
    if (hasAttachmentBuilder && buildingAttachment) { setError('Attachment is still being prepared, please wait a moment.'); return }
    if (hasAttachmentBuilder && attachmentInfo.length === 0) { setError('Attachment failed to generate. Fix the error above before sending, or remove the attachment requirement.'); return }

    setSending(true)

    const payload = {
      account_id: accountId,
      to: toAddr,
      subject: cleanSubject(subjectVal),
      message: bodyVal,
      client_id: CLIENT_ID,
      // Always an array — gmail-reply handles both single and multiple
      attachments: attachmentInfo.map(a => ({
        base64: a.base64,
        name: a.filename || a.name,
        mime: a.mime || 'application/pdf',
      })),
    }

    try {
      const { data, error: fnError } = await supabase.functions.invoke('gmail-reply', {
        body: payload,
      })

      // supabase.functions.invoke returns { data, error }.
      // "error" is set if HTTP status >= 400 OR if the response
      // couldn't be read at all (network failure, CORS block, etc).
      // But even with an error, the email may have already been sent
      // server-side — the error could be from the logging insert
      // that runs AFTER the Gmail API call succeeds.
      if (fnError) {
        // Check if we can read the actual server response
        let serverSaid = ''
        try {
          if (fnError.context && typeof fnError.context.json === 'function') {
            const errBody = await fnError.context.json()
            serverSaid = errBody?.error || ''
            // If server returned { ok: true } but with a non-200 status
            // (shouldn't happen, but defensive), treat it as success
            if (errBody?.ok && errBody?.message_id) {
              console.log('Email sent despite error flag — message_id:', errBody.message_id)
              // Fall through to success path below
              await logAndClose()
              return
            }
          }
        } catch { /* couldn't parse response body */ }
        throw new Error(serverSaid || fnError.message || 'Send failed')
      }

      // data might be a string (if content-type wasn't application/json)
      // or an object. Handle both.
      const result = typeof data === 'string' ? JSON.parse(data) : data
      if (!result?.ok) {
        throw new Error(result?.error || 'Send failed — no confirmation from server')
      }

      await logAndClose()

    } catch (err) {
      setSending(false)
      const msg = err.message || 'Something went wrong'
      // If the error is clearly a post-send issue, soften the message
      if (msg.includes('email_log') || msg.includes('column') || msg.includes('relation')) {
        // Email was sent but logging failed — still a success from the user's perspective
        setSending(false)
        onSent?.()
        onClose?.()
        return
      }
      setError(msg)
    }
  }

  async function logAndClose() {
    try {
      await supabase.from('email_log').insert({
        to_email: toAddr,
        subject: cleanSubject(subjectVal),
        body: bodyVal,
        sent_by: profile?.id,
        sent_at: new Date().toISOString(),
        status: 'sent',
      })
    } catch (e) {
      console.log('Email log insert failed (non-critical):', e)
    }
    setSending(false)
    onSent?.()
    onClose?.()
  }

  const lbl = { color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }
  const inp = { width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>✉ {title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={lbl}>From</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={inp}>
              <option value="">-- Select sending account --</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.gmail_address} ({a.account_type === 'personal' ? 'Main Inbox' : 'Cold Email'})
                </option>
              ))}
            </select>
          </div>

          {templates.length > 0 && (
            <div>
              <label style={lbl}>Use Template</label>
              <select onChange={e => applyTemplate(templates.find(t => t.id === e.target.value))} defaultValue="" style={{ ...inp, color: C.muted }}>
                <option value="">-- Select a template (optional) --</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label style={lbl}>To</label>
            <input value={toAddr} onChange={e => setToAddr(e.target.value)} style={inp} placeholder="recipient@email.com" />
          </div>

          <div>
            <label style={lbl}>Subject</label>
            <input value={subjectVal} onChange={e => setSubjectVal(e.target.value)} style={inp} />
          </div>

          {/* Attachment status */}
          {(buildAttachment || buildAttachments) && (
            <div style={{
              background: buildingAttachment ? '#F5F7FA' : attachmentInfo.length > 0 ? C.greenSoft : C.redSoft,
              border: `1px solid ${buildingAttachment ? C.border : attachmentInfo.length > 0 ? '#80D10066' : '#DC262644'}`,
              borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 10
            }}>
              <span style={{ fontSize: 20 }}>{buildingAttachment ? '⏳' : attachmentInfo.length > 0 ? '📎' : '⚠'}</span>
              <div style={{ flex: 1 }}>
                {buildingAttachment ? (
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.muted }}>Generating attachment...</div>
                ) : attachmentInfo.length > 0 ? (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.green, marginBottom: 4 }}>
                      📎 {attachmentInfo.length} attachment{attachmentInfo.length > 1 ? 's' : ''}
                    </div>
                    {attachmentInfo.map((a, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.muted }}>{a.filename || a.name}</div>
                    ))}
                  </>
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 13, color: C.red }}>Attachment failed</div>
                )}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  {buildingAttachment ? 'Please wait' : attachmentInfo.length > 0 ? 'Will be attached to this email' : 'Fix the error below or contact support'}
                </div>
              </div>
            </div>
          )}

          <div>
            <label style={lbl}>Message</label>
            <textarea value={bodyVal} onChange={e => setBodyVal(e.target.value)} rows={12}
              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
          </div>

          {error && (
            <div style={{ background: C.redSoft, color: C.red, borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={send} disabled={sending || !accountId || buildingAttachment || ((buildAttachment || buildAttachments) && attachmentInfo.length === 0)}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 28px', fontWeight: 700, fontSize: 14, cursor: 'pointer', flex: 1, opacity: (sending || !accountId || buildingAttachment) ? 0.6 : 1 }}>
              {sending ? '⏳ Sending...' : buildingAttachment ? '⏳ Preparing...' : '📤 Send Email'}
            </button>
            <button onClick={onClose} style={{ background: '#fff', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '11px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
