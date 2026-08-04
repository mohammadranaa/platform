import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fyjgtwupzpeivdedoutj.supabase.co'
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || ''

const C = { accent:'#0093DB', text:'#1F2937', muted:'#6B7280', border:'#E5E7EB', green:'#3d7a00', greenSoft:'#F0FAE0' }

export default function SendEmailModal({
  onClose, onSent,
  to = '', subject = '', body = '',
  attachmentBase64 = null,   // base64 string of PDF/file
  attachmentName = null,     // e.g. "Invoice-INV-001.pdf"
  attachmentMime = 'application/pdf',
  title = 'Send Email',
}) {
  const { profile } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const [templates, setTemplates] = useState([])
  const [toAddr, setToAddr] = useState(to)
  const [subjectVal, setSubjectVal] = useState(subject)
  const [bodyVal, setBodyVal] = useState(body)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const safeSubject = (subjectVal || '').replace(/—/g, '--').replace(/–/g, '-').replace(/[^\x00-\x7F]/g, '')

  useEffect(() => {
    // Load connected Gmail accounts (personal first, then cold)
    supabase.from('user_email_accounts')
      .select('id, gmail_address, display_name, account_type')
      .eq('is_active', true)
      .order('account_type')
      .then(({ data }) => {
        setAccounts(data || [])
        // Default to personal (info@) if available
        const personal = (data || []).find(a => a.account_type === 'personal')
        if (personal) setAccountId(personal.id)
        else if (data?.length) setAccountId(data[0].id)
      })

    // Load active email templates
    supabase.from('email_templates').select('id, name, subject, body').eq('is_active', true).then(({ data }) => {
      setTemplates(data || [])
    })
  }, [])

  function applyTemplate(t) {
    if (!t) return
    // Replace template variables
    setSubjectVal(t.subject || subjectVal)
    setBodyVal(t.body || bodyVal)
  }

  async function send() {
    if (!toAddr || !subjectVal || !bodyVal) { setError('To, Subject and Message are required'); return }
    if (!accountId) { setError('No Gmail account connected. Connect one in Email Inbox.'); return }
    setSending(true)
    setError('')

    try {
      const payload = {
        account_id: accountId,
        to: toAddr,
        subject: safeSubject,
        message: bodyVal,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }

      // Add attachment if provided
      if (attachmentBase64 && attachmentName) {
        payload.attachment_base64 = attachmentBase64
        payload.attachment_name = attachmentName
        payload.attachment_mime = attachmentMime
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (data.ok) {
        // Log to email_log
        await supabase.from('email_log').insert({
          to_email: toAddr,
          subject: safeSubject,
          body: bodyVal,
          sent_by: profile?.id,
          sent_at: new Date().toISOString(),
          status: 'sent',
        }).catch(() => {})
        onSent?.()
        onClose?.()
      } else {
        setError(data.error || 'Failed to send')
      }
    } catch (err) {
      setError('Send failed: ' + err.message)
    }
    setSending(false)
  }

  const lbl = { color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }
  const inp = { width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }

  return (
    <div style={{ position:'fixed', inset:0, background:'#00000066', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300 }}
      onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:16, padding:32, width:580, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
          <h3 style={{ fontSize:18, fontWeight:700, color:C.text, margin:0 }}>✉ {title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:20 }}>✕</button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

          {/* From account */}
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

          {/* Template picker */}
          {templates.length > 0 && (
            <div>
              <label style={lbl}>Use Template</label>
              <select onChange={e => applyTemplate(templates.find(t => t.id === e.target.value))}
                defaultValue=""
                style={{ ...inp, color: C.muted }}>
                <option value="">-- Select a template (optional) --</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* To */}
          <div>
            <label style={lbl}>To</label>
            <input value={toAddr} onChange={e => setToAddr(e.target.value)} style={inp} placeholder="recipient@email.com" />
          </div>

          {/* Subject */}
          <div>
            <label style={lbl}>Subject</label>
            <input value={subjectVal} onChange={e => setSubjectVal(e.target.value)} style={inp} />
          </div>

          {/* Attachment indicator */}
          {attachmentBase64 && attachmentName && (
            <div style={{ background: C.greenSoft, border:'1px solid #80D10066', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:20 }}>📎</span>
              <div>
                <div style={{ fontWeight:600, color:C.green, fontSize:13 }}>{attachmentName}</div>
                <div style={{ fontSize:11, color:C.muted }}>Will be attached to this email</div>
              </div>
            </div>
          )}

          {/* Body */}
          <div>
            <label style={lbl}>Message</label>
            <textarea value={bodyVal} onChange={e => setBodyVal(e.target.value)} rows={12}
              style={{ ...inp, resize:'vertical', fontFamily:'inherit', lineHeight:1.6 }} />
          </div>

          {error && <div style={{ background:'#FEE2E2', color:'#DC2626', borderRadius:8, padding:'10px 14px', fontSize:13 }}>{error}</div>}

          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button onClick={send} disabled={sending || !accountId}
              style={{ background: C.accent, color:'#fff', border:'none', borderRadius:8, padding:'11px 28px', fontWeight:700, fontSize:14, cursor:'pointer', flex:1, opacity: (sending || !accountId) ? 0.7 : 1 }}>
              {sending ? '⏳ Sending...' : '📤 Send Email'}
            </button>
            <button onClick={onClose}
              style={{ background:'#fff', color:C.muted, border:`1px solid ${C.border}`, borderRadius:8, padding:'11px 20px', fontWeight:600, fontSize:14, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
