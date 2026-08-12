import { useState, useEffect, useMemo } from 'react'
import DOMPurify from 'dompurify'
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
// NOTE: never put the Google OAuth client *secret* in a VITE_ env var --
// it gets bundled into the shipped JS. The secret lives only in Supabase's
// server-side secrets; gmail-fetch/gmail-reply read it from there.
const REDIRECT_URI = `${window.location.origin}/inbox/oauth-callback`
const COLORS = ['#0093DB','#80D100','#D97706','#7C3AED','#0D9488','#DC2626','#EC4899','#8B5CF6']

export default function ColdInbox() {
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [accounts, setAccounts] = useState([])
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [fetching, setFetching] = useState(false)
  const [tab, setTab]           = useState('All')
  const [search, setSearch]     = useState('')
  const [filterAccount, setFilterAccount] = useState('all')
  const [selected, setSelected] = useState(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending]     = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: accs }, { data: msgs }] = await Promise.all([
      supabase.from('user_email_accounts').select('*').eq('account_type', 'cold').eq('is_active', true).order('connected_at'),
      supabase.from('gmail_messages').select('*, user_email_accounts(gmail_address)')
        .order('date', { ascending: false }).limit(500),
    ])
    setAccounts(accs || [])
    const coldIds = new Set((accs || []).map(a => a.id))
    setMessages((msgs || []).filter(m => coldIds.has(m.account_id)))
    setLoading(false)
  }

  function connectAccount() {
    if (!GOOGLE_CLIENT_ID) { showToast('VITE_GOOGLE_CLIENT_ID not set in Vercel', 'error'); return }
    localStorage.setItem('oauth_account_type', 'cold')
    const scopes = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify'
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`
  }

  async function fetchNewEmails() {
    setFetching(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: 'cold', client_id: GOOGLE_CLIENT_ID, max_results: 30 }),
      })
      const data = await res.json()
      showToast(data.ok ? `✓ ${data.new_messages} new emails from ${data.accounts} accounts` : 'Fetch failed', data.ok ? undefined : 'error')
      if (data.ok) await fetchAll()
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    setFetching(false)
  }

  async function sendReply() {
    if (!replyText.trim() || !selected) return
    setSending(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selected.account_id,
          thread_id: selected.thread_id,
          to: selected.from_email,
          subject: selected.subject,
          message: replyText,
          client_id: GOOGLE_CLIENT_ID,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast('✓ Reply sent')
        setReplyOpen(false); setReplyText('')
        await fetchAll()
      } else {
        showToast('Failed: ' + (data.error || 'Unknown'), 'error')
      }
    } catch (err) { showToast('Error: ' + err.message, 'error') }
    setSending(false)
  }

  async function disconnectAccount(id) {
    if (!window.confirm('Disconnect this account?')) return
    await supabase.from('user_email_accounts').update({ is_active: false }).eq('id', id)
    setAccounts(p => p.filter(a => a.id !== id))
    showToast('Disconnected')
  }

  const filtered = messages
    .filter(m => tab === 'All' || (tab === 'Inbox' && m.mail_type === 'inbox') || (tab === 'Sent' && m.mail_type === 'sent') || (tab === 'Unread' && !m.is_read) || (tab === 'Replies' && m.is_reply))
    .filter(m => filterAccount === 'all' || m.account_id === filterAccount)
    .filter(m => { if (!search) return true; const q = search.toLowerCase(); return (m.from_email||'').toLowerCase().includes(q)||(m.from_name||'').toLowerCase().includes(q)||(m.subject||'').toLowerCase().includes(q)||(m.snippet||'').toLowerCase().includes(q)||(m.to_email||'').toLowerCase().includes(q) })

  const threads = useMemo(() => {
    const threadMap = {}
    filtered.forEach(m => {
      const key = m.thread_id || m.gmail_id
      if (!threadMap[key]) threadMap[key] = { latest: m, count: 1, hasReply: m.is_reply }
      else {
        threadMap[key].count++
        if (new Date(m.date) > new Date(threadMap[key].latest.date)) threadMap[key].latest = m
        if (m.is_reply) threadMap[key].hasReply = true
      }
    })
    return Object.values(threadMap).sort((a,b) => new Date(b.latest.date) - new Date(a.latest.date))
  }, [filtered])

  const stats = { total: messages.length, inbox: messages.filter(m=>m.mail_type==='inbox').length, sent: messages.filter(m=>m.mail_type==='sent').length, replies: messages.filter(m=>m.is_reply).length, unread: messages.filter(m=>!m.is_read).length }
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'
  const getColor = accId => { const i = accounts.findIndex(a=>a.id===accId); return COLORS[i%COLORS.length] }
  const inp = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, color:C.text, padding:'8px 12px', fontSize:13 }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:C.text }}>Cold Inbox</h1>
          <div style={{ color:C.muted, fontSize:13, marginTop:2 }}>{accounts.length} accounts · {stats.total} emails</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={fetchNewEmails} disabled={fetching||!accounts.length}
            style={{ background:C.accentSoft, color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:8, padding:'8px 16px', fontWeight:600, fontSize:13, cursor:'pointer', opacity:fetching?0.7:1 }}>
            {fetching ? '⏳ Fetching…' : '🔄 Fetch Emails'}
          </button>
          {isAdmin && <button onClick={connectAccount} style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'8px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>+ Connect Account</button>}
        </div>
      </div>

      {/* Accounts */}
      {accounts.length > 0 && (
        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          {accounts.map((acc,i) => (
            <div key={acc.id} style={{ display:'flex', alignItems:'center', gap:8, background:'#fff', border:`1px solid ${C.border}`, borderLeft:`4px solid ${COLORS[i%COLORS.length]}`, borderRadius:8, padding:'6px 12px' }}>
              <span style={{ fontSize:12, fontWeight:600, color:C.text }}>{acc.gmail_address}</span>
              <span style={{ background:C.greenSoft, color:C.greenDark, borderRadius:20, padding:'1px 6px', fontSize:9, fontWeight:700 }}>Active</span>
              {isAdmin && <button onClick={() => disconnectAccount(acc.id)} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:14 }}>✕</button>}
            </div>
          ))}
          {isAdmin && accounts.length < 8 && <button onClick={connectAccount} style={{ border:`2px dashed ${C.border}`, background:'none', borderRadius:8, padding:'6px 16px', color:C.dim, cursor:'pointer', fontSize:12, fontWeight:600 }}>+ Add</button>}
        </div>
      )}

      {/* No accounts */}
      {!loading && !accounts.length && (
        <div style={{ background:C.amberSoft, border:`1px solid ${C.amber}44`, borderRadius:12, padding:24, textAlign:'center', marginBottom:20 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📨</div>
          <div style={{ fontWeight:700, color:C.text, fontSize:16, marginBottom:8 }}>No cold email accounts connected</div>
          <div style={{ color:C.muted, fontSize:13, marginBottom:16 }}>Connect your @trymylandlordcertificate.com accounts.</div>
          {isAdmin && <button onClick={connectAccount} style={{ background:C.accent, color:'#fff', border:'none', borderRadius:10, padding:'10px 24px', fontWeight:700, fontSize:14, cursor:'pointer' }}>Connect First Account →</button>}
        </div>
      )}

      {/* Stats */}
      {accounts.length > 0 && (
        <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
          {[{l:'Total',v:stats.total,c:C.text},{l:'Inbox',v:stats.inbox,c:C.accent},{l:'Sent',v:stats.sent,c:C.purple},{l:'Replies',v:stats.replies,c:C.greenDark},{l:'Unread',v:stats.unread,c:C.red}].map(s=>(
            <div key={s.l} style={{ background:'#fff', border:`1px solid ${C.border}`, borderTop:`3px solid ${s.c}`, borderRadius:10, padding:'12px 18px', flex:1, minWidth:90 }}>
              <div style={{ color:C.muted, fontSize:10, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{s.l}</div>
              <div style={{ color:s.c, fontSize:20, fontWeight:800 }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + filters */}
      {accounts.length > 0 && (
        <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:4, background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:4 }}>
            {['All','Inbox','Sent','Replies','Unread'].map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{ padding:'6px 14px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:tab===t?700:400, background:tab===t?'#fff':'transparent', color:tab===t?C.accent:C.muted }}>{t}</button>
            ))}
          </div>
          <select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)} style={{...inp,width:'auto'}}>
            <option value="all">All Accounts</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.gmail_address}</option>)}
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...inp,flex:1,minWidth:180}} />
        </div>
      )}

      {/* Two-pane layout: email list + reading pane */}
      {accounts.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap:16 }}>
          {/* Email list */}
          <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', maxHeight:'70vh', overflowY:'auto' }}>
            {loading ? <div style={{ padding:48, textAlign:'center', color:C.muted }}>Loading…</div> :
            threads.length === 0 ? <div style={{ padding:48, textAlign:'center', color:C.muted }}>{messages.length===0?'Click "Fetch Emails" to load.':'No match.'}</div> :
            threads.map(t => {
              const msg = t.latest
              return (
              <div key={msg.id} onClick={()=>setSelected(msg)}
                style={{ display:'flex', gap:10, padding:'10px 14px', borderBottom:`1px solid ${C.border}`, background:selected?.id===msg.id?C.accentSoft:msg.is_read?'#fff':'#F8FAFF', cursor:'pointer' }}
                onMouseEnter={e=>{if(selected?.id!==msg.id)e.currentTarget.style.background=C.surface}}
                onMouseLeave={e=>{if(selected?.id!==msg.id)e.currentTarget.style.background=msg.is_read?'#fff':'#F8FAFF'}}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:getColor(msg.account_id), flexShrink:0, marginTop:6 }} />
                <div style={{ width:16, flexShrink:0 }}>
                  {msg.mail_type==='sent' ? <span style={{ color:C.purple, fontSize:11 }}>↗</span> : msg.is_reply ? <span style={{ color:C.greenDark, fontSize:11 }}>↩</span> : null}
                </div>
                <div style={{ flex:1, overflow:'hidden' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <span style={{ fontWeight:msg.is_read?400:700, color:C.text, fontSize:13 }}>{msg.mail_type==='sent'?`To: ${msg.to_email}`:(msg.from_name||msg.from_email)}</span>
                      {t.count > 1 && <span style={{ background:'#E6F4FC', color:'#0093DB', borderRadius:20, padding:'1px 6px', fontSize:10, fontWeight:700, marginLeft:6 }}>{t.count}</span>}
                    </span>
                    <span style={{ fontSize:10, color:C.dim, flexShrink:0 }}>{fmtDate(msg.date)}</span>
                  </div>
                  <div style={{ fontWeight:msg.is_read?400:600, color:C.text, fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{msg.subject||'(No subject)'}</div>
                  <div style={{ fontSize:11, color:C.dim, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{msg.snippet}</div>
                </div>
              </div>
              )
            })}
          </div>

          {/* Reading pane */}
          {selected && (
            <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column', maxHeight:'70vh' }}>
              {/* Email header */}
              <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{selected.subject||'(No subject)'}</div>
                  <button onClick={()=>{setSelected(null);setReplyOpen(false)}} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18 }}>✕</button>
                </div>
                <div style={{ fontSize:13, color:C.muted }}>
                  <strong>From:</strong> {selected.from_name ? `${selected.from_name} <${selected.from_email}>` : selected.from_email}
                </div>
                <div style={{ fontSize:13, color:C.muted }}><strong>To:</strong> {selected.to_email}</div>
                <div style={{ fontSize:12, color:C.dim, marginTop:4 }}>
                  {selected.date ? new Date(selected.date).toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}
                </div>
                <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                  via {selected.user_email_accounts?.gmail_address || 'unknown account'}
                </div>
              </div>

              {/* Email body */}
              <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
                {selected.body_html ? (
                  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.body_html) }}
                    style={{ fontSize:14, lineHeight:1.7, color:C.text, wordBreak:'break-word' }} />
                ) : selected.body_text ? (
                  <pre style={{ fontSize:14, lineHeight:1.7, color:C.text, whiteSpace:'pre-wrap', fontFamily:'inherit', margin:0 }}>{selected.body_text}</pre>
                ) : (
                  <p style={{ color:C.muted, fontSize:14 }}>{selected.snippet || 'No content available.'}</p>
                )}
              </div>

              {/* Reply section */}
              <div style={{ borderTop:`1px solid ${C.border}`, padding:'12px 20px', flexShrink:0 }}>
                {!replyOpen ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={()=>setReplyOpen(true)}
                      style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'8px 20px', fontWeight:600, fontSize:13, cursor:'pointer', flex:1 }}>
                      ↩ Reply
                    </button>
                    <a href={`https://mail.google.com/mail/u/0/#inbox/${selected.gmail_id}`} target="_blank" rel="noreferrer"
                      style={{ background:C.surface, color:C.muted, border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 16px', fontWeight:600, fontSize:13, textDecoration:'none', textAlign:'center' }}>
                      Open in Gmail
                    </a>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Replying to {selected.from_email} via {accounts.find(a=>a.id===selected.account_id)?.gmail_address}</div>
                    <textarea value={replyText} onChange={e=>setReplyText(e.target.value)} rows={5}
                      placeholder="Type your reply…"
                      style={{ width:'100%', background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, color:C.text, padding:'10px 12px', fontSize:14, resize:'vertical', fontFamily:'inherit', lineHeight:1.6, marginBottom:8 }} />
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={sendReply} disabled={sending||!replyText.trim()}
                        style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'8px 20px', fontWeight:600, fontSize:13, cursor:'pointer', opacity:sending?0.7:1 }}>
                        {sending ? 'Sending…' : '📤 Send Reply'}
                      </button>
                      <button onClick={()=>{setReplyOpen(false);setReplyText('')}}
                        style={{ background:'#fff', color:C.muted, border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
