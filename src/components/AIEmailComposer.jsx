import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const C = {
  bg: '#111827', surface: '#1F2937', surface2: '#1a2433', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  purple: '#A855F7', purpleSoft: '#2E1065',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
}

// ── AIEmailComposer ───────────────────────────────────────────
// Props:
//   context       - { type, id, name, data } — what page we're on
//   onSend        - (subject, body, aiAssisted) => void — called when user sends
//   onClose       - () => void
//   initialTo     - pre-filled To address
//   initialSubject - pre-filled subject
//   compact       - smaller inline version

export default function AIEmailComposer({
  context,
  onSend,
  onClose,
  initialTo = '',
  initialSubject = '',
  compact = false,
}) {
  const { profile } = useAuth()
  const [to, setTo]           = useState(initialTo)
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody]       = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAssisted, setAiAssisted] = useState(false)
  const [sending, setSending] = useState(false)
  const [showAI, setShowAI]   = useState(false)
  const [tone, setTone]       = useState('professional')

  // ── Build system prompt based on context ─────────────────────
  function buildSystemPrompt() {
    const base = `You are an email writing assistant for MLC Services, a UK property compliance company based in London. MLC provides: EICR (Electrical Installation Condition Reports), Gas Safety Certificates (CP12), Energy Performance Certificates (EPC), Fire Risk Assessments (FRA), Fire Safety Certificates (FSC), PAT Testing, Remedial Works, Consumer Unit replacements, and Diagnostics. The rep writing this email is ${profile?.full_name || 'a team member'}.`

    const toneGuide = {
      professional: 'Write in a professional, clear, and confident tone. Keep it concise.',
      friendly:     'Write in a warm and friendly tone. Keep it conversational but professional.',
      chasing:      'Write a polite but firm follow-up. Be direct about needing a response.',
      formal:       'Write in a formal tone suitable for legal or compliance communications.',
    }[tone]

    const contextGuide = (() => {
      switch (context?.type) {
        case 'client_email':
          return `This email is for a client named ${context.name}. Client type: ${context.data?.customer_type}. Status: ${context.data?.status}. Company: ${context.data?.company_name || 'N/A'}. Source: ${context.data?.source || 'N/A'}.`
        case 'job_email':
          return `This email is about a job: ${context.name}. Job number: ${context.data?.job_number}. Services: ${context.data?.service_types?.join(', ')}. Status: ${context.data?.status}. Site: ${context.data?.site_address || 'N/A'}.`
        case 'campaign_step':
          return `This is a cold outreach email to an estate agent as part of a campaign. Keep it short (under 150 words), focus on MLC's fast turnaround and compliance expertise, and include a clear call to action.`
        case 'inbox_compose':
          return `This is a general email from the MLC platform.`
        default:
          return ''
      }
    })()

    return `${base}\n\n${toneGuide}\n\n${contextGuide}\n\nIMPORTANT: Return ONLY the email body text. No subject line. No "Here is the email:" preamble. Start directly with the salutation or first line of the email. Write in plain text with line breaks.`
  }

  // ── Call Claude API ──────────────────────────────────────────
  async function generateDraft() {
    if (!aiPrompt.trim() && !context) return
    setAiLoading(true)

    const userMessage = aiPrompt.trim()
      ? aiPrompt
      : `Write an email ${context?.type === 'campaign_step' ? 'to an estate agent introducing MLC Services' : `to ${context?.name || 'the client'}`}.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: buildSystemPrompt(),
          messages: [
            {
              role: 'user',
              content: body
                ? `Here is my current draft:\n\n${body}\n\nPlease refine it based on this instruction: ${userMessage}`
                : userMessage,
            },
          ],
        }),
      })

      const data = await res.json()
      const generated = data.content?.[0]?.text || ''

      if (generated) {
        setBody(generated)
        setAiAssisted(true)
        setAiPrompt('')

        // Auto-generate subject if empty
        if (!subject && context?.type !== 'campaign_step') {
          await generateSubject(generated)
        }

        // Log the draft
        await supabase.from('ai_drafts').insert({
          user_id:      profile?.id,
          context_type: context?.type || 'inbox_compose',
          context_id:   context?.id || null,
          prompt:       userMessage,
          response:     generated,
        })
      }
    } catch (err) {
      console.error('Claude API error:', err)
    }

    setAiLoading(false)
  }

  async function generateSubject(bodyText) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 60,
          messages: [{
            role: 'user',
            content: `Write a short, compelling email subject line (max 8 words) for this email body. Return ONLY the subject line, nothing else:\n\n${bodyText.slice(0, 300)}`,
          }],
        }),
      })
      const data = await res.json()
      const generatedSubject = data.content?.[0]?.text?.trim()
      if (generatedSubject) setSubject(generatedSubject)
    } catch {}
  }

  async function handleSend() {
    if (!to || !subject || !body) return
    setSending(true)
    await onSend?.({ to, subject, body, aiAssisted })
    setSending(false)

    // Mark draft as used
    if (aiAssisted) {
      await supabase
        .from('ai_drafts')
        .update({ was_used: true })
        .eq('user_id', profile?.id)
        .eq('context_type', context?.type || 'inbox_compose')
        .order('created_at', { ascending: false })
        .limit(1)
    }
  }

  const inputStyle = {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    padding: '9px 12px',
    fontSize: 14,
    width: '100%',
    fontFamily: 'inherit',
  }

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: compact ? 10 : 14,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: C.surface2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>✉️</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            Compose Email
            {context?.name && <span style={{ color: C.muted, fontWeight: 400 }}> — {context.name}</span>}
          </span>
          {aiAssisted && (
            <span style={{ background: C.purpleSoft, color: C.purple, border: `1px solid ${C.purple}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
              ✦ Claude refined
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowAI(p => !p)}
            style={{
              background: showAI ? C.purpleSoft : 'transparent',
              border: `1px solid ${showAI ? C.purple : C.border}`,
              color: showAI ? C.purple : C.muted,
              borderRadius: 8, padding: '5px 12px', fontSize: 12,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            ✦ AI Assist
          </button>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
          )}
        </div>
      </div>

      {/* AI Panel */}
      {showAI && (
        <div style={{ padding: '14px 18px', background: C.purpleSoft, borderBottom: `1px solid ${C.purple}33` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            ✦ Claude AI — Email Assistant
          </div>

          {/* Tone selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <span style={{ color: C.muted, fontSize: 12, alignSelf: 'center', marginRight: 4 }}>Tone:</span>
            {['professional','friendly','chasing','formal'].map(t => (
              <button key={t} onClick={() => setTone(t)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  fontWeight: tone === t ? 700 : 400,
                  background: tone === t ? C.purple + '44' : 'transparent',
                  border: `1px solid ${tone === t ? C.purple : C.border}`,
                  color: tone === t ? C.purple : C.muted,
                  textTransform: 'capitalize',
                }}>
                {t}
              </button>
            ))}
          </div>

          {/* Prompt input */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generateDraft()}
              placeholder={
                body
                  ? 'Refine instruction e.g. "make it shorter", "add urgency", "more friendly"…'
                  : 'Describe the email e.g. "follow up on EICR quote sent last week"…'
              }
              style={{ ...inputStyle, flex: 1, background: C.surface }}
            />
            <button
              onClick={generateDraft}
              disabled={aiLoading}
              style={{
                background: C.purple, color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 16px', fontWeight: 700,
                fontSize: 13, cursor: aiLoading ? 'not-allowed' : 'pointer',
                opacity: aiLoading ? 0.7 : 1, whiteSpace: 'nowrap',
              }}
            >
              {aiLoading ? '✦ Writing…' : body ? '✦ Refine' : '✦ Draft'}
            </button>
          </div>

          {/* Quick prompts based on context */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {getQuickPrompts(context).map(p => (
              <button key={p} onClick={() => { setAiPrompt(p); }}
                style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Email fields */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
          <span style={{ color: C.muted, fontSize: 13, width: 50, flexShrink: 0 }}>To</span>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@example.com"
            style={{ ...inputStyle, border: 'none', padding: '4px 0', background: 'transparent' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
          <span style={{ color: C.muted, fontSize: 13, width: 50, flexShrink: 0 }}>Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…"
            style={{ ...inputStyle, border: 'none', padding: '4px 0', background: 'transparent' }} />
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your email here, or use ✦ AI Assist to generate a draft…"
          rows={compact ? 8 : 12}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7 }}
        />
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 18px',
        borderTop: `1px solid ${C.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: C.surface2,
      }}>
        <div style={{ fontSize: 12, color: C.dim }}>
          {body.length > 0 && `${body.split(/\s+/).filter(Boolean).length} words`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onClose && (
            <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={sending || !to || !subject || !body}
            style={{
              background: C.accent, color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 20px', fontWeight: 700,
              fontSize: 14, cursor: sending || !to || !subject || !body ? 'not-allowed' : 'pointer',
              opacity: sending || !to || !subject || !body ? 0.5 : 1,
            }}
          >
            {sending ? 'Sending…' : '→ Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Quick prompts by context ──────────────────────────────────
function getQuickPrompts(context) {
  switch (context?.type) {
    case 'client_email':
      return [
        'Follow up on a quote',
        'Confirm an appointment',
        'Send certificate reminder',
        'Thank them for their business',
        'Chase an unpaid invoice',
      ]
    case 'job_email':
      return [
        'Confirm job details with tenant',
        'Send access instructions to engineer',
        'Notify client job is complete',
        'Request access for the engineer',
        'Share the certificate',
      ]
    case 'campaign_step':
      return [
        'Introduce MLC Services briefly',
        'Follow up on previous email',
        'Final chase — last attempt',
        'Ask for a 15-minute call',
      ]
    default:
      return [
        'Write a professional introduction',
        'Follow up politely',
        'Make it shorter and punchier',
      ]
  }
}
