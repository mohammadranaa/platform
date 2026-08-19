import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function IncomingCallPopup() {
  const [activeCall, setActiveCall] = useState(null)
  const [matches, setMatches] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    // Listen for new incoming calls in real-time
    const channel = supabase
      .channel('incoming_calls')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'nuacom_calls',
        filter: "call_direction=eq.inbound"
      }, async (payload) => {
        const call = payload.new
        setActiveCall(call)

        // Match the caller number
        const callerNum = call.call_caller_number || call.call_caller_number_local
        if (callerNum) {
          const { data } = await supabase.rpc('match_phone', { p_number: callerNum })
          setMatches(data || [])
        } else {
          setMatches([])
        }

        // Auto-dismiss after 30 seconds
        setTimeout(() => setActiveCall(null), 30000)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  if (!activeCall) return null

  const callerNum = activeCall.call_caller_number || activeCall.call_caller_number_local || 'Unknown'
  const callerName = activeCall.call_caller_name || callerNum

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      width: 340, background: '#fff',
      border: '2px solid #0093DB',
      borderRadius: 16,
      boxShadow: '0 8px 40px rgba(0,147,219,0.25)',
      overflow: 'hidden',
      animation: 'slideIn 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ background: '#0093DB', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 22, animation: 'pulse 1s infinite' }}>📞</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Incoming Call</div>
            <div style={{ color: '#E6F4FC', fontSize: 11 }}>via Nuacom</div>
          </div>
        </div>
        <button onClick={() => setActiveCall(null)}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}>
          ✕
        </button>
      </div>

      {/* Caller info */}
      <div style={{ padding: '16px 18px' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#1F2937', marginBottom: 2 }}>{callerName}</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 14 }}>{callerNum}</div>

        {/* Matches */}
        {matches.length > 0 ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 8 }}>Identified as</div>
            {matches.map((m, i) => (
              <div key={i} onClick={() => { navigate(m.link); setActiveCall(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#F5F7FA', borderRadius: 8, cursor: 'pointer', marginBottom: 6, border: '1px solid #E5E7EB' }}
                onMouseEnter={e => e.currentTarget.style.background = '#E6F4FC'}
                onMouseLeave={e => e.currentTarget.style.background = '#F5F7FA'}>
                <span style={{ fontSize: 20 }}>
                  {m.entity_type === 'client' ? '👤' : m.entity_type === 'lead' ? '📋' : '🏠'}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1F2937' }}>{m.entity_name}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' }}>{m.entity_type} · {m.phone_field?.replace(/_/g, ' ')}</div>
                </div>
                <span style={{ marginLeft: 'auto', color: '#0093DB', fontSize: 12 }}>→</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '12px', background: '#FEF3C7', borderRadius: 8, fontSize: 13, color: '#D97706', textAlign: 'center' }}>
            ⚠ Unknown caller — not in your database
          </div>
        )}

        {/* Time */}
        <div style={{ marginTop: 12, fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>
          {new Date().toLocaleTimeString('en-GB')} · Auto-dismiss in 30s
        </div>
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(120%); opacity:0 } to { transform: translateX(0); opacity:1 } }
        @keyframes pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.2) } }
      `}</style>
    </div>
  )
}
