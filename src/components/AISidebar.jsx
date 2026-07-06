import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'

const C = {
  bg: '#111827', surface: '#1F2937', surface2: '#1a2433', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  purple: '#A855F7', purpleSoft: '#2E1065',
  green: '#80D100', amber: '#F59E0B',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
}

const QUICK_PROMPTS = [
  'What services does MLC offer?',
  'Draft a cold email to an estate agent',
  'How should I follow up on a quote?',
  'What should I include in an EICR reminder?',
  'Write a payment chase email',
  'How do I explain an EPC to a landlord?',
]

export default function AISidebar({ isOpen, onClose }) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `Hi ${profile?.full_name?.split(' ')[0] || 'there'} 👋 I'm your MLC platform assistant. I can help you draft emails, write follow-ups, explain services to clients, or answer any questions about running your jobs and campaigns. What do you need?`,
    },
  ])
  const [input, setInput]     = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef             = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const SYSTEM = `You are an AI assistant embedded inside MLC Services' internal platform. MLC is a UK property compliance company based in London offering: EICR (Electrical Installation Condition Reports), Gas Safety Certificates (CP12), Energy Performance Certificates (EPC), Fire Risk Assessments (FRA), Fire Safety Certificates (FSC), PAT Testing, Remedial Works, Consumer Unit replacements, and Diagnostics. MLC serves three client types: inbound residential landlords/tenants, verified past customers (estate agents, property managers), and cold estate agents being outreached. The user is ${profile?.full_name}, role: ${profile?.role}. Help them with email drafting, client communication, job updates, follow-ups, and anything MLC-related. Be concise, practical and professional. UK English spelling and £ for currency.`

  async function sendMessage(text = input) {
    const userMsg = text.trim()
    if (!userMsg || loading) return

    const updated = [...messages, { role: 'user', content: userMsg }]
    setMessages(updated)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: SYSTEM,
          messages: updated.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      const data = await res.json()
      const reply = data.content?.[0]?.text || 'Sorry, something went wrong.'
      setMessages(p => [...p, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages(p => [...p, { role: 'assistant', content: 'Connection error. Please try again.' }])
    }

    setLoading(false)
  }

  if (!isOpen) return null

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 0,
      bottom: 0,
      width: 380,
      background: C.surface,
      borderLeft: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 200,
      boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 20px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: C.surface2,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: C.purple }}>✦</span> MLC AI Assistant
          </div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>Powered by Claude</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setMessages([{ role: 'assistant', content: `Hi ${profile?.full_name?.split(' ')[0] || 'there'} 👋 Starting fresh. How can I help?` }])}
            style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
          >
            Clear
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            {/* Avatar */}
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: msg.role === 'assistant' ? C.purpleSoft : C.accentSoft,
              border: `1px solid ${msg.role === 'assistant' ? C.purple : C.accent}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12,
            }}>
              {msg.role === 'assistant' ? '✦' : profile?.full_name?.[0]?.toUpperCase() || 'U'}
            </div>

            {/* Bubble */}
            <div style={{
              background: msg.role === 'user' ? C.accentSoft : C.bg,
              border: `1px solid ${msg.role === 'user' ? C.accent + '44' : C.border}`,
              borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
              padding: '10px 14px',
              fontSize: 13,
              lineHeight: 1.65,
              color: C.text,
              maxWidth: '85%',
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.purpleSoft, border: `1px solid ${C.purple}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: C.purple }}>✦</div>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: '4px 12px 12px 12px', padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: C.purple, opacity: 0.6, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 2 && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => sendMessage(p)}
              style={{
                background: C.bg, border: `1px solid ${C.border}`,
                color: C.muted, borderRadius: 8, padding: '5px 11px',
                fontSize: 11, cursor: 'pointer', textAlign: 'left',
                transition: 'all .15s',
              }}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.border}`, background: C.surface2 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask Claude anything…"
            disabled={loading}
            style={{
              flex: 1, background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 10, color: C.text, padding: '10px 14px',
              fontSize: 14, fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              background: C.purple, color: '#fff', border: 'none',
              borderRadius: 10, padding: '10px 16px', fontWeight: 700,
              fontSize: 14, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !input.trim() ? 0.5 : 1,
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8, textAlign: 'center' }}>
          Claude · MLC Services AI Assistant
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `}</style>
    </div>
  )
}
