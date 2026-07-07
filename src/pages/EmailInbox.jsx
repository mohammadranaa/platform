import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast'
import AIEmailComposer from '../components/AIEmailComposer'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', surface2: '#EAECF0', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: '#0093DB', color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB' },
    danger:  { background: '#FEE2E2', color: '#DC2626', border: '1px solid #DC262644' },
    success: { background: '#F0FAE0', color: '#3d7a00', border: '1px solid #80D10066' },
    amber:   { background: '#FEF3C7', color: '#D97706', border: '1px solid #D9770666' },
    teal:    { background: '#CCFBF1', color: '#0D9488', border: '1px solid #0D948866' },
    purple:  { background: '#EDE9FE', color: '#7C3AED', border: '1px solid #7C3AED66' },
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8, fontWeight: 600,
        padding: small ? '6px 13px' : '9px 18px', fontSize: small ? 12 : 14,
        opacity: disabled ? 0.5 : 1, ...v[variant], ...sx }}>
      {children}
    </button>
  )
}

// ── Gmail OAuth URL builder ───────────────────────────────────
function getGmailOAuthUrl() {
  const clientId    = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const redirectUri = `${window.location.origin}/inbox/oauth-callback`
  const scope = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' ')
  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`
}

export default function EmailInbox() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [accounts, setAccounts]     = useState([])
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [threads, setThreads]       = useState([])
  const [selectedThread, setSelectedThread] = useState(null)
  const [messages, setMessages]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [showCompose, setShowCompose] = useState(false)
  const [filter, setFilter]         = useState('all') // all | unread | sent | campaign

  useEffect(() => { fetchAccounts() }, [])

  useEffect(() => {
    if (selectedAccount) fetchThreads(selectedAccount.id)
  }, [selectedAccount, filter])

  useEffect(() => {
    if (selectedThread) fetchMessages(selectedThread.id)
  }, [selectedThread])

  async function fetchAccounts() {
    setLoading(true)
    const { data } = await supabase
      .from('user_email_accounts')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_active', true)
    setAccounts(data || [])
    if (data?.length > 0) setSelectedAccount(data[0])
    setLoading(false)
  }

  async function fetchThreads(accountId) {
    let q = supabase
      .from('email_threads')
      .select('*, clients(first_name, last_name, company_name)')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false })
      .limit(50)

    if (filter === 'unread') q = q.eq('has_unread', true)
    if (filter === 'campaign') q = q.eq('thread_type', 'campaign')

    const { data } = await q
    setThreads(data || [])
  }

  async function fetchMessages(threadId) {
    const { data } = await supabase
      .from('email_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
    setMessages(data || [])

    // Mark thread as read
    await supabase.from('email_threads').update({ has_unread: false }).eq('id', threadId)
    setThreads(p => p.map(t => t.id === threadId ? { ...t, has_unread: false } : t))
  }

  async function handleSendEmail({ to, subject, body, aiAssisted }) {
    if (!selectedAccount) return

    try {
      // Send via Gmail API using stored token
      const { data: account } = await supabase
        .from('user_email_accounts')
        .select('*')
        .eq('id', selectedAccount.id)
        .single()

      // Build RFC 2822 message
      const emailLines = [
        `From: ${account.display_name || account.gmail_address} <${account.gmail_address}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        body.replace(/\n/g, '<br>'),
      ]
      const raw = btoa(emailLines.join('\r\n'))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      // Call Gmail API send endpoint
      const threadId = selectedThread?.gmail_thread_id
      const sendUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw,
          ...(threadId ? { threadId } : {}),
        }),
      })

      if (!res.ok) throw new Error('Gmail send failed')

      const sentMsg = await res.json()

      // Store in our DB
      let threadRecord = selectedThread
      if (!threadRecord) {
        const { data: newThread } = await supabase.from('email_threads').insert({
          account_id: selectedAccount.id,
          subject,
          participants: [to, account.gmail_address],
          last_message_at: new Date().toISOString(),
          message_count: 1,
          thread_type: 'outbound',
          gmail_thread_id: sentMsg.threadId,
        }).select().single()
        threadRecord = newThread
      }

      await supabase.from('email_messages').insert({
        thread_id:       threadRecord.id,
        gmail_message_id: sentMsg.id,
        from_address:    account.gmail_address,
        from_name:       account.display_name || account.gmail_address,
        to_addresses:    [to],
        subject,
        body_text:       body,
        body_html:       body.replace(/\n/g, '<br>'),
        direction:       'outbound',
        is_read:         true,
        ai_assisted:     aiAssisted,
        sent_at:         new Date().toISOString(),
      })

      await fetchThreads(selectedAccount.id)
      setShowCompose(false)
      showToast('Email sent ✓')
    } catch (err) {
      console.error('Send error:', err)
      showToast('Failed to send email — check Gmail connection', 'error')
    }
  }

  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim()
  const timeAgo = (d) => {
    const diff = Date.now() - new Date(d).getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // ── No account connected ──────────────────────────────────────
  if (!loading && accounts.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Email Inbox</h1>
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 60, textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📬</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Connect your Gmail account</div>
          <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
            Connect your Gmail account to send and receive emails directly inside the MLC platform.
          </div>

          {/* Gmail OAuth Setup Guide */}
          <div style={{ background: '#FEF3C7', border: '1px solid #D97706', borderRadius: 12, padding: 20, marginBottom: 24, textAlign: 'left', maxWidth: 500 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#D97706', marginBottom: 10 }}>⚠ Before connecting: Set up Google OAuth</div>
            <div style={{ fontSize: 13, color: '#1F2937', lineHeight: 1.8 }}>
              <strong>Step 1:</strong> Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: '#0093DB' }}>console.cloud.google.com</a><br/>
              <strong>Step 2:</strong> Select your MLC Platform project → APIs & Services → Credentials<br/>
              <strong>Step 3:</strong> Click your OAuth Client ID → Add Authorised redirect URIs:<br/>
              <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>{window.location.origin}/inbox/oauth-callback</code><br/>
              <strong>Step 4:</strong> Add <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>VITE_GOOGLE_CLIENT_ID</code> to your .env file<br/>
              <strong>Step 5:</strong> Redeploy on Vercel with the Google Client ID env variable set
            </div>
          </div>

          <a href={getGmailOAuthUrl()} style={{ display: 'inline-block', background: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: 10, padding: '12px 24px', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
            <img src="https://www.google.com/favicon.ico" width="16" style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Connect Gmail Account
          </a>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 12 }}>
            Error 401 invalid_client means the Google Client ID is not configured yet.
          </div>
        </div>
        <Toast toast={toast} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Email Inbox</h1>
          {accounts.length > 1 && (
            <select
              value={selectedAccount?.id}
              onChange={e => setSelectedAccount(accounts.find(a => a.id === e.target.value))}
              style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '6px 12px', fontSize: 13 }}
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.gmail_address}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="ghost" onClick={() => selectedAccount && fetchThreads(selectedAccount.id)}>↻ Refresh</Btn>
          <Btn small variant="purple" onClick={() => setShowCompose(true)}>✦ Compose with AI</Btn>
          <a href={getGmailOAuthUrl()} style={{ display: 'inline-block', background: 'transparent', border: '1px solid #E5E7EB', color: C.muted, borderRadius: 8, padding: '6px 13px', fontSize: 12, fontWeight: 600 }}>
            + Add Account
          </a>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: 16, minHeight: 0 }}>

        {/* ── Thread list ─────────────────────────────────── */}
        <div style={{ width: 320, flexShrink: 0, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Filter tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA' }}>
            {[['all','All'],['unread','Unread'],['campaign','Campaign']].map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{ flex: 1, padding: '10px', border: 'none', background: filter === key ? C.surface : 'transparent', color: filter === key ? C.text : C.dim, cursor: 'pointer', fontSize: 13, fontWeight: filter === key ? 600 : 400, borderBottom: filter === key ? `2px solid ${C.accent}` : '2px solid transparent' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Thread list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
            ) : threads.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>No emails yet.</div>
            ) : threads.map(thread => (
              <div
                key={thread.id}
                onClick={() => setSelectedThread(thread)}
                style={{
                  padding: '12px 16px',
                  borderBottom: `1px solid ${C.border}18`,
                  cursor: 'pointer',
                  background: selectedThread?.id === thread.id ? C.accentSoft : thread.has_unread ? C.surface2 : 'transparent',
                  borderLeft: selectedThread?.id === thread.id ? `3px solid ${C.accent}` : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontWeight: thread.has_unread ? 700 : 500, fontSize: 13, color: C.text }} className="truncate" style2={{ maxWidth: 180 }}>
                    {thread.participants?.find(p => p !== selectedAccount?.gmail_address) || thread.participants?.[0]}
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, flexShrink: 0, marginLeft: 8 }}>{timeAgo(thread.last_message_at)}</div>
                </div>
                <div style={{ fontSize: 13, color: thread.has_unread ? C.text : C.muted, fontWeight: thread.has_unread ? 600 : 400 }} className="truncate">
                  {thread.subject || '(no subject)'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                  {thread.clients && (
                    <span style={{ background: C.accent + '22', color: C.accent, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>
                      {clientName(thread.clients)}
                    </span>
                  )}
                  {thread.thread_type === 'campaign' && (
                    <span style={{ background: C.amber + '22', color: C.amber, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>Campaign</span>
                  )}
                  {thread.has_unread && (
                    <span style={{ background: C.accent, color: '#fff', borderRadius: '50%', width: 8, height: 8, display: 'inline-block', alignSelf: 'center' }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Thread detail ───────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!selectedThread ? (
            <div style={{ flex: 1, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 40 }}>✉️</div>
              <div style={{ color: C.muted, fontSize: 14 }}>Select a thread to read it</div>
              <Btn small variant="purple" onClick={() => setShowCompose(true)}>✦ Compose new email</Btn>
            </div>
          ) : (
            <div style={{ flex: 1, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Thread header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{selectedThread.subject || '(no subject)'}</div>
                <div style={{ color: C.muted, fontSize: 13 }}>
                  {selectedThread.message_count} message{selectedThread.message_count !== 1 ? 's' : ''} ·{' '}
                  {selectedThread.participants?.join(', ')}
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {messages.map(msg => (
                  <div key={msg.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.direction === 'outbound' ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{ fontSize: 11, color: C.dim, marginBottom: 4, display: 'flex', gap: 8 }}>
                      <span>{msg.from_name || msg.from_address}</span>
                      <span>{new Date(msg.sent_at || msg.received_at || msg.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {msg.ai_assisted && <span style={{ color: C.purple }}>✦ AI assisted</span>}
                    </div>
                    <div style={{
                      background: msg.direction === 'outbound' ? C.accentSoft : C.bg,
                      border: `1px solid ${msg.direction === 'outbound' ? C.accent + '44' : C.border}`,
                      borderRadius: msg.direction === 'outbound' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                      padding: '12px 16px',
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: C.text,
                      maxWidth: '80%',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {msg.body_text || '(no content)'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply compose */}
              <div style={{ borderTop: '1px solid #E5E7EB', padding: 16 }}>
                <AIEmailComposer
                  context={{ type: 'inbox_compose', name: selectedThread.subject }}
                  onSend={handleSendEmail}
                  initialTo={selectedThread.participants?.find(p => p !== selectedAccount?.gmail_address)}
                  initialSubject={`Re: ${selectedThread.subject}`}
                  compact
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowCompose(false)}>
          <div style={{ width: 680, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <AIEmailComposer
              context={{ type: 'inbox_compose' }}
              onSend={handleSendEmail}
              onClose={() => setShowCompose(false)}
            />
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
