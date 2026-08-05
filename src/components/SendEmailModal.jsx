import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fyjgtwupzpeivdedoutj.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || ''

const C = { accent: '#0093DB', text: '#1F2937', muted: '#6B7280', border: '#E5E7EB', green: '#3d7a00', greenSoft: '#F0FAE0', red: '#DC2626', redSoft: '#FEE2E2' }

// Fill {{variable}} placeholders with real values. Any placeholder left
// with no matching variable is removed (not left as literal {{x}}).
function fillTemplate(text, vars) {
  if (!text) return text
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const v = vars[key]
    return (v === undefined || v === null || v === '') ? '' : String(v)
  })
}

function cleanSubject(s) {
  return (s || '').replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/\u00a3/g, 'GBP').trim()
}

export default function SendEmailModal({
  onClose, onSent,
  to = '', subject = '', body = '',
  variables = {},              // e.g. { name, inspection_name, property_address }
  buildAttachment = null,      // optional: () => { base64, filename, mime } | Promise<...>
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
  const [attachmentInfo, setAttachmentInfo] = useState(null) // { filename } once built
  const [buildingAttachment, setBuildingAttachment] = useState(!!buildAttachment)

  useEffect(() => {
    supabase.from('user_email_accounts')
      .select('id, gmail_address, display_name, account_type')
      .eq('is_active', true)
      .order('account_type')
      .then(({ data }) => {
        setAccounts(data || [])
        const personal = (data || []).find(a => a.account_type === 'personal')
        const preferred = preferPersonal ? personal : null
        if (preferred) setAccountId(preferred.id)
        else if (data?.length) setAccountId(data[0].id)
      })

    supabase.from('email_templates').select('id, name, subject, body').then(({ data }) => setTemplates(data || []))
  }, [])

  // Pre-build the attachment as soon as the modal opens, so the user
  // sees a clear error immediately if PDF generation fails — instead
  // of finding out only after clicking Send.
  useEffect(() => {
    if (!buildAttachment) { setBuildingAttachment(false); return }
    let cancelled = false
    setBuildingAttachment(true)
    Promise.resolve()
      .then(buildAttachment)
      .then(result => {
        if (cancelled) return
        if (!result || !result.base64) throw new Error('Attachment builder returned no data')
        setAttachmentInfo(result)
        setBuildingAttachment(false)
      })
      .catch(err => {
        if (cancelled) return
        console.error('Attachment build failed:', err)
        setError('Could not generate attachment: ' + err.message)
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
    if (buildAttachment && buildingAttachment) { setError('Attachment is still being prepared, please wait a moment.'); return }
    if (buildAttachment && !attachmentInfo) { setError('Attachment failed to generate. Fix the error above before sending, or remove the attachment requirement.'); return }

    setSending(true)

    const payload = {
      account_id: accountId,
      to: toAddr,
      subject: cleanSubject(subjectVal),
      message: bodyVal,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }
    if (attachmentInfo) {
      payload.attachment_base64 = attachmentInfo.base64
      payload.attachment_name = attachmentInfo.filename
      payload.attachment_mime = attachmentInfo.mime || 'application/pdf'
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30s safety timeout

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Supabase's API gateway requires the apikey header to route
          // the request to the function at all, even with JWT verification
          // disabled on the function itself. Without it the request never
          // reaches our code and the browser reports a generic network
          // failure ("Failed to fetch") with no useful status code.
          ...(SUPABASE_ANON_KEY ? { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      let data
      try {
        data = await res.json()
      } catch {
        throw new Error(`Server returned an unreadable response (HTTP ${res.status}). The email may not have been sent — check Cold Inbox / Email Inbox to confirm.`)
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Send failed (HTTP ${res.status})`)
      }

      // Success — log it, then close
      await supabase.from('email_log').insert({
        to_email: toAddr,
        subject: payload.subject,
        body: bodyVal,
        sent_by: profile?.id,
        sent_at: new Date().toISOString(),
        status: 'sent',
        has_attachment: !!attachmentInfo,
      }).catch(() => {})

      setSending(false)
      onSent?.()
      onClose?.()

    } catch (err) {
      clearTimeout(timeoutId)
      setSending(false)
      if (err.name === 'AbortError') {
        setError('The request timed out after 30 seconds. This usually means the email server is slow to respond — check Cold Inbox / Email Inbox before retrying, the email may have still sent.')
      } else if (err.message === 'Failed to fetch') {
        setError('Could not reach the server (network error). If this keeps happening, the connected Gmail account may need to be reconnected in Email Inbox.')
      } else {
        setError(err.message || 'Something went wrong sending the email.')
      }
    }
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
          {buildAttachment && (
            <div style={{
              background: buildingAttachment ? '#F5F7FA' : attachmentInfo ? C.greenSoft : C.redSoft,
              border: `1px solid ${buildingAttachment ? C.border : attachmentInfo ? '#80D10066' : '#DC262644'}`,
              borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10
            }}>
              <span style={{ fontSize: 20 }}>{buildingAttachment ? '⏳' : attachmentInfo ? '📎' : '⚠'}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: buildingAttachment ? C.muted : attachmentInfo ? C.green : C.red }}>
                  {buildingAttachment ? 'Generating attachment...' : attachmentInfo ? attachmentInfo.filename : 'Attachment failed'}
                </div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  {buildingAttachment ? 'Please wait' : attachmentInfo ? 'Will be attached to this email' : 'Fix the error below or contact support'}
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
            <button onClick={send} disabled={sending || !accountId || buildingAttachment}
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
