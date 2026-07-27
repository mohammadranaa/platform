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
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fyjgtwupzpeivdedoutj.supabase.co'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = `${window.location.origin}/inbox/oauth-callback`

const ACCOUNT_COLORS = ['#0093DB', '#80D100', '#D97706', '#7C3AED', '#0D9488', '#DC2626', '#EC4899', '#8B5CF6']

export default function ColdInbox() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [accounts, setAccounts]   = useState([])
  const [messages, setMessages]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [fetching, setFetching]   = useState(false)
  const [tab, setTab]             = useState('All')
  const [search, setSearch]       = useState('')
  const [filterAccount, setFilterAccount] = useState('all')
  const [selected, setSelected]   = useState(null)

  useEffect(() => { fetchAll() }, [])

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const accountType = localStorage.getItem('oauth_account_type') || 'cold'
    if (code) {
      handleOAuthCallback(code, accountType)
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
      localStorage.removeItem('oauth_account_type')
    }
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: accs }, { data: msgs }] = await Promise.all([
      supabase.from('user_email_accounts').select('*').eq('account_type', 'cold').eq('is_active', true).order('connected_at'),
      supabase.from('gmail_messages').select('*, user_email_accounts(gmail_address, display_name)')
        .order('date', { ascending: false }).limit(200),
    ])
    setAccounts(accs || [])
    // Only show messages from cold accounts
    const coldIds = new Set((accs || []).map(a => a.id))
    setMessages((msgs || []).filter(m => coldIds.has(m.account_id)))
    setLoading(false)
  }

  function connectAccount() {
    if (!GOOGLE_CLIENT_ID) {
      showToast('Google Client ID not configured. Add VITE_GOOGLE_CLIENT_ID to Vercel env vars.', 'error')
      return
    }
    localStorage.setItem('oauth_account_type', 'cold')
    const scopes = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify'
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`
    window.location.href = url
  }

  async function handleOAuthCallback(code, accountType) {
    showToast('Connecting Gmail account…')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: REDIRECT_URI,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          user_id: profile?.id,
          account_type: accountType,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`✓ ${data.email} connected`)
        await fetchAll()
      } else {
        showToast('Connection failed: ' + (data.error || 'Unknown error'), 'error')
      }
    } catch (err) {
      showToast('Connection failed: ' + err.message, 'error')
    }
  }

  async function fetchNewEmails() {
    setFetching(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_type: 'cold',
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          max_results: 30,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`✓ ${data.new_messages} new emails from ${data.accounts} accounts`)
        await fetchAll()
      } else {
        showToast('Fetch failed', 'error')
      }
    } catch (err) {
      showToast('Fetch error: ' + err.message, 'error')
    }
    setFetching(false)
  }

  async function disconnectAccount(id) {
    if (!window.confirm('Disconnect this account?')) return
    await supabase.from('user_email_accounts').update({ is_active: false }).eq('id', id)
    setAccounts(p => p.filter(a => a.id !== id))
    showToast('Account disconnected')
  }

  // Filtering
  const filtered = messages
    .filter(m => {
      if (tab === 'Replies') return m.is_reply
      if (tab === 'Sent') return !m.is_reply
      if (tab === 'Unread') return !m.is_read
      return true
    })
    .filter(m => filterAccount === 'all' || m.account_id === filterAccount)
    .filter(m => {
      if (!search) return true
      const q = search.toLowerCase()
      return (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name || '').toLowerCase().includes(q) ||
             (m.subject || '').toLowerCase().includes(q) ||
             (m.snippet || '').toLowerCase().includes(q)
    })

  const stats = {
    total:   messages.length,
    replies: messages.filter(m => m.is_reply).length,
    unread:  messages.filter(m => !m.is_read).length,
    sent:    messages.filter(m => !m.is_reply).length,
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const getAccountColor = (accId) => {
    const idx = accounts.findIndex(a => a.id === accId)
    return ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length]
  }

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, verticalAlign: 'middle' }
  const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Cold Inbox</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected · {messages.length} emails
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchNewEmails} disabled={fetching || accounts.length === 0}
            style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: fetching ? 0.7 : 1 }}>
            {fetching ? '⏳ Fetching…' : '🔄 Fetch New Emails'}
          </button>
          {isAdmin && (
            <button onClick={connectAccount}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Connect Gmail Account
            </button>
          )}
        </div>
      </div>

      {/* No accounts connected state */}
      {!loading && accounts.length === 0 && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 12, padding: 24, marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📨</div>
          <div style={{ fontWeight: 700, color: C.text, fontSize: 16, marginBottom: 8 }}>No cold email accounts connected</div>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
            Connect your @trymylandlordcertificate.com Gmail accounts to see sent emails and replies.
          </div>
          {isAdmin && (
            <button onClick={connectAccount}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Connect First Account →
            </button>
          )}
          {!isAdmin && <div style={{ color: C.dim, fontSize: 13 }}>Ask your admin to connect the cold email accounts.</div>}
        </div>
      )}

      {/* Connected accounts */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {accounts.map((acc, i) => (
            <div key={acc.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#fff', border: `1px solid ${C.border}`,
              borderLeft: `4px solid ${ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}`,
              borderRadius: 8, padding: '6px 12px',
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{acc.gmail_address}</div>
                <div style={{ fontSize: 10, color: C.dim }}>Connected {acc.connected_at ? new Date(acc.connected_at).toLocaleDateString('en-GB') : ''}</div>
              </div>
              <span style={{ background: C.greenSoft, color: C.greenDark, borderRadius: 20, padding: '2px 6px', fontSize: 9, fontWeight: 700 }}>Active</span>
              {isAdmin && (
                <button onClick={() => disconnectAccount(acc.id)}
                  style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, marginLeft: 4 }}>✕</button>
              )}
            </div>
          ))}
          {isAdmin && accounts.length < 8 && (
            <button onClick={connectAccount}
              style={{ border: `2px dashed ${C.border}`, background: 'none', borderRadius: 8, padding: '6px 16px', color: C.dim, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              + Add Account
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Emails', value: stats.total,   color: C.text },
            { label: 'Replies',      value: stats.replies,  color: C.greenDark },
            { label: 'Unread',       value: stats.unread,   color: C.red },
            { label: 'Sent',         value: stats.sent,     color: C.accent },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: '12px 18px', flex: 1, minWidth: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ color: s.color, fontSize: 20, fontWeight: 800 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + filters */}
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
            {['All', 'Replies', 'Sent', 'Unread'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 700 : 400, background: tab === t ? '#fff' : 'transparent', color: tab === t ? C.accent : C.muted }}>
                {t} {t === 'Replies' && stats.replies > 0 && <span style={{ background: C.greenSoft, color: C.greenDark, borderRadius: 20, padding: '1px 5px', fontSize: 10, fontWeight: 700, marginLeft: 3 }}>{stats.replies}</span>}
                {t === 'Unread' && stats.unread > 0 && <span style={{ background: C.redSoft, color: C.red, borderRadius: 20, padding: '1px 5px', fontSize: 10, fontWeight: 700, marginLeft: 3 }}>{stats.unread}</span>}
              </button>
            ))}
          </div>
          <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.gmail_address}</option>)}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emails…"
            style={{ ...inp, flex: 1, minWidth: 180 }} />
        </div>
      )}

      {/* Email list */}
      {accounts.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
              {messages.length === 0 ? 'No emails yet. Click "Fetch New Emails" to pull from Gmail.' : 'No emails match this filter.'}
            </div>
          ) : (
            <div>
              {filtered.map(msg => (
                <div key={msg.id}
                  onClick={() => setSelected(selected?.id === msg.id ? null : msg)}
                  style={{
                    display: 'flex', gap: 12, padding: '12px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    background: selected?.id === msg.id ? C.accentSoft : msg.is_read ? '#fff' : '#FAFBFF',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { if (selected?.id !== msg.id) e.currentTarget.style.background = C.surface }}
                  onMouseLeave={e => { if (selected?.id !== msg.id) e.currentTarget.style.background = msg.is_read ? '#fff' : '#FAFBFF' }}>

                  {/* Account color dot */}
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: getAccountColor(msg.account_id), flexShrink: 0, marginTop: 6 }} />

                  {/* Reply indicator */}
                  <div style={{ width: 20, flexShrink: 0, marginTop: 2 }}>
                    {msg.is_reply && <span style={{ color: C.greenDark, fontSize: 14, fontWeight: 700 }}>↩</span>}
                  </div>

                  {/* From */}
                  <div style={{ width: 180, flexShrink: 0 }}>
                    <div style={{ fontWeight: msg.is_read ? 400 : 700, color: C.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.from_name || msg.from_email}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.user_email_accounts?.gmail_address || ''}
                    </div>
                  </div>

                  {/* Subject + snippet */}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontWeight: msg.is_read ? 400 : 600, color: C.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.subject || '(No subject)'}
                    </div>
                    <div style={{ fontSize: 12, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.snippet}
                    </div>
                  </div>

                  {/* Date */}
                  <div style={{ width: 100, flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: C.dim }}>{fmtDate(msg.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded email */}
      {selected && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginTop: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>{selected.subject || '(No subject)'}</div>
              <div style={{ fontSize: 13, color: C.muted }}>
                From: <strong>{selected.from_name || selected.from_email}</strong> {'<'}{selected.from_email}{'>'}
              </div>
              <div style={{ fontSize: 13, color: C.muted }}>To: {selected.to_email}</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{selected.date ? new Date(selected.date).toLocaleString('en-GB') : '—'}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', padding: '16px 0', borderTop: `1px solid ${C.border}` }}>
            {selected.snippet || 'No preview available. Open in Gmail for full content.'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <a href={`https://mail.google.com/mail/u/0/#inbox/${selected.gmail_id}`} target="_blank" rel="noreferrer"
              style={{ background: C.accent, color: '#fff', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
              Open in Gmail →
            </a>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
