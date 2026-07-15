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

const TYPE_META = {
  note:                    { icon: '📝', color: C.muted,     label: 'Note' },
  call:                    { icon: '📞', color: C.amber,     label: 'Call' },
  email:                   { icon: '✉️', color: C.accent,    label: 'Email' },
  whatsapp:                { icon: '💬', color: C.greenDark, label: 'WhatsApp' },
  sms:                     { icon: '📱', color: C.greenDark, label: 'SMS' },
  meeting:                 { icon: '🤝', color: C.accent,    label: 'Meeting' },
  status_change:           { icon: '🔄', color: '#7C3AED',   label: 'Status Change' },
  assignment:              { icon: '👤', color: C.accent,    label: 'Assigned' },
  invoice_sent:            { icon: '🧾', color: C.amber,     label: 'Invoice Sent' },
  payment_received:        { icon: '💰', color: C.greenDark, label: 'Payment Received' },
  certificate_issued:      { icon: '📜', color: C.greenDark, label: 'Certificate Issued' },
  google_review_requested: { icon: '⭐', color: C.amber,     label: 'Review Requested' },
  system:                  { icon: '⚙️', color: C.dim,       label: 'System' },
}

const LOG_TYPES = [
  { value: 'note',     label: '📝 Note' },
  { value: 'call',     label: '📞 Call' },
  { value: 'email',    label: '✉️ Email' },
  { value: 'whatsapp', label: '💬 WhatsApp' },
  { value: 'sms',      label: '📱 SMS' },
  { value: 'meeting',  label: '🤝 Meeting' },
]

export default function ActivityFeed({ leadId, clientId, jobId, compact = false }) {
  const { profile } = useAuth()
  const [activities, setActivities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [type, setType]             = useState('note')
  const [body, setBody]             = useState('')
  const [saving, setSaving]         = useState(false)

  useEffect(() => { fetch() }, [leadId, clientId, jobId])

  async function fetch() {
    setLoading(true)
    let q = supabase.from('activities').select('*').order('created_at', { ascending: false })
    if (leadId)   q = q.eq('lead_id',   leadId)
    if (clientId) q = q.eq('client_id', clientId)
    if (jobId)    q = q.eq('job_id',    jobId)
    const { data } = await q.limit(compact ? 10 : 50)
    setActivities(data || [])
    setLoading(false)
  }

  async function log() {
    if (!body.trim()) return
    setSaving(true)
    await supabase.from('activities').insert({
      lead_id:       leadId   || null,
      client_id:     clientId || null,
      job_id:        jobId    || null,
      rep_id:        profile.id,
      rep_name:      profile.full_name,
      activity_type: type,
      title:         `${TYPE_META[type]?.label}: ${body.slice(0, 60)}`,
      body,
    })
    setSaving(false)
    setBody('')
    fetch()
  }

  const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div>
      {/* Log input */}
      {!compact && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={type} onChange={e => setType(e.target.value)}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 10px', fontSize: 13, flexShrink: 0 }}>
            {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={body} onChange={e => setBody(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && log()}
            placeholder="Log a call, note, email… press Enter"
            style={{ flex: 1, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }} />
          <button onClick={log} disabled={saving || !body.trim()}
            style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            Log
          </button>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: '12px 0' }}>Loading…</div>
      ) : activities.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '12px 0' }}>No activity yet.</div>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* Timeline line */}
          {!compact && <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: C.border }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
            {activities.map(a => {
              const meta = TYPE_META[a.activity_type] || TYPE_META.note
              return (
                <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
                  {/* Icon bubble */}
                  {!compact && (
                    <div style={{ width: 32, height: 32, background: '#fff', border: `2px solid ${meta.color}44`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, zIndex: 1 }}>
                      {meta.icon}
                    </div>
                  )}
                  {compact && <span style={{ fontSize: 14, flexShrink: 0 }}>{meta.icon}</span>}

                  <div style={{ flex: 1, background: compact ? 'transparent' : '#fff', border: compact ? 'none' : `1px solid ${C.border}`, borderRadius: compact ? 0 : 8, padding: compact ? '2px 0' : '10px 14px', borderBottom: compact ? `1px solid ${C.border}` : 'none', paddingBottom: compact ? 8 : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: compact ? 2 : 4 }}>
                      <span style={{ fontSize: compact ? 12 : 13, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                      <span style={{ fontSize: 11, color: C.dim, flexShrink: 0, marginLeft: 8 }}>{fmtDate(a.created_at)}</span>
                    </div>
                    {a.title && a.title !== a.body && (
                      <div style={{ fontSize: compact ? 12 : 13, color: C.text, fontWeight: 500, marginBottom: 2 }}>{a.title}</div>
                    )}
                    {a.body && (
                      <div style={{ fontSize: compact ? 11 : 13, color: C.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.body}</div>
                    )}
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{a.rep_name}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Helper to log activity programmatically (call from anywhere)
export async function logActivity({ leadId, clientId, jobId, repId, repName, type, title, body, metadata = {} }) {
  return supabase.from('activities').insert({
    lead_id:       leadId    || null,
    client_id:     clientId  || null,
    job_id:        jobId     || null,
    rep_id:        repId     || null,
    rep_name:      repName   || 'System',
    activity_type: type,
    title,
    body,
    metadata,
  })
}
