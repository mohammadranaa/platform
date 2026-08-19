import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
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
  teal: '#0D9488', tealSoft: '#CCFBF1',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const NUACOM_API = 'https://api.nuacom.com/v1'
const API_KEY    = '457594673ec8b9f6b3e04c86b7e20f13'
const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL || 'https://fyjgtwupzpeivdedoutj.supabase.co'}/functions/v1/nuacom-webhook`

function getDateRange(period) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'today') {
    return { from: today.toISOString(), to: new Date(today.getTime() + 86400000).toISOString(), label: 'Today' }
  }
  if (period === 'yesterday') {
    const y = new Date(today.getTime() - 86400000)
    return { from: y.toISOString(), to: today.toISOString(), label: 'Yesterday' }
  }
  if (period === 'week') {
    const mon = new Date(today)
    mon.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    return { from: mon.toISOString(), to: new Date(today.getTime() + 86400000).toISOString(), label: 'This Week' }
  }
  if (period === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: first.toISOString(), to: new Date(today.getTime() + 86400000).toISOString(), label: 'This Month' }
  }
  if (period === 'last30') {
    const d = new Date(today.getTime() - 30 * 86400000)
    return { from: d.toISOString(), to: new Date(today.getTime() + 86400000).toISOString(), label: 'Last 30 Days' }
  }
  return { from: null, to: null, label: 'All Time' }
}

export default function NuacomDialer() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const audioRef = useRef(null)

  const [calls, setCalls]             = useState([])
  const [profiles, setProfiles]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [registering, setRegistering] = useState(false)
  const [webhookStatus, setWebhookStatus] = useState(null)

  // Filters
  const [filterDir, setFilterDir]       = useState('all')
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [filterRep, setFilterRep]       = useState('all')
  const [filterAnswered, setFilterAnswered] = useState('all')
  const [search, setSearch]             = useState('')

  // Recording player
  const [playingId, setPlayingId]       = useState(null)

  // Phone match lookups — { [number]: matches[] } from match_phone(), fetched
  // once per unique number and cached (not per row/render) since a call list
  // can be hundreds of rows with many repeat callers.
  const [phoneMatches, setPhoneMatches] = useState({})
  const fetchedNumbersRef = useRef(new Set())

  useEffect(() => { fetchAll() }, [filterPeriod])

  useEffect(() => {
    const channel = supabase
      .channel('nuacom_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nuacom_calls' }, payload => {
        setCalls(p => [payload.new, ...p])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const numbers = new Set()
    calls.forEach(c => {
      const num = c.call_direction === 'inbound'
        ? (c.call_caller_number || c.call_caller_number_local)
        : (c.call_callee_number || c.call_callee_number_local)
      if (num && !fetchedNumbersRef.current.has(num)) numbers.add(num)
    })
    if (numbers.size === 0) return
    numbers.forEach(n => fetchedNumbersRef.current.add(n))
    Promise.all([...numbers].map(async n => {
      const { data } = await supabase.rpc('match_phone', { p_number: n })
      return [n, data || []]
    })).then(results => {
      setPhoneMatches(prev => {
        const next = { ...prev }
        results.forEach(([n, data]) => { next[n] = data })
        return next
      })
    })
  }, [calls])

  async function fetchAll() {
    setLoading(true)
    const range = getDateRange(filterPeriod)

    let q = supabase.from('nuacom_calls').select('*').order('created_at', { ascending: false }).limit(500)
    if (range.from) q = q.gte('created_at', range.from)
    if (range.to)   q = q.lt('created_at', range.to)

    const [{ data: callData }, { data: profData }] = await Promise.all([
      q,
      supabase.from('profiles').select('id, full_name').eq('is_active', true),
    ])
    setCalls(callData || [])
    setProfiles(profData || [])
    setLoading(false)
  }

  async function registerWebhook() {
    setRegistering(true)
    const events = ['call_event', 'inbound_call_event', 'inbound_missed_call_event', 'outbound_call_event', 'outbound_answered_call_event']
    let ok = 0
    for (const type of events) {
      try {
        const res = await fetch(`${NUACOM_API}/webhooks/subscriptions`, {
          method: 'POST',
          headers: { 'X-Nuacom-Token': API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, url: WEBHOOK_URL }),
        })
        if (res.ok || res.status === 201) ok++
      } catch {}
    }
    setWebhookStatus('registered')
    showToast(`✓ ${ok}/${events.length} webhooks registered`)
    setRegistering(false)
  }

  // Play / pause recording
  function toggleRecording(call) {
    if (playingId === call.id) {
      audioRef.current?.pause()
      setPlayingId(null)
    } else {
      if (audioRef.current) audioRef.current.pause()
      setPlayingId(call.id)
    }
  }

  // Filtering
  const filtered = calls
    .filter(c => filterDir === 'all' || c.call_direction === filterDir)
    .filter(c => filterAnswered === 'all' || (filterAnswered === 'answered' ? c.call_answered : !c.call_answered))
    .filter(c => filterRep === 'all' || c.call_answered_by === filterRep || c.call_initiated_by === filterRep)
    .filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return (c.call_caller_name || '').toLowerCase().includes(q) ||
             (c.call_caller_number_local || '').includes(q) ||
             (c.call_callee_number_local || '').includes(q) ||
             (c.call_callee_name || '').toLowerCase().includes(q)
    })

  // Stats
  const stats = {
    total:     filtered.length,
    inbound:   filtered.filter(c => c.call_direction === 'inbound').length,
    outbound:  filtered.filter(c => c.call_direction === 'outbound').length,
    missed:    filtered.filter(c => !c.call_answered && c.call_direction === 'inbound').length,
    answered:  filtered.filter(c => c.call_answered).length,
    totalDuration: filtered.reduce((s, c) => s + (c.duration_seconds || 0), 0),
    withRecording: filtered.filter(c => c.recording_url).length,
  }

  // Rep breakdown
  const repBreakdown = {}
  filtered.forEach(c => {
    const rep = c.call_answered_by || c.call_initiated_by || 'Unknown'
    if (!repBreakdown[rep]) repBreakdown[rep] = { total: 0, inbound: 0, outbound: 0, missed: 0, duration: 0 }
    repBreakdown[rep].total++
    if (c.call_direction === 'inbound') repBreakdown[rep].inbound++
    if (c.call_direction === 'outbound') repBreakdown[rep].outbound++
    if (!c.call_answered && c.call_direction === 'inbound') repBreakdown[rep].missed++
    repBreakdown[rep].duration += (c.duration_seconds || 0)
  })

  // Unique extensions/reps from call data
  const repOptions = [...new Set(calls.map(c => c.call_answered_by || c.call_initiated_by).filter(Boolean))]

  const fmtTime = d => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const fmtDur = s => !s || s <= 0 ? '—' : s >= 3600 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m` : s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`
  const fmtTotalDur = s => s >= 3600 ? `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m` : `${Math.floor(s/60)}m`

  const range = getDateRange(filterPeriod)
  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, verticalAlign: 'middle' }
  const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }

  return (
    <div>
      {/* Hidden audio player */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>NUACOM Calls</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{range.label} · {filtered.length} calls</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://chrome.google.com/webstore/search/nuacom" target="_blank" rel="noreferrer"
            style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '8px 14px', fontWeight: 600, fontSize: 12, textDecoration: 'none' }}>
            📞 Install Chrome Extension
          </a>
          {isAdmin && (
            <button onClick={registerWebhook} disabled={registering}
              style={{ background: webhookStatus === 'registered' ? C.greenSoft : C.accent, color: webhookStatus === 'registered' ? C.greenDark : '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              {registering ? 'Registering…' : webhookStatus === 'registered' ? '✓ Webhooks Active' : '🔗 Register Webhooks'}
            </button>
          )}
        </div>
      </div>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, marginBottom: 16, width: 'fit-content' }}>
        {[['all','All Time'],['today','Today'],['yesterday','Yesterday'],['week','This Week'],['month','This Month'],['last30','Last 30 Days']].map(([k, l]) => (
          <button key={k} onClick={() => setFilterPeriod(k)}
            style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: filterPeriod === k ? 700 : 400, background: filterPeriod === k ? '#fff' : 'transparent', color: filterPeriod === k ? C.accent : C.muted }}>
            {l}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Calls',    value: stats.total,                  color: C.text },
          { label: 'Inbound',        value: stats.inbound,                color: C.accent },
          { label: 'Outbound',       value: stats.outbound,               color: C.purple },
          { label: 'Missed',         value: stats.missed,                 color: C.red },
          { label: 'Answered',       value: stats.answered,               color: C.greenDark },
          { label: 'Total Talk Time', value: fmtTotalDur(stats.totalDuration), color: C.teal },
          { label: 'Recordings',     value: stats.withRecording,          color: C.amber },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: '12px 16px', flex: 1, minWidth: 90, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 18, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Rep breakdown table */}
      {Object.keys(repBreakdown).length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 20, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Performance by Rep / Extension
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Rep / Extension', 'Total', 'Inbound', 'Outbound', 'Missed', 'Talk Time'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(repBreakdown).sort((a, b) => b[1].total - a[1].total).map(([rep, data]) => (
                <tr key={rep}>
                  <td style={{ ...td, fontWeight: 600, color: C.text }}>
                    {rep === 'Unknown' ? <span style={{ color: C.dim }}>Unknown</span> : `Ext. ${rep}`}
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: C.accent }}>{data.total}</td>
                  <td style={{ ...td, color: C.accent }}>{data.inbound}</td>
                  <td style={{ ...td, color: C.purple }}>{data.outbound}</td>
                  <td style={{ ...td, color: data.missed > 0 ? C.red : C.dim, fontWeight: data.missed > 0 ? 700 : 400 }}>{data.missed}</td>
                  <td style={{ ...td, color: C.teal }}>{fmtDur(data.duration)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or number…"
          style={{ ...inp, flex: 1, minWidth: 200 }} />
        <select value={filterDir} onChange={e => setFilterDir(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="all">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
        <select value={filterAnswered} onChange={e => setFilterAnswered(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="all">All Calls</option>
          <option value="answered">Answered</option>
          <option value="missed">Missed</option>
        </select>
        <select value={filterRep} onChange={e => setFilterRep(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="all">All Reps</option>
          {repOptions.map(r => <option key={r} value={r}>Ext. {r}</option>)}
        </select>
      </div>

      {/* Calls table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading calls…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            {calls.length === 0 ? 'No calls yet. Register the webhook above to start receiving calls.' : 'No calls match this filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Direction', 'Caller', 'Callee', 'Rep', 'Status', 'Duration', 'Time', 'Recording', 'Matched'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(call => {
                const isInbound = call.call_direction === 'inbound'
                const isMissed  = !call.call_answered && isInbound
                const dirColor  = isMissed ? C.red : isInbound ? C.accent : C.purple
                const dirBg     = isMissed ? C.redSoft : isInbound ? C.accentSoft : C.purpleSoft
                const isPlaying = playingId === call.id
                const callNum = call.call_direction === 'inbound'
                  ? (call.call_caller_number || call.call_caller_number_local)
                  : (call.call_callee_number || call.call_callee_number_local)
                const matches = phoneMatches[callNum] || []

                return (
                  <tr key={call.id}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}>
                      <span style={{ background: dirBg, color: dirColor, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {isMissed ? '✕ Missed' : isInbound ? '↙ In' : '↗ Out'}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{call.call_caller_name || '—'}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>{call.call_caller_number_local || call.call_caller_number || '—'}</div>
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 13, color: C.text }}>{call.call_callee_name || '—'}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>{call.call_callee_number_local || '—'}</div>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 12, color: C.muted }}>
                        {call.call_answered_by ? `Ext. ${call.call_answered_by}` : call.call_initiated_by ? `Ext. ${call.call_initiated_by}` : '—'}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ background: call.call_answered ? C.greenSoft : C.redSoft, color: call.call_answered ? C.greenDark : C.red, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {call.call_answered ? 'Answered' : 'Missed'}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ color: call.duration_seconds > 0 ? C.text : C.dim, fontSize: 13, fontWeight: call.duration_seconds > 60 ? 600 : 400 }}>
                        {fmtDur(call.duration_seconds)}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 12, color: C.dim }}>{fmtTime(call.call_at || call.created_at)}</div>
                    </td>
                    <td style={td}>
                      {call.recording_url ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <button onClick={() => toggleRecording(call)}
                            style={{ background: isPlaying ? C.redSoft : C.accentSoft, color: isPlaying ? C.red : C.accent, border: `1px solid ${isPlaying ? C.red : C.accent}44`, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isPlaying ? '⏸ Pause' : '▶ Play'}
                          </button>
                          {isPlaying && (
                            <audio src={call.recording_url} autoPlay
                              ref={el => { if (el && isPlaying) audioRef.current = el }}
                              onEnded={() => setPlayingId(null)}
                              style={{ width: 140, height: 28 }}
                              controls />
                          )}
                        </div>
                      ) : (
                        <span style={{ color: C.dim, fontSize: 11 }}>No recording</span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {matches.length === 0 ? (
                          <span style={{ color: C.dim, fontSize: 11 }}>—</span>
                        ) : matches.map((m, i) => (
                          <button key={i} onClick={() => navigate(m.link)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              background: m.entity_type === 'client' ? C.accentSoft : m.entity_type === 'lead' ? C.greenSoft : C.amberSoft,
                              color: m.entity_type === 'client' ? C.accent : m.entity_type === 'lead' ? C.greenDark : C.amber,
                              border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600,
                            }}>
                            {m.entity_type === 'client' ? '👤' : m.entity_type === 'lead' ? '📋' : '🏠'} {m.entity_name}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  )
}
