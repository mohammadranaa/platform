import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const TABS = ['All', 'Inbox', 'Sent', 'Replied', 'Bounced']

const ACCOUNT_COLORS = [
  '#0093DB', '#80D100', '#D97706', '#7C3AED', '#0D9488', '#DC2626',
]

export default function ColdInbox() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [accounts, setAccounts]   = useState([])
  const [emails, setEmails]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('All')
  const [search, setSearch]       = useState('')
  const [filterAccount, setFilterAccount] = useState('all')
  const [selected, setSelected]   = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    // Get all cold inboxes (SMTP accounts used for cold outreach)
    const { data: inboxes } = await supabase
      .from('inboxes')
      .select('id, label, email, is_active, sent_today, warmup_start_limit')
      .order('created_at')

    setAccounts(inboxes || [])

    // Get all email sends from campaigns
    const { data: sends } = await supabase
      .from('email_sends')
      .select(`
        id, subject, status, sent_at, open_count, click_count,
        campaign_contacts(email, first_name, last_name, company),
        campaigns(name, from_name)
      `)
      .order('sent_at', { ascending: false })
      .limit(200)

    setEmails(sends || [])
    setLoading(false)
  }

  const filtered = emails.filter(e => {
    if (tab === 'Inbox' || tab === 'Replied') return e.status === 'replied'
    if (tab === 'Sent') return ['sent','opened','clicked'].includes(e.status)
    if (tab === 'Bounced') return e.status === 'bounced'
    return true
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    const contact = e.campaign_contacts
    return (contact?.email || '').toLowerCase().includes(q) ||
           (contact?.first_name || '').toLowerCase().includes(q) ||
           (contact?.company || '').toLowerCase().includes(q) ||
           (e.subject || '').toLowerCase().includes(q)
  })

  const stats = {
    total:    emails.length,
    sent:     emails.filter(e => ['sent','opened','clicked','replied'].includes(e.status)).length,
    opened:   emails.filter(e => e.open_count > 0).length,
    replied:  emails.filter(e => e.status === 'replied').length,
    bounced:  emails.filter(e => e.status === 'bounced').length,
  }
  const openRate   = stats.sent > 0 ? Math.round((stats.opened  / stats.sent) * 100) : 0
  const replyRate  = stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0

  const statusColor = s => ({
    sent:    { bg: C.surface,   color: C.muted },
    opened:  { bg: C.accentSoft, color: C.accent },
    clicked: { bg: C.accentSoft, color: C.accent },
    replied: { bg: C.greenSoft,  color: C.greenDark },
    bounced: { bg: C.redSoft,    color: C.red },
    failed:  { bg: C.redSoft,    color: C.red },
  }[s] || { bg: C.surface, color: C.muted })

  const contactName = e => {
    const c = e.campaign_contacts
    if (!c) return '—'
    return `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || c.email || '—'
  }

  const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13, width: '100%' }
  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, verticalAlign: 'middle' }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Cold Inbox</h1>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
          All {accounts.length} cold accounts combined · {stats.total} total emails
        </div>
      </div>

      {/* Account pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {accounts.map((acc, i) => (
          <div key={acc.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fff', border: `1px solid ${C.border}`,
            borderLeft: `4px solid ${ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}`,
            borderRadius: 8, padding: '8px 14px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{acc.label || acc.email}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{acc.email}</div>
            </div>
            <span style={{
              background: acc.is_active ? C.greenSoft : C.surface,
              color: acc.is_active ? C.greenDark : C.muted,
              borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 700,
            }}>
              {acc.is_active ? `${acc.sent_today || 0}/${acc.warmup_start_limit || 10} today` : 'Paused'}
            </span>
          </div>
        ))}

        {accounts.length === 0 && (
          <div style={{ color: C.muted, fontSize: 13, padding: '8px 0' }}>
            No cold inboxes connected yet. Add them in SMTP Inboxes →
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Sent',   value: stats.sent,            color: C.text   },
          { label: 'Opened',       value: `${stats.opened} (${openRate}%)`,  color: C.accent },
          { label: 'Replied',      value: `${stats.replied} (${replyRate}%)`, color: C.greenDark },
          { label: 'Bounced',      value: stats.bounced,          color: C.red    },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: '14px 18px', flex: 1, minWidth: 110, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 20, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Important notice about external emails */}
      <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: C.text }}>
        <strong style={{ color: C.amber }}>📌 Note on external emails:</strong> Emails sent directly from Gmail
        (not through this platform) will appear here once each Gmail account is connected via Google OAuth
        in the <strong>Email Inbox</strong> section. All replies — including to emails sent before connecting —
        will be visible immediately after connecting.
      </div>

      {/* Tabs + search */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 400, background: tab === t ? '#fff' : 'transparent', color: tab === t ? C.accent : C.muted }}>
              {t}
              {t === 'Replied' && stats.replied > 0 && (
                <span style={{ background: C.greenSoft, color: C.greenDark, borderRadius: 20, padding: '1px 6px', fontSize: 10, fontWeight: 700, marginLeft: 5 }}>{stats.replied}</span>
              )}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contact, email, subject…"
          style={{ ...inp, flex: 1, minWidth: 200 }} />
      </div>

      {/* Email list */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading emails…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            {emails.length === 0
              ? 'No emails sent yet. Create a campaign to start sending.'
              : 'No emails match this filter.'}
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Contact', 'Email', 'Subject', 'Campaign', 'Status', 'Opens', 'Sent'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const sc = statusColor(e.status)
                  return (
                    <tr key={e.id}
                      onClick={() => setSelected(selected?.id === e.id ? null : e)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={ev => ev.currentTarget.style.background = C.surface}
                      onMouseLeave={ev => ev.currentTarget.style.background = '#fff'}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: C.text }}>{contactName(e)}</div>
                        {e.campaign_contacts?.company && (
                          <div style={{ fontSize: 11, color: C.muted }}>{e.campaign_contacts.company}</div>
                        )}
                      </td>
                      <td style={td}><span style={{ color: C.muted, fontSize: 12 }}>{e.campaign_contacts?.email || '—'}</span></td>
                      <td style={td}><span style={{ color: C.text, fontSize: 13 }}>{e.subject || '—'}</span></td>
                      <td style={td}><span style={{ color: C.muted, fontSize: 12 }}>{e.campaigns?.name || '—'}</span></td>
                      <td style={td}>
                        <span style={{ background: sc.bg, color: sc.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
                          {e.status}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ color: e.open_count > 0 ? C.accent : C.dim, fontWeight: e.open_count > 0 ? 700 : 400 }}>
                          {e.open_count || 0}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ color: C.dim, fontSize: 12 }}>
                          {e.sent_at ? new Date(e.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Expanded email detail */}
            {selected && (
              <div style={{ padding: 20, background: C.surface, borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{selected.subject}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      To: {selected.campaign_contacts?.email} · {selected.sent_at ? new Date(selected.sent_at).toLocaleString('en-GB') : '—'}
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
                <div style={{ display: 'flex', gap: 20, fontSize: 13, color: C.muted }}>
                  <span>📬 Opens: <strong style={{ color: C.text }}>{selected.open_count || 0}</strong></span>
                  <span>🖱 Clicks: <strong style={{ color: C.text }}>{selected.click_count || 0}</strong></span>
                  <span>📅 Opened: <strong style={{ color: C.text }}>{selected.opened_at ? new Date(selected.opened_at).toLocaleString('en-GB') : 'Not yet'}</strong></span>
                  <span>↩ Replied: <strong style={{ color: C.text }}>{selected.replied_at ? new Date(selected.replied_at).toLocaleString('en-GB') : 'Not yet'}</strong></span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  )
}
