import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
// Never put the client *secret* in a VITE_ var -- it gets bundled into the
// shipped JS. gmail-reply reads it from Supabase's server-side secrets.

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

// Auto-fill template variables from record context
function fillTemplate(text, ctx) {
  if (!text) return ''
  const now = new Date()
  const vars = {
    name: ctx.name || ctx.clientName || '',
    rep_name: ctx.repName || '',
    property_address: ctx.address || '',
    inspection_name: ctx.services || '',
    last_inspection_date: ctx.lastJobDate || '',
    date: ctx.scheduledDate || now.toLocaleDateString('en-GB'),
    time_window: ctx.timeSlot || '',
    time_slot: ctx.timeSlot || '',
    renewal_date: ctx.renewalDate || '',
    invoice_link: ctx.invoiceLink || '',
    certificate_holder: ctx.name || '',
  }
  let result = text
  Object.entries(vars).forEach(([k, v]) => {
    result = result.replaceAll(`{{${k}}}`, v || `[${k.toUpperCase().replace(/_/g, ' ')}]`)
  })
  return result
}

export default function EmailCompose({ onClose, context = {} }) {
  // context: { leadId, clientId, jobId, toEmail, toName, name, address, services, repName, scheduledDate, timeSlot, renewalDate, lastJobDate }
  const { profile } = useAuth()

  const [templates, setTemplates]   = useState([])
  const [inboxes, setInboxes]       = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [selectedInbox, setSelectedInbox]       = useState('')
  const [to, setTo]         = useState(context.toEmail || '')
  const [subject, setSubject] = useState('')
  const [body, setBody]     = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]     = useState(false)
  const [error, setError]   = useState('')
  const [minimised, setMinimised] = useState(false)

  useEffect(() => {
    fetchTemplates()
    fetchInboxes()
  }, [])

  async function fetchTemplates() {
    const { data } = await supabase.from('email_templates').select('*').order('sort_order')
    setTemplates(data || [])
  }

  async function fetchInboxes() {
    const { data } = await supabase.from('user_email_accounts')
      .select('id, gmail_address, display_name, account_type, token_expiry')
      .eq('is_active', true)
      .order('account_type')
    setInboxes(data || [])
    const now = new Date()
    const hasValidToken = a => a.token_expiry && new Date(a.token_expiry) > now
    const personal = (data || []).find(a => a.account_type === 'personal' && hasValidToken(a))
    const anyValid = (data || []).find(hasValidToken)
    if (personal) setSelectedInbox(personal.id)
    else if (anyValid) setSelectedInbox(anyValid.id)
    else if (data?.length) setSelectedInbox(data[0].id)
  }

  function applyTemplate(templateId) {
    const tmpl = templates.find(t => t.id === templateId)
    if (!tmpl) return
    setSelectedTemplate(templateId)
    setSubject(fillTemplate(tmpl.subject, context))
    setBody(fillTemplate(tmpl.body, context))
  }

  async function sendEmail() {
    if (!to || !subject || !body) { setError('To, subject and body are all required'); return }
    if (!selectedInbox) { setError('No Gmail account connected. Connect one in Email Inbox first.'); return }
    setSending(true)
    setError('')

    const inbox = inboxes.find(i => i.id === selectedInbox)
    const tmpl  = templates.find(t => t.id === selectedTemplate)

    // Actually send it via Gmail first -- this used to skip straight to
    // logging a "sent" row without ever calling gmail-reply, so nothing
    // ever left the outbox even though the UI said "Email logged successfully".
    const { data, error: fnError } = await supabase.functions.invoke('gmail-reply', {
      body: {
        account_id: selectedInbox,
        to,
        subject: subject.replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/\u00a3/g, 'GBP'),
        message: body,
        client_id: CLIENT_ID,
      },
    })

    if (fnError) {
      setSending(false)
      let serverSaid = ''
      try {
        if (fnError.context && typeof fnError.context.json === 'function') {
          const errBody = await fnError.context.json()
          serverSaid = errBody?.error || ''
        }
      } catch { /* ignore -- fall back to generic message below */ }
      setError(serverSaid || fnError.message || 'Send failed -- the email was not delivered')
      return
    }

    // Log to email_log table -- only reached after a confirmed real send
    const { error: logErr } = await supabase.from('email_log').insert({
      sent_by:       profile.id,
      sent_by_name:  profile.full_name,
      inbox_id:      selectedInbox || null,
      lead_id:       context.leadId   || null,
      client_id:     context.clientId || null,
      job_id:        context.jobId    || null,
      to_email:      to,
      to_name:       context.toName || '',
      subject,
      body,
      template_id:   selectedTemplate || null,
      template_name: tmpl?.name || null,
      status:        'sent',
    })

    // Log to activities
    await supabase.from('activities').insert({
      lead_id:       context.leadId   || null,
      client_id:     context.clientId || null,
      job_id:        context.jobId    || null,
      rep_id:        profile.id,
      rep_name:      profile.full_name,
      activity_type: 'email',
      title:         `Email sent: ${subject}`,
      body:          body.slice(0, 500),
      metadata:      { to_email: to, template: tmpl?.name, inbox: inbox?.gmail_address },
    })

    setSending(false)
    if (logErr) { setError('Email sent, but failed to log to activity feed: ' + logErr.message); return }
    setSent(true)
    setTimeout(() => onClose?.(), 2000)
  }

  const inputStyle = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }

  return (
    <div style={{
      position: 'fixed', bottom: 0, right: 24, width: 520,
      background: '#fff', borderRadius: '12px 12px 0 0',
      boxShadow: '0 -4px 32px rgba(0,0,0,0.18)',
      border: `1px solid ${C.border}`, zIndex: 500,
      maxHeight: minimised ? 48 : '80vh', overflow: 'hidden',
      transition: 'max-height 0.2s ease',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ background: C.text, color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}
        onClick={() => setMinimised(p => !p)}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          ✉ New Email {context.toName ? `→ ${context.toName}` : ''}
        </span>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ opacity: 0.7, fontSize: 16 }}>{minimised ? '▲' : '▼'}</span>
          <span onClick={e => { e.stopPropagation(); onClose?.() }} style={{ opacity: 0.7, fontSize: 18, cursor: 'pointer' }}>✕</span>
        </div>
      </div>

      {!minimised && (
        <div style={{ overflowY: 'auto', flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ color: C.greenDark, fontWeight: 600 }}>Email logged successfully</div>
              <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Activity recorded on the record</div>
            </div>
          ) : (
            <>
              {/* Template picker */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Template (optional)</div>
                <select value={selectedTemplate} onChange={e => applyTemplate(e.target.value)} style={inputStyle}>
                  <option value="">— Pick a template to auto-fill —</option>
                  {['verified_customer','cold_email','process'].map(cat => (
                    <optgroup key={cat} label={cat.replace(/_/g,' ').toUpperCase()}>
                      {templates.filter(t => t.category === cat).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* From inbox */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>From</div>
                <select value={selectedInbox} onChange={e => setSelectedInbox(e.target.value)} style={inputStyle}>
                  {inboxes.length === 0 && <option value="">No Gmail account connected</option>}
                  {inboxes.map(i => <option key={i.id} value={i.id}>{i.display_name || i.gmail_address}{i.account_type === 'personal' ? ' (personal)' : ''}</option>)}
                </select>
              </div>

              {/* To */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>To</div>
                <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@email.com" style={inputStyle} />
              </div>

              {/* Subject */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Subject</div>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={inputStyle} />
              </div>

              {/* Body */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Body</div>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
                  placeholder="Email body…"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
              </div>

              {error && <div style={{ color: C.red, fontSize: 12, background: C.redSoft, borderRadius: 6, padding: '8px 12px' }}>{error}</div>}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                <button onClick={sendEmail} disabled={sending || !to || !subject || !body}
                  style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: sending ? 0.7 : 1, flex: 1 }}>
                  {sending ? 'Sending…' : '📤 Send'}
                </button>
                <button onClick={onClose} style={{ background: '#fff', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Discard
                </button>
              </div>

              <div style={{ fontSize: 11, color: C.dim, textAlign: 'center' }}>
                Sent from your connected Gmail account, and logged to the activity feed of the linked record
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
