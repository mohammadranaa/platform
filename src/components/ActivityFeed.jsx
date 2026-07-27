import { useState, useEffect, useRef } from 'react'
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
  payment_received:        { icon: '💰', color: C.greenDark, label: 'Payment' },
  certificate_issued:      { icon: '📜', color: C.greenDark, label: 'Certificate' },
  google_review_requested: { icon: '⭐', color: C.amber,     label: 'Review' },
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
  const [profiles, setProfiles]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [type, setType]             = useState('note')
  const [body, setBody]             = useState('')
  const [saving, setSaving]         = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { fetch(); fetchProfiles() }, [leadId, clientId, jobId])

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

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('is_active', true)
    setProfiles(data || [])
  }

  // Parse @mentions from text
  function parseMentions(text) {
    const mentionedIds = []
    const mentionRegex = /@(\w+(?:\s\w+)?)/g
    let match
    while ((match = mentionRegex.exec(text)) !== null) {
      const name = match[1].toLowerCase()
      const found = profiles.find(p => p.full_name.toLowerCase() === name || p.full_name.toLowerCase().startsWith(name))
      if (found) mentionedIds.push(found.id)
    }
    return [...new Set(mentionedIds)]
  }

  async function log() {
    if (!body.trim()) return
    setSaving(true)
    const mentionedUsers = parseMentions(body)
    await supabase.from('activities').insert({
      lead_id:   leadId   || null,
      client_id: clientId || null,
      job_id:    jobId    || null,
      rep_id:    profile.id,
      rep_name:  profile.full_name,
      activity_type: type,
      title: `${TYPE_META[type]?.label}: ${body.slice(0, 60)}`,
      body,
      mentioned_users: mentionedUsers.length > 0 ? mentionedUsers : null,
    })
    setSaving(false)
    setBody('')
    fetch()
  }

  function insertMention(p) {
    setBody(prev => {
      const lastAt = prev.lastIndexOf('@')
      return prev.slice(0, lastAt) + '@' + p.full_name + ' '
    })
    setShowMentions(false)
    setMentionFilter('')
    inputRef.current?.focus()
  }

  function handleInput(e) {
    const val = e.target.value
    setBody(val)
    // Check if user just typed @
    const lastAt = val.lastIndexOf('@')
    if (lastAt >= 0 && lastAt === val.length - 1) {
      setShowMentions(true)
      setMentionFilter('')
    } else if (lastAt >= 0) {
      const after = val.slice(lastAt + 1)
      if (!after.includes(' ') && after.length <= 20) {
        setShowMentions(true)
        setMentionFilter(after.toLowerCase())
      } else {
        setShowMentions(false)
      }
    } else {
      setShowMentions(false)
    }
  }

  // Build shareable link for the current record
  function getShareLink() {
    const base = window.location.origin
    if (leadId)   return `${base}/leads/${leadId}`
    if (clientId) return `${base}/clients/${clientId}`
    if (jobId)    return `${base}/jobs/${jobId}`
    return base
  }

  function copyLink() {
    navigator.clipboard.writeText(getShareLink())
      .then(() => {
        // Show brief feedback
        const btn = document.getElementById('copy-link-btn')
        if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '🔗 Copy Link' }, 2000) }
      })
  }

  const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  // Render body with @mentions highlighted
  function renderBody(text) {
    if (!text) return null
    const parts = text.split(/(@\w+(?:\s\w+)?)/g)
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const name = part.slice(1).toLowerCase()
        const matched = profiles.find(p => p.full_name.toLowerCase() === name || p.full_name.toLowerCase().startsWith(name))
        if (matched) {
          return <span key={i} style={{ background: C.accentSoft, color: C.accent, borderRadius: 4, padding: '0 4px', fontWeight: 600 }}>{part}</span>
        }
      }
      return <span key={i}>{part}</span>
    })
  }

  const filteredProfiles = profiles.filter(p =>
    p.id !== profile.id &&
    (mentionFilter === '' || p.full_name.toLowerCase().includes(mentionFilter))
  )

  return (
    <div>
      {/* Share link + log input */}
      {!compact && (
        <>
          {/* Share link */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button id="copy-link-btn" onClick={copyLink}
              style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, color: C.muted, cursor: 'pointer', fontWeight: 500 }}>
              🔗 Copy Link
            </button>
            <span style={{ color: C.dim, fontSize: 11, alignSelf: 'center' }}>Share this record with your team</span>
          </div>

          {/* Log input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', position: 'relative' }}>
            <select value={type} onChange={e => setType(e.target.value)}
              style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 10px', fontSize: 13, flexShrink: 0 }}>
              {LOG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{ flex: 1, position: 'relative', minWidth: 200 }}>
              <input ref={inputRef} value={body} onChange={handleInput}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !showMentions) log() }}
                placeholder="Log a note… type @ to mention someone"
                style={{ width: '100%', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }} />
              {/* Mention dropdown */}
              {showMentions && filteredProfiles.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
                  {filteredProfiles.map(p => (
                    <button key={p.id} onClick={() => insertMention(p)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: C.text, borderBottom: `1px solid ${C.surface}` }}
                      onMouseEnter={e => e.currentTarget.style.background = C.accentSoft}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      👤 <strong>{p.full_name}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={log} disabled={saving || !body.trim()}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              Log
            </button>
          </div>
        </>
      )}

      {/* Timeline */}
      {loading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: '12px 0' }}>Loading…</div>
      ) : activities.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 13, padding: '12px 0' }}>No activity yet.</div>
      ) : (
        <div style={{ position: 'relative' }}>
          {!compact && <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: C.border }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 12 }}>
            {activities.map(a => {
              const meta = TYPE_META[a.activity_type] || TYPE_META.note
              return (
                <div key={a.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
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
                    {a.body && (
                      <div style={{ fontSize: compact ? 11 : 13, color: C.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {renderBody(a.body)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                      {a.rep_name}
                      {a.mentioned_users?.length > 0 && (
                        <span style={{ marginLeft: 8, color: C.accent }}>
                          · mentioned {a.mentioned_users.length} person{a.mentioned_users.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
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

// Helper to log activity programmatically
export async function logActivity({ leadId, clientId, jobId, repId, repName, type, title, body, metadata = {}, mentionedUsers = [] }) {
  return supabase.from('activities').insert({
    lead_id: leadId || null, client_id: clientId || null, job_id: jobId || null,
    rep_id: repId || null, rep_name: repName || 'System',
    activity_type: type, title, body, metadata,
    mentioned_users: mentionedUsers.length > 0 ? mentionedUsers : null,
  })
}
