import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F5F5', surface2: '#EFEFEF', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7', purpleSoft: '#2E1065',
  teal: '#2DD4BF', tealSoft: '#0D3330',
  text: '#1F2937', muted: '#6B7280', dim: '#6B7280',
}

const CATEGORY_META = {
  verified_customer: { label: 'Verified Customer',  color: C.accent, bg: C.accentSoft, icon: '✓' },
  cold_email:        { label: 'Cold Email',          color: C.amber,  bg: C.amberSoft,  icon: '❄' },
  process:           { label: 'Process',             color: C.green,  bg: C.greenSoft,  icon: '⚙' },
}

const TYPE_LABELS = {
  discovery:            'Discovery',
  follow_up_1:          'Follow Up 1',
  follow_up_2:          'Follow Up 2 (Final)',
  invoice:              'Invoice',
  payment_confirmation: 'Payment Confirmation',
  job_confirmation:     'Job Confirmation',
  certificate_delivery: 'Certificate Delivery',
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,      color: '#fff',    border: 'none' },
    ghost:   { background: 'transparent', color: C.muted,   border: `1px solid ${C.border}` },
    success: { background: C.greenSoft,   color: C.green,   border: `1px solid ${C.green}44` },
    danger:  { background: C.redSoft,     color: C.red,     border: `1px solid ${C.red}44` },
    amber:   { background: C.amberSoft,   color: C.amber,   border: `1px solid ${C.amber}44` },
    purple:  { background: C.purpleSoft,  color: C.purple,  border: `1px solid ${C.purple}44` },
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

// ── Variable chip renderer ────────────────────────────────────
function VariableChips({ variables }) {
  if (!variables?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
      {variables.map(v => (
        <span key={v} style={{ background: C.purpleSoft, color: C.purple, border: `1px solid ${C.purple}33`, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
          {`{{${v}}}`}
        </span>
      ))}
    </div>
  )
}

// ── Render body with variables highlighted ────────────────────
function BodyPreview({ body, variables = [] }) {
  if (!body) return null
  let rendered = body
  // Wrap variables in spans for highlighting
  variables.forEach(v => {
    rendered = rendered.replaceAll(`{{${v}}}`, `__VAR__${v}__ENDVAR__`)
  })
  const parts = rendered.split(/(__VAR__|__ENDVAR__)/)

  return (
    <pre style={{
      background: C.bg, borderRadius: 8, padding: '14px 16px',
      fontSize: 13, lineHeight: 1.8, color: C.muted,
      whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0,
      maxHeight: 300, overflowY: 'auto',
    }}>
      {body.split('\n').map((line, i) => {
        // highlight {{variables}} in each line
        const parts = line.split(/({{[^}]+}})/)
        return (
          <span key={i}>
            {parts.map((part, j) =>
              part.startsWith('{{') && part.endsWith('}}')
                ? <span key={j} style={{ background: C.purpleSoft, color: C.purple, borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: 12 }}>{part}</span>
                : <span key={j}>{part}</span>
            )}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}

export default function Templates() {
  const { isAdmin, profile } = useAuth()
  const { toast, showToast } = useToast()

  const [templates, setTemplates]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState('all')
  const [selected, setSelected]     = useState(null)
  const [editing, setEditing]       = useState(false)
  const [editForm, setEditForm]     = useState({})
  const [saving, setSaving]         = useState(false)
  const [showUse, setShowUse]       = useState(false)
  const [fillVars, setFillVars]     = useState({})

  useEffect(() => { fetchTemplates() }, [])

  async function fetchTemplates() {
    setLoading(true)
    const { data } = await supabase
      .from('email_templates')
      .select('*')
      .order('sort_order')
    setTemplates(data || [])
    if (data?.length > 0 && !selected) setSelected(data[0])
    setLoading(false)
  }

  async function saveTemplate() {
    setSaving(true)
    const { error } = await supabase
      .from('email_templates')
      .update({
        name: editForm.name,
        subject: editForm.subject,
        body: editForm.body,
      })
      .eq('id', selected.id)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchTemplates()
    setSelected(prev => ({ ...prev, ...editForm }))
    setEditing(false)
    showToast('Template saved ✓')
  }

  function startEdit() {
    setEditForm({ name: selected.name, subject: selected.subject, body: selected.body })
    setEditing(true)
  }

  function startUse() {
    // Pre-fill variables with defaults
    const vars = {}
    selected.variables?.forEach(v => { vars[v] = '' })
    // Auto-fill rep name
    vars['rep_name'] = profile?.full_name || ''
    setFillVars(vars)
    setShowUse(true)
  }

  // Render the template with filled variables
  function renderTemplate(template, vars) {
    let subject = template.subject
    let body = template.body
    Object.entries(vars).forEach(([k, v]) => {
      const val = v || `[${k.toUpperCase().replace(/_/g, ' ')}]`
      subject = subject.replaceAll(`{{${k}}}`, val)
      body = body.replaceAll(`{{${k}}}`, val)
    })
    return { subject, body }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    showToast('Copied to clipboard ✓')
  }

  const filtered = activeTab === 'all'
    ? templates
    : templates.filter(t => t.category === activeTab)

  const TABS = [
    { key: 'all',              label: 'All Templates',     count: templates.length },
    { key: 'verified_customer', label: 'Verified Customer', count: templates.filter(t => t.category === 'verified_customer').length },
    { key: 'cold_email',       label: 'Cold Email',        count: templates.filter(t => t.category === 'cold_email').length },
    { key: 'process',          label: 'Process',           count: templates.filter(t => t.category === 'process').length },
  ]

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading templates…</div>

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Email Templates</h1>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>
          {templates.length} templates · All MLC email formats in one place
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content' }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
              background: activeTab === tab.key ? C.bg : 'transparent',
              color: activeTab === tab.key ? C.text : C.muted,
            }}>
            {tab.label}
            <span style={{ marginLeft: 6, color: activeTab === tab.key ? C.accent : C.dim, fontSize: 12 }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Two column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, minHeight: 600 }}>

        {/* Left — template list */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((t, i) => {
            const meta = CATEGORY_META[t.category]
            const isSelected = selected?.id === t.id
            return (
              <div key={t.id} onClick={() => { setSelected(t); setEditing(false) }}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}20` : 'none',
                  cursor: 'pointer',
                  background: isSelected ? C.accentSoft : 'transparent',
                  borderLeft: `3px solid ${isSelected ? C.accent : 'transparent'}`,
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    background: meta.bg, color: meta.color,
                    border: `1px solid ${meta.color}44`,
                    borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700,
                  }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div style={{ fontWeight: isSelected ? 700 : 500, fontSize: 13, color: isSelected ? C.text : C.muted }}>
                  {t.name}
                </div>
                <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>
                  {TYPE_LABELS[t.template_type] || t.template_type}
                </div>
              </div>
            )
          })}
        </div>

        {/* Right — template detail */}
        {selected && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            {/* Template header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    background: CATEGORY_META[selected.category].bg,
                    color: CATEGORY_META[selected.category].color,
                    border: `1px solid ${CATEGORY_META[selected.category].color}44`,
                    borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600,
                  }}>
                    {CATEGORY_META[selected.category].label}
                  </span>
                  <span style={{ background: C.bg, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 10px', fontSize: 12 }}>
                    {TYPE_LABELS[selected.template_type]}
                  </span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn small variant="purple" onClick={startUse}>Use Template →</Btn>
                {isAdmin && !editing && <Btn small variant="ghost" onClick={startEdit}>Edit</Btn>}
              </div>
            </div>

            {editing ? (
              /* Edit mode */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Template Name</label>
                  <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject Line</label>
                  <input value={editForm.subject} onChange={e => setEditForm(p => ({ ...p, subject: e.target.value }))}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Body</label>
                  <VariableChips variables={selected.variables} />
                  <textarea value={editForm.body} onChange={e => setEditForm(p => ({ ...p, body: e.target.value }))}
                    rows={16}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '12px 14px', fontSize: 13, lineHeight: 1.8, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn onClick={saveTemplate} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Btn>
                  <Btn variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
                </div>
              </div>
            ) : (
              /* View mode */
              <div>
                {/* Subject */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Subject Line</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bg, borderRadius: 8, padding: '10px 14px' }}>
                    <span style={{ fontSize: 14, color: C.text }}>{selected.subject}</span>
                    <button onClick={() => copyToClipboard(selected.subject)}
                      style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12, flexShrink: 0, marginLeft: 10 }}>
                      Copy
                    </button>
                  </div>
                </div>

                {/* Variables */}
                {selected.variables?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                      Variables — fill these in when using
                    </div>
                    <VariableChips variables={selected.variables} />
                  </div>
                )}

                {/* Body */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Email Body</div>
                    <button onClick={() => copyToClipboard(selected.body)}
                      style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 12 }}>
                      Copy Body
                    </button>
                  </div>
                  <BodyPreview body={selected.body} variables={selected.variables} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Use Template Modal — fill in variables */}
      {showUse && selected && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000099', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={() => setShowUse(false)}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 640, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Use Template — {selected.name}</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Fill in the variables below to generate your email.</div>

            {/* Variable inputs */}
            {selected.variables?.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                {selected.variables.map(v => (
                  <div key={v} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {v.replace(/_/g, ' ')}
                    </label>
                    <input
                      value={fillVars[v] || ''}
                      onChange={e => setFillVars(p => ({ ...p, [v]: e.target.value }))}
                      placeholder={`Enter ${v.replace(/_/g, ' ')}`}
                      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Preview</div>
              <div style={{ background: C.bg, borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                <span style={{ color: C.dim, fontSize: 12 }}>Subject: </span>
                <span style={{ color: C.text, fontSize: 13 }}>{renderTemplate(selected, fillVars).subject}</span>
              </div>
              <pre style={{ background: C.bg, borderRadius: 8, padding: '14px 16px', fontSize: 13, lineHeight: 1.8, color: C.muted, whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 280, overflowY: 'auto' }}>
                {renderTemplate(selected, fillVars).body}
              </pre>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={() => {
                const { subject, body } = renderTemplate(selected, fillVars)
                copyToClipboard(`Subject: ${subject}\n\n${body}`)
              }}>Copy Email</Btn>
              <Btn variant="ghost" onClick={() => {
                const { subject, body } = renderTemplate(selected, fillVars)
                const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
                window.open(mailto)
              }}>Open in Mail App</Btn>
              <Btn variant="ghost" onClick={() => setShowUse(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
