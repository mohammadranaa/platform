import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#111827', surface: '#1F2937', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7', teal: '#2DD4BF', tealSoft: '#0D3330',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
}

const STATUS_META = {
  draft:     { color: C.muted,  bg: C.surface  },
  active:    { color: C.green,  bg: C.greenSoft },
  paused:    { color: C.amber,  bg: C.amberSoft },
  completed: { color: C.accent, bg: C.accentSoft},
}

const CONTACT_STATUS_META = {
  pending:      { color: C.muted,  bg: C.surface   },
  active:       { color: C.accent, bg: C.accentSoft },
  completed:    { color: C.green,  bg: C.greenSoft  },
  unsubscribed: { color: C.dim,    bg: C.bg         },
  bounced:      { color: C.red,    bg: C.redSoft    },
  replied:      { color: C.teal,   bg: C.tealSoft   },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, full, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: C.muted, border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft, color: C.red, border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.green, border: `1px solid ${C.green}44` },
    amber:   { background: C.amberSoft, color: C.amber, border: `1px solid ${C.amber}44` },
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8, fontWeight: 600, padding: small ? '6px 13px' : '9px 18px', fontSize: small ? 12 : 14, opacity: disabled ? 0.5 : 1, width: full ? '100%' : 'auto', ...v[variant], ...sx }}>
      {children}
    </button>
  )
}

const Badge = ({ status, map = STATUS_META }) => {
  const m = map[status] || { color: C.muted, bg: C.surface }
  return (
    <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
      {status}
    </span>
  )
}

const Field = ({ label, value, onChange, type = 'text', placeholder, rows, options, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    {label && <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>}
    {hint && <div style={{ color: C.dim, fontSize: 12 }}>{hint}</div>}
    {options ? (
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    ) : rows ? (
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }} />
    )}
  </div>
)

export default function Campaigns() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [campaigns, setCampaigns]   = useState([])
  const [inboxes, setInboxes]       = useState([])
  const [selected, setSelected]     = useState(null)
  const [contacts, setContacts]     = useState([])
  const [steps, setSteps]           = useState([])
  const [sends, setSends]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [view, setView]             = useState('list') // list | detail

  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [showNewStep, setShowNewStep]         = useState(false)
  const [showAddContacts, setShowAddContacts] = useState(false)

  const blankCampaign = { name: '', from_name: '', target_type: 'cold_agent', daily_limit: 50, track_opens: true, track_clicks: true }
  const blankStep = { step_number: '', delay_days: '0', subject: '', body_html: '' }
  const blankContact = { email: '', first_name: '', last_name: '', company: '' }
  const [newCampaign, setNewCampaign] = useState(blankCampaign)
  const [newStep, setNewStep]         = useState(blankStep)
  const [newContact, setNewContact]   = useState(blankContact)
  const [bulkCSV, setBulkCSV]         = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: i }] = await Promise.all([
      supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('inboxes').select('id, label, email, is_active').eq('is_active', true),
    ])
    setCampaigns(c || [])
    setInboxes(i || [])
    setLoading(false)
  }

  async function openCampaign(c) {
    setSelected(c)
    const [{ data: ct }, { data: st }, { data: sn }] = await Promise.all([
      supabase.from('campaign_contacts').select('*').eq('campaign_id', c.id).order('enrolled_at', { ascending: false }),
      supabase.from('sequence_steps').select('*').eq('campaign_id', c.id).order('step_number'),
      supabase.from('email_sends').select('*').eq('campaign_id', c.id).order('sent_at', { ascending: false }).limit(200),
    ])
    setContacts(ct || [])
    setSteps(st || [])
    setSends(sn || [])
    setView('detail')
  }

  async function createCampaign() {
    if (!newCampaign.name || !newCampaign.from_name) { showToast('Name and From Name are required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('campaigns').insert({ ...newCampaign, owner_id: profile.id })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchAll()
    setShowNewCampaign(false)
    setNewCampaign(blankCampaign)
    showToast('Campaign created ✓')
  }

  async function updateStatus(id, status) {
    await supabase.from('campaigns').update({ status }).eq('id', id)
    await fetchAll()
    if (selected?.id === id) setSelected(p => ({ ...p, status }))
    showToast(`Campaign ${status}`)
  }

  async function deleteCampaign(id) {
    if (!window.confirm('Delete this campaign and all its data?')) return
    await supabase.from('campaigns').delete().eq('id', id)
    await fetchAll()
    setView('list')
    setSelected(null)
    showToast('Campaign deleted')
  }

  async function addStep() {
    if (!newStep.subject || !newStep.body_html || !selected) return
    setSaving(true)
    const stepNum = Number(newStep.step_number) || (steps.length + 1)
    const { error } = await supabase.from('sequence_steps').insert({
      campaign_id: selected.id,
      step_number: stepNum,
      delay_days: Number(newStep.delay_days),
      subject: newStep.subject,
      body_html: newStep.body_html,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    const { data } = await supabase.from('sequence_steps').select('*').eq('campaign_id', selected.id).order('step_number')
    setSteps(data || [])
    setShowNewStep(false)
    setNewStep(blankStep)
    showToast('Step added ✓')
  }

  async function deleteStep(id) {
    await supabase.from('sequence_steps').delete().eq('id', id)
    setSteps(p => p.filter(s => s.id !== id))
    showToast('Step removed')
  }

  async function addContact() {
    if (!newContact.email || !selected) return
    setSaving(true)
    const firstStep = steps[0]
    await supabase.from('campaign_contacts').insert({
      campaign_id: selected.id, ...newContact,
      status: 'active', current_step: 0,
      next_send_at: firstStep ? new Date(Date.now() + (firstStep.delay_days || 0) * 86400000).toISOString() : null,
    })
    setSaving(false)
    const { data } = await supabase.from('campaign_contacts').select('*').eq('campaign_id', selected.id).order('enrolled_at', { ascending: false })
    setContacts(data || [])
    setNewContact(blankContact)
    showToast('Contact added ✓')
  }

  async function bulkImport() {
    if (!bulkCSV.trim() || !selected) return
    const firstStep = steps[0]
    const rows = bulkCSV.trim().split('\n')
      .map(line => {
        const [email, first_name = '', last_name = '', company = ''] = line.split(',').map(s => s.trim())
        return { campaign_id: selected.id, email, first_name, last_name, company, status: 'active', current_step: 0, next_send_at: firstStep ? new Date(Date.now() + (firstStep.delay_days || 0) * 86400000).toISOString() : null }
      })
      .filter(r => r.email && r.email.includes('@'))
    if (!rows.length) { showToast('No valid email addresses found', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('campaign_contacts').insert(rows)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    const { data } = await supabase.from('campaign_contacts').select('*').eq('campaign_id', selected.id).order('enrolled_at', { ascending: false })
    setContacts(data || [])
    setBulkCSV('')
    setShowAddContacts(false)
    showToast(`${rows.length} contacts imported ✓`)
  }

  // Analytics
  const analytics = useMemo(() => {
    const total   = sends.length
    const opens   = sends.filter(s => s.open_count > 0).length
    const clicks  = sends.filter(s => s.click_count > 0).length
    const replied = contacts.filter(c => c.status === 'replied').length
    const bounced = contacts.filter(c => c.status === 'bounced').length
    const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0
    return { total, opens, clicks, replied, bounced, openRate: pct(opens, total), clickRate: pct(clicks, total), replyRate: pct(replied, contacts.length) }
  }, [sends, contacts])

  const th = { textAlign: 'left', padding: '9px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}` }
  const td = { padding: '10px 14px', borderBottom: `1px solid ${C.border}18`, fontSize: 14, verticalAlign: 'middle' }

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading campaigns…</div>

  if (view === 'detail' && selected) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Btn variant="ghost" small onClick={() => { setView('list'); setSelected(null) }}>← Back</Btn>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>{selected.name}</h1>
            <Badge status={selected.status} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selected.status === 'draft'   && <Btn small variant="success" onClick={() => updateStatus(selected.id, 'active')}>▶ Start</Btn>}
            {selected.status === 'active'  && <Btn small variant="amber"   onClick={() => updateStatus(selected.id, 'paused')}>⏸ Pause</Btn>}
            {selected.status === 'paused'  && <Btn small variant="success" onClick={() => updateStatus(selected.id, 'active')}>▶ Resume</Btn>}
            <Btn small variant="danger" onClick={() => deleteCampaign(selected.id)}>Delete</Btn>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {[
            { label: 'Contacts',   value: contacts.length,         color: C.text },
            { label: 'Emails Sent', value: analytics.total,        color: C.accent },
            { label: 'Open Rate',  value: analytics.openRate + '%', color: C.teal },
            { label: 'Click Rate', value: analytics.clickRate + '%',color: C.accent },
            { label: 'Reply Rate', value: analytics.replyRate + '%',color: C.green },
            { label: 'Bounces',    value: analytics.bounced,        color: C.red },
          ].map(s => (
            <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 110 }}>
              <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Sequence steps */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Email Sequence</div>
              <Btn small onClick={() => setShowNewStep(true)}>+ Add Step</Btn>
            </div>
            {steps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: C.dim, fontSize: 13 }}>No steps yet. Add emails to build your sequence.</div>
            ) : steps.map((step, i) => (
              <div key={step.id} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.accentSoft, border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontWeight: 700, fontSize: 13 }}>{step.step_number}</div>
                  {i < steps.length - 1 && <div style={{ width: 2, height: 20, background: C.border, margin: '4px 0' }} />}
                </div>
                <div style={{ flex: 1, background: C.bg, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{step.subject}</div>
                    <button onClick={() => deleteStep(step.id)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                  <div style={{ color: C.dim, fontSize: 12 }}>{step.delay_days === 0 ? 'Immediately' : `After ${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 6, lineHeight: 1.5, maxHeight: 36, overflow: 'hidden' }}>
                    {step.body_html.slice(0, 80)}…
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Contacts */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Contacts ({contacts.length})</div>
              <Btn small onClick={() => setShowAddContacts(true)}>+ Add</Btn>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {contacts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: C.dim, fontSize: 13 }}>No contacts enrolled yet.</div>
              ) : contacts.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}18` }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.first_name} {c.last_name}</div>
                    <div style={{ color: C.dim, fontSize: 12 }}>{c.email} {c.company ? `· ${c.company}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ color: C.dim, fontSize: 12 }}>Step {c.current_step}</span>
                    <Badge status={c.status} map={CONTACT_STATUS_META} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Send log */}
        {sends.length > 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Send Log</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Subject','Step','Status','Opens','Clicks','Sent'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {sends.slice(0, 50).map(s => (
                    <tr key={s.id}>
                      <td style={td}><span style={{ fontSize: 13 }}>{s.subject}</span></td>
                      <td style={td}><span style={{ color: C.accent }}>{s.step_number}</span></td>
                      <td style={td}><Badge status={s.status} /></td>
                      <td style={td}><span style={{ color: s.open_count > 0 ? C.teal : C.dim }}>{s.open_count}</span></td>
                      <td style={td}><span style={{ color: s.click_count > 0 ? C.accent : C.dim }}>{s.click_count}</span></td>
                      <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{new Date(s.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Add Step Modal */}
        {showNewStep && (
          <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowNewStep(false)}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 580, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Add Sequence Step</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Step Number" value={String(newStep.step_number || steps.length + 1)} onChange={v => setNewStep(p => ({ ...p, step_number: v }))} type="number" />
                  <Field label="Send After (days)" value={newStep.delay_days} onChange={v => setNewStep(p => ({ ...p, delay_days: v }))} type="number" hint="0 = immediately on enrolment" />
                </div>
                <Field label="Subject Line" value={newStep.subject} onChange={v => setNewStep(p => ({ ...p, subject: v }))} placeholder="Quick question about {{company}}" />
                <Field label="Email Body" value={newStep.body_html} onChange={v => setNewStep(p => ({ ...p, body_html: v }))} rows={10}
                  placeholder={'Hi {{first_name}},\n\nI noticed you manage properties in London and wanted to reach out about our compliance certification services — EICR, Gas Safety (CP12), EPC, Fire Risk Assessments and more.\n\nWe work with many estate agents in your area and can turn around certificates quickly.\n\nWould you be open to a quick call?\n\nBest,\n{{rep_name}}'} />
                <div style={{ background: C.bg, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.muted }}>
                  Variables: <span style={{ color: C.accent }}>{'{{first_name}} {{last_name}} {{company}} {{email}}'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <Btn onClick={addStep} disabled={saving}>{saving ? 'Saving…' : 'Add Step'}</Btn>
                <Btn variant="ghost" onClick={() => setShowNewStep(false)}>Cancel</Btn>
              </div>
            </div>
          </div>
        )}

        {/* Add Contacts Modal */}
        {showAddContacts && (
          <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAddContacts(false)}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 540, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Add Contacts</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.muted }}>Single Contact</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Email *" value={newContact.email} onChange={v => setNewContact(p => ({ ...p, email: v }))} type="email" />
                  <Field label="Company" value={newContact.company} onChange={v => setNewContact(p => ({ ...p, company: v }))} />
                  <Field label="First Name" value={newContact.first_name} onChange={v => setNewContact(p => ({ ...p, first_name: v }))} />
                  <Field label="Last Name" value={newContact.last_name} onChange={v => setNewContact(p => ({ ...p, last_name: v }))} />
                </div>
                <Btn onClick={addContact} disabled={saving || !newContact.email}>{saving ? 'Adding…' : 'Add Contact'}</Btn>
              </div>
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.muted, marginBottom: 10 }}>Bulk Import (CSV)</div>
                <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>Format: <code style={{ color: C.accent }}>email, first_name, last_name, company</code> — one per line</div>
                <Field value={bulkCSV} onChange={setBulkCSV} rows={5} placeholder={'frank@cousinsestates.co.uk, Frank, Browne, Cousins Estate Agents\ndaniel@oease9.co.uk, Daniel, Stillman, Oakwood Estate Agent'} />
                <Btn style={{ marginTop: 12 }} onClick={bulkImport} disabled={saving || !bulkCSV.trim()}>
                  {saving ? 'Importing…' : `Import ${bulkCSV.trim().split('\n').filter(l => l.includes('@')).length} contacts`}
                </Btn>
              </div>
            </div>
          </div>
        )}

        <Toast toast={toast} />
      </div>
    )
  }

  // ── CAMPAIGNS LIST ────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Cold Email Campaigns</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{campaigns.length} campaigns · {inboxes.length} active inboxes</div>
        </div>
        <Btn onClick={() => setShowNewCampaign(true)}>+ New Campaign</Btn>
      </div>

      {campaigns.length === 0 ? (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No campaigns yet</div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 20 }}>Create your first cold email campaign to start reaching estate agents.</div>
          <Btn onClick={() => setShowNewCampaign(true)}>Create Campaign</Btn>
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Campaign', 'Target', 'Status', 'Daily Limit', 'Actions'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCampaign(c)}>
                  <td style={td}><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ color: C.dim, fontSize: 12 }}>From: {c.from_name}</div></td>
                  <td style={td}><span style={{ color: C.amber, fontSize: 13 }}>{c.target_type}</span></td>
                  <td style={td}><Badge status={c.status} /></td>
                  <td style={td}><span style={{ color: C.accent }}>{c.daily_limit}/day</span></td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.status === 'draft'  && <Btn small variant="success" onClick={() => updateStatus(c.id, 'active')}>▶ Start</Btn>}
                      {c.status === 'active' && <Btn small variant="amber"   onClick={() => updateStatus(c.id, 'paused')}>⏸ Pause</Btn>}
                      {c.status === 'paused' && <Btn small variant="success" onClick={() => updateStatus(c.id, 'active')}>▶ Resume</Btn>}
                      <Btn small variant="ghost" onClick={() => openCampaign(c)}>View</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Campaign Modal */}
      {showNewCampaign && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowNewCampaign(false)}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>New Campaign</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Campaign Name" value={newCampaign.name} onChange={v => setNewCampaign(p => ({ ...p, name: v }))} placeholder="Q3 Estate Agent Outreach — London" />
              <Field label="From Name" value={newCampaign.from_name} onChange={v => setNewCampaign(p => ({ ...p, from_name: v }))} placeholder="James from MLC Services" hint="Recipients see this as the sender name." />
              <Field label="Target Audience" value={newCampaign.target_type} onChange={v => setNewCampaign(p => ({ ...p, target_type: v }))}
                options={[{ value: 'cold_agent', label: 'Cold Estate Agents' }, { value: 'verified', label: 'Verified Customers' }, { value: 'inbound', label: 'Inbound Leads' }, { value: 'mixed', label: 'Mixed' }]} />
              <Field label="Daily Send Limit (all inboxes combined)" value={String(newCampaign.daily_limit)} onChange={v => setNewCampaign(p => ({ ...p, daily_limit: Number(v) }))} type="number" />
              <div style={{ display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, color: C.muted }}>
                  <input type="checkbox" checked={newCampaign.track_opens} onChange={e => setNewCampaign(p => ({ ...p, track_opens: e.target.checked }))} />
                  Track Opens
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, color: C.muted }}>
                  <input type="checkbox" checked={newCampaign.track_clicks} onChange={e => setNewCampaign(p => ({ ...p, track_clicks: e.target.checked }))} />
                  Track Clicks
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <Btn onClick={createCampaign} disabled={saving}>{saving ? 'Creating…' : 'Create Campaign'}</Btn>
              <Btn variant="ghost" onClick={() => setShowNewCampaign(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
