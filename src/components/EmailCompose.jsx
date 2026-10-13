import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useDraft } from '../hooks/useDraft'
import { CcField, AttachFiles, parseCc, checkFiles, uploadEmailFiles } from './EmailExtras'
import { fillTemplate, varsFromLead, varsFromClient } from '../lib/templateVars'

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

// "2026-10-14" -> "Wednesday 14 October 2026" (leaves anything else untouched)
function fmtLongDate(d) {
  if (!d) return ''
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(d))) return d
  return new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Heading used in the branded HTML version of process emails
const PROCESS_TITLES = [
  [/booking confirm/i, 'Booking Confirmed'],
  [/payment confirm/i, 'Payment Received'],
  [/invoice/i, 'Your Invoice'],
  [/certificate/i, 'Your Certificate'],
  [/quote/i, 'Your Quote'],
]
// Templates that confirm an appointment get a calendar invite
const isBookingTemplate = t => /booking confirm|payment confirm/i.test(t?.name || '')

// Auto-fill template variables from record context
// Everything a template can refer to, from the lead/client record plus the page context.
function templateVars(ctx, record) {
  return {
    ...record,                                  // first_name, last_name, full_name, company_name
    rep_name: ctx.repName || '',
    property_address: ctx.address || '',
    inspection_name: ctx.services || '',
    last_inspection_date: ctx.lastJobDate || '',
    date: fmtLongDate(ctx.scheduledDate) || new Date().toLocaleDateString('en-GB'),
    time_window: ctx.timeSlot || '',
    time_slot: ctx.timeSlot || '',
    renewal_date: ctx.renewalDate || '',
    invoice_link: ctx.invoiceLink || '',
    certificate_holder: record.full_name || ctx.name || '',
    amount: ctx.amount ? `£${Number(ctx.amount).toFixed(2)}` : '',
    phone: ctx.phone || '',
    email: ctx.toEmail || '',
  }
}

export default function EmailCompose({ onClose, context = {} }) {
  // context: { leadId, clientId, jobId, toEmail, toName, name, address, services, repName, scheduledDate, timeSlot, renewalDate, lastJobDate }
  const { profile } = useAuth()

  const [templates, setTemplates]   = useState([])
  const [inboxes, setInboxes]       = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [selectedInbox, setSelectedInbox]       = useState('')
  const draftKey = `email:${context.leadId || context.clientId || context.jobId || 'new'}`
  const [to, setTo, clearTo]               = useDraft(`${draftKey}:to`, context.toEmail || '')
  const [subject, setSubject, clearSubject] = useDraft(`${draftKey}:subject`)
  const [body, setBody, clearBody]          = useDraft(`${draftKey}:body`)
  const [sending, setSending] = useState(false)
  const [sent, setSent]     = useState(false)
  const [error, setError]   = useState('')
  const [minimised, setMinimised] = useState(false)
  const [includeInvite, setIncludeInvite] = useState(false)
  const [cc, setCc] = useState('')
  const [extraFiles, setExtraFiles] = useState([])
  // Calendar invite is possible when we know the appointment date and slot
  const canInvite = !!(context.scheduledDate && /^\d{4}-\d{2}-\d{2}/.test(String(context.scheduledDate)) && context.timeSlot)

  useEffect(() => {
    fetchTemplates()
    fetchInboxes()
  }, [])

  async function fetchTemplates() {
    const { data } = await supabase.from('email_templates').select('*').order('sort_order')
    setTemplates(data || [])
  }

  async function fetchInboxes() {
    // Personal inboxes only. Reps/finance: their own. Admins: any connected personal inbox, own first.
    const { data } = await supabase.from('user_email_accounts')
      .select('id, gmail_address, display_name, account_type, token_expiry, profile_id')
      .eq('is_active', true).eq('account_type', 'personal')
      .neq('access_token', 'NOT_CONNECTED')
      .order('gmail_address')
    const isAdminUser = profile?.role === 'admin'
    const mine = (data || []).filter(a => a.profile_id === profile?.id)
    const list = isAdminUser ? [...mine, ...(data || []).filter(a => a.profile_id !== profile?.id)] : mine
    setInboxes(list)
    setSelectedInbox(list[0]?.id || '')
    if (!list.length) setError(`Your inbox (${profile?.email || 'personal email'}) isn't connected yet. Go to Email Inbox and click "Connect" first.`)
  }

  // Load the lead/client this email is about, so templates get the real first name
  // and company (not just one combined display name).
  const [recordVars, setRecordVars] = useState({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (context.leadId) {
        const { data } = await supabase.from('leads')
          .select('contact_first, contact_last, cold_contact_name, inbound_name, cold_company_name, company_name')
          .eq('id', context.leadId).maybeSingle()
        if (!cancelled && data) setRecordVars(varsFromLead(data))
      } else if (context.clientId) {
        const { data } = await supabase.from('clients')
          .select('first_name, last_name, billing_name, company_name').eq('id', context.clientId).maybeSingle()
        if (!cancelled && data) setRecordVars(varsFromClient(data))
      }
    })()
    return () => { cancelled = true }
  }, [context.leadId, context.clientId])

  function applyTemplate(templateId) {
    const tmpl = templates.find(t => t.id === templateId)
    if (!tmpl) return
    setSelectedTemplate(templateId)
    const vars = templateVars(context, recordVars)
    setSubject(fillTemplate(tmpl.subject, vars))
    setBody(fillTemplate(tmpl.body, vars))
    setIncludeInvite(canInvite && isBookingTemplate(tmpl))
  }

  async function sendEmail() {
    if (!to || !subject || !body) { setError('To, subject and body are all required'); return }
    if (!selectedInbox) { setError('No Gmail account connected. Connect one in Email Inbox first.'); return }
    const ccParsed = parseCc(cc)
    if (ccParsed.invalid.length) { setError(`Check the CC field — not a valid email: ${ccParsed.invalid.join(', ')}`); return }
    const fileProblem = checkFiles(extraFiles)
    if (fileProblem) { setError(fileProblem); return }
    setSending(true)
    setError('')

    let uploaded = []
    try { uploaded = extraFiles.length ? await uploadEmailFiles(extraFiles) : [] }
    catch (e) { setSending(false); setError(e.message); return }

    const inbox = inboxes.find(i => i.id === selectedInbox)
    const tmpl  = templates.find(t => t.id === selectedTemplate)

    // Actually send it via Gmail first -- this used to skip straight to
    // logging a "sent" row without ever calling gmail-reply, so nothing
    // ever left the outbox even though the UI said "Email logged successfully".
    // If context.threadId is present (replying from an existing thread) we pass it
    // so the reply appears in the same Gmail thread.
    const { data, error: fnError } = await supabase.functions.invoke('gmail-reply', {
      body: {
        account_id: selectedInbox,
        to,
        subject: subject.replace(/[\r\n]+/g, ' ').trim(),
        message: body,
        client_id: CLIENT_ID,
        ...(context.threadId ? { thread_id: context.threadId } : {}),
        ...(ccParsed.list.length ? { cc: ccParsed.list.join(', ') } : {}),
        ...(uploaded.length ? { storage_paths: uploaded } : {}),
        // Process emails (booking, payment, invoice, certificate) go out as branded HTML;
        // cold/sales emails stay plain so they read like a personal email.
        ...(tmpl?.category === 'process' ? {
          branded: true,
          html_title: (PROCESS_TITLES.find(([re]) => re.test(tmpl.name || '')) || [])[1] || '',
        } : {}),
        ...(includeInvite && canInvite ? { calendar_event: {
          uid: context.calendarUid || `${context.jobId ? 'job-' + context.jobId : context.leadId ? 'lead-' + context.leadId : 'mlc-' + Date.now()}@mylandlordcertificate.co.uk`,
          date: String(context.scheduledDate).slice(0, 10),
          slot: context.timeSlot,
          summary: `${context.services || 'Property inspection'} — My Landlord Certificate`,
          location: context.address || '',
          description: `${context.services || 'Property inspection'}\nArrival window: ${context.timeSlot}\nOur engineer will call approximately one hour before arrival.\nQuestions or changes: 020 3996 1070`,
          attendee_name: context.toName || context.name || '',
          attendee_email: to.trim(),
        } } : {}),
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
      metadata:      { to_email: to, cc: ccParsed.list, attachments: uploaded.map(u => u.name), template: tmpl?.name, inbox: inbox?.gmail_address },
    })

    setSending(false)
    if (logErr) { setError('Email sent, but failed to log to activity feed: ' + logErr.message); return }
    clearTo(); clearSubject(); clearBody(); setCc(''); setExtraFiles([])
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
                  {['cold_email','process'].map(cat => (
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

              <CcField value={cc} onChange={setCc} inputStyle={inputStyle}
                labelStyle={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }} />

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

              <AttachFiles files={extraFiles} onChange={setExtraFiles}
                labelStyle={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }} />

              {canInvite && isBookingTemplate(templates.find(t => t.id === selectedTemplate)) && (
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: includeInvite ? C.greenSoft : C.surface, border: `1px solid ${includeInvite ? '#80D10066' : C.border}`, borderRadius: 8, padding: '9px 12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeInvite} onChange={e => setIncludeInvite(e.target.checked)} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: includeInvite ? C.greenDark : C.text }}>📅 Attach calendar invite</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{fmtLongDate(context.scheduledDate)} · {context.timeSlot}{context.address ? ` · ${context.address}` : ''}</div>
                  </div>
                </label>
              )}

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
