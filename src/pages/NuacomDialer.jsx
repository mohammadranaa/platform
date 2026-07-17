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
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const NUACOM_API = 'https://api.nuacom.com/v1'
const API_KEY    = '457594673ec8b9f6b3e04c86b7e20f13'
// Replace with your actual Supabase project URL after deploying the edge function
const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nuacom-webhook`

export default function NuacomDialer() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [calls, setCalls]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [registering, setRegistering] = useState(false)
  const [webhookStatus, setWebhookStatus] = useState(null)
  const [filterDir, setFilterDir]   = useState('all')
  const [search, setSearch]         = useState('')
  const [liveCall, setLiveCall]     = useState(null) // inbound popup

  useEffect(() => {
    fetchCalls()
    // Subscribe to real-time new calls
    const channel = supabase
      .channel('nuacom_live')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'nuacom_calls',
      }, payload => {
        const call = payload.new
        setCalls(p => [call, ...p])
        // Show popup for inbound calls
        if (call.call_direction === 'inbound') {
          setLiveCall(call)
          setTimeout(() => setLiveCall(null), 15000) // auto-dismiss after 15s
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchCalls() {
    setLoading(true)
    const { data } = await supabase
      .from('nuacom_calls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    setCalls(data || [])
    setLoading(false)
  }

  // Register webhook with NUACOM API
  async function registerWebhook() {
    setRegistering(true)
    try {
      // Register for all call events
      const eventTypes = [
        'call_event',
        'inbound_call_event',
        'inbound_missed_call_event',
        'outbound_call_event',
        'outbound_answered_call_event',
      ]

      let successes = 0
      for (const type of eventTypes) {
        const res = await fetch(`${NUACOM_API}/webhooks/subscriptions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type, url: WEBHOOK_URL }),
        })
        if (res.ok || res.status === 201) successes++
      }
      setWebhookStatus('registered')
      showToast(`✓ ${successes}/${eventTypes.length} webhook events registered`)
    } catch (err) {
      showToast('Webhook registration failed: ' + err.message, 'error')
    }
    setRegistering(false)
  }

  const filtered = calls
    .filter(c => filterDir === 'all' || c.call_direction === filterDir)
    .filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return (c.call_caller_name || '').toLowerCase().includes(q) ||
             (c.call_caller_number_local || '').includes(q) ||
             (c.call_callee_number_local || '').includes(q)
    })

  const stats = {
    total:    calls.length,
    inbound:  calls.filter(c => c.call_direction === 'inbound').length,
    outbound: calls.filter(c => c.call_direction === 'outbound').length,
    missed:   calls.filter(c => !c.call_answered && c.call_direction === 'inbound').length,
    answered: calls.filter(c => c.call_answered).length,
  }

  const fmt = (unix) => {
    if (!unix) return '—'
    return new Date(unix * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const fmtDuration = (s) => {
    if (!s || s <= 0) return '—'
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, verticalAlign: 'middle' }
  const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13, width: '100%' }

  return (
    <div>
      {/* Inbound call popup */}
      {liveCall && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 600,
          background: '#fff', border: `2px solid ${C.green}`,
          borderRadius: 16, padding: 20, width: 320,
          boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
          animation: 'slideIn 0.3s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ background: C.greenSoft, color: C.greenDark, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>📞 Incoming Call</span>
            <button onClick={() => setLiveCall(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {liveCall.call_caller_name || 'Unknown Caller'}
          </div>
          <div style={{ fontSize: 14, color: C.muted, marginBottom: 12 }}>
            {liveCall.call_caller_number_local || liveCall.call_caller_number}
          </div>
          {liveCall.matched_lead_id && (
            <button
              onClick={() => { navigate(`/leads/${liveCall.matched_lead_id}`); setLiveCall(null) }}
              style={{ width: '100%', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Open Lead Record →
            </button>
          )}
          {liveCall.matched_client_id && (
            <button
              onClick={() => { navigate(`/clients/${liveCall.matched_client_id}`); setLiveCall(null) }}
              style={{ width: '100%', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontWeight: 700, cursor: 'pointer', fontSize: 13, marginTop: 6 }}>
              Open Client Record →
            </button>
          )}
          {!liveCall.matched_lead_id && !liveCall.matched_client_id && (
            <div style={{ fontSize: 12, color: C.amber, background: C.amberSoft, borderRadius: 8, padding: '8px 12px' }}>
              ⚠ Number not found in leads or clients
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>NUACOM Calls</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{calls.length} calls logged · live sync active</div>
        </div>
        {isAdmin && (
          <button
            onClick={registerWebhook}
            disabled={registering}
            style={{ background: webhookStatus === 'registered' ? C.greenSoft : C.accent, color: webhookStatus === 'registered' ? C.greenDark : '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: registering ? 0.7 : 1 }}>
            {registering ? 'Registering…' : webhookStatus === 'registered' ? '✓ Webhooks Registered' : '🔗 Register Webhooks'}
          </button>
        )}
      </div>

      {/* Setup notice — shown until webhook is registered */}
      {isAdmin && webhookStatus !== 'registered' && (
        <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: C.amber, marginBottom: 8 }}>⚠ Webhook Not Yet Registered</div>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.7 }}>
            Click <strong>"Register Webhooks"</strong> above to connect NUACOM to this platform.
            Once registered, every call (inbound and outbound) will automatically appear here and be
            logged to the activity feed of the matching lead or client.
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: C.muted, fontFamily: 'monospace', background: '#fff', borderRadius: 6, padding: '8px 12px', border: `1px solid ${C.border}` }}>
            Webhook URL: {WEBHOOK_URL}
          </div>
        </div>
      )}

      {/* Click-to-call guide */}
      <div style={{ background: C.accentSoft, border: `1px solid ${C.accent}44`, borderRadius: 12, padding: 16, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: C.text }}>
          <strong>📞 Click-to-Call:</strong> Install the NUACOM Chrome Extension to click any phone number in the platform and dial instantly.
        </div>
        <a href="https://chrome.google.com/webstore/search/nuacom" target="_blank" rel="noreferrer"
          style={{ background: C.accent, color: '#fff', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 12 }}>
          Install Extension →
        </a>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Calls',   value: stats.total,    color: C.text    },
          { label: 'Inbound',       value: stats.inbound,  color: C.accent  },
          { label: 'Outbound',      value: stats.outbound, color: C.purple  },
          { label: 'Missed',        value: stats.missed,   color: C.red     },
          { label: 'Answered',      value: stats.answered, color: C.greenDark },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: '12px 18px', flex: 1, minWidth: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 20, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or number…"
          style={{ ...inp, flex: 1, minWidth: 200 }} />
        <select value={filterDir} onChange={e => setFilterDir(e.target.value)}
          style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="all">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
      </div>

      {/* Calls table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading calls…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            {calls.length === 0
              ? 'No calls yet. Register the webhook above to start receiving calls.'
              : 'No calls match this filter.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Direction','Caller','Callee','Status','Duration','Time','Recording','Matched Record'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(call => {
                const isInbound  = call.call_direction === 'inbound'
                const isMissed   = !call.call_answered && isInbound
                const dirColor   = isInbound ? C.accent : '#7C3AED'
                const dirBg      = isInbound ? C.accentSoft : '#EDE9FE'

                return (
                  <tr key={call.id}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}>
                      <span style={{ background: isMissed ? C.redSoft : dirBg, color: isMissed ? C.red : dirColor, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {isMissed ? '↗ Missed' : isInbound ? '↙ In' : '↗ Out'}
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
                      <span style={{ background: call.call_answered ? C.greenSoft : C.redSoft, color: call.call_answered ? C.greenDark : C.red, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {call.call_answered ? 'Answered' : 'Missed'}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ color: C.muted, fontSize: 13 }}>{fmtDuration(call.duration_seconds)}</span>
                    </td>
                    <td style={td}>
                      <span style={{ color: C.dim, fontSize: 12 }}>{fmt(call.started_at_unix)}</span>
                    </td>
                    <td style={td}>
                      {call.recording_url ? (
                        <a href={call.recording_url} target="_blank" rel="noreferrer"
                          style={{ color: C.accent, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                          🎙 Play
                        </a>
                      ) : <span style={{ color: C.dim, fontSize: 12 }}>—</span>}
                    </td>
                    <td style={td}>
                      {call.matched_lead_id && (
                        <button onClick={() => navigate(`/leads/${call.matched_lead_id}`)}
                          style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                          Lead →
                        </button>
                      )}
                      {call.matched_client_id && (
                        <button onClick={() => navigate(`/clients/${call.matched_client_id}`)}
                          style={{ background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.green}44`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600, marginLeft: 4 }}>
                          Client →
                        </button>
                      )}
                      {!call.matched_lead_id && !call.matched_client_id && (
                        <span style={{ color: C.dim, fontSize: 12 }}>Unknown</span>
                      )}
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
