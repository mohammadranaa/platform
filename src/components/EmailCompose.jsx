import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

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
    const { data } = await supabase.from('inboxes').select('id, label, email').eq('is_active', true)
    setInboxes(data || [])
    if (data?.length > 0) setSelectedInbox(data[0].id)
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
    setSending(true)
    setError('')

    const inbox = inboxes.find(i => i.id === selectedInbox)
    const tmpl  = templates.find(t => t.id === selectedTemplate)

    // Log to email_log table
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
      metadata:      { to_email: to, template: tmpl?.name, inbox: inbox?.email },
    })

    setSending(false)
    if (logErr) { setError(logErr.message); return }
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
                  {inboxes.map(i => <option key={i.id} value={i.id}>{i.label || i.email}</option>)}
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
                  {sending ? 'Logging…' : '📤 Send & Log'}
                </button>
                <button onClick={onClose} style={{ background: '#fff', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Discard
                </button>
              </div>

              <div style={{ fontSize: 11, color: C.dim, textAlign: 'center' }}>
                Email is logged to the activity feed of the linked record
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
