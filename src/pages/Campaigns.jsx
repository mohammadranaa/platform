import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', teal: '#0D9488', tealSoft: '#CCFBF1',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
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
        style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    ) : rows ? (
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} placeholder={placeholder}
        style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }} />
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
  const [showImportLeads, setShowImportLeads] = useState(false)
  const [importLeads, setImportLeads]         = useState([])
  const [importLoading, setImportLoading]     = useState(false)
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set())
  const [leadFilterTab, setLeadFilterTab]     = useState('all')
  const [leadSearch, setLeadSearch]           = useState('')
  const [hideEmailed, setHideEmailed]         = useState(false)

  const [coldAccounts, setColdAccounts] = useState([])
  const [selectedInboxIds, setSelectedInboxIds] = useState([])
  const [rotateInboxes, setRotateInboxes] = useState(true)

  const blankCampaign = { name: '', target_type: 'cold_agent', daily_limit: 50, track_opens: true, track_clicks: true }
  const blankStep = { step_number: '', delay_days: '0', subject: '', body_html: '' }
  const blankContact = { email: '', first_name: '', last_name: '', company: '' }
  const [newCampaign, setNewCampaign] = useState(blankCampaign)
  const [newStep, setNewStep]         = useState(blankStep)
  const [newContact, setNewContact]   = useState(blankContact)
  const [bulkCSV, setBulkCSV]         = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: i }, { data: accounts }] = await Promise.all([
      supabase.from('campaigns').select('*, campaign_contacts(id, lead_id)').order('created_at', { ascending: false }),
      supabase.from('inboxes').select('id, label, email, is_active').eq('is_active', true),
      supabase.from('user_email_accounts').select('id, gmail_address, display_name').eq('account_type', 'cold').eq('is_active', true).order('gmail_address'),
    ])
    setCampaigns(c || [])
    setInboxes(i || [])
    setColdAccounts(accounts || [])
    // Default: select ALL accounts so rotation starts immediately (only on first load)
    setSelectedInboxIds(prev => prev.length === 0 ? (accounts || []).map(a => a.id) : prev)
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

  function openNewCampaign() {
    setNewCampaign(blankCampaign)
    setShowNewCampaign(true)
  }

  async function createCampaign() {
    if (!newCampaign.name) { showToast('Campaign name is required', 'error'); return }
    if (selectedInboxIds.length === 0) { showToast('Select at least one sending account', 'error'); return }
    setSaving(true)
    const fromAccount = coldAccounts.find(a => a.id === selectedInboxIds[0])
    const { error } = await supabase.from('campaigns').insert({
      ...newCampaign,
      owner_id: profile.id,
      rotate_inboxes: rotateInboxes,
      inbox_ids: selectedInboxIds,
      from_inbox_id: selectedInboxIds[0] || null,
      from_name: fromAccount?.display_name || 'My Landlord Certificate',
      from_email: fromAccount?.gmail_address || '',
    })
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
    await supabase.from('campaign_contacts').delete().eq('campaign_id', id)
    await supabase.from('campaigns').delete().eq('id', id)
    await fetchAll()
    setView('list')
    setSelected(null)
    showToast('Campaign deleted')
  }

  async function launchCampaign(campaign) {
    if (!campaign.subject) { showToast('Add an email subject before launching', 'error'); return }
    if (!campaign.body) { showToast('Write an email body before launching', 'error'); return }
    if (!campaign.inbox_ids || campaign.inbox_ids.length === 0) { showToast('Select at least one sending inbox', 'error'); return }
    const contactCount = campaign.campaign_contacts?.length || 0
    if (contactCount === 0) { showToast('Add contacts to the campaign first', 'error'); return }
    if (!window.confirm(`Launch "${campaign.name}"? This will start sending ${contactCount} emails.`)) return

    await supabase.from('campaigns').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', campaign.id)
    if (selected?.id === campaign.id) setSelected(p => ({ ...p, status: 'active' }))

    try {
      // supabase.functions.invoke (not a raw fetch) — the Supabase API
      // gateway requires the apikey header to route to the function at
      // all, even with --no-verify-jwt on the function itself. A bare
      // fetch() without it surfaces as a generic "Failed to fetch".
      const { data, error } = await supabase.functions.invoke('send-sequences', {
        body: { campaign_id: campaign.id },
      })
      if (error) throw error
      showToast('Campaign launched! Sent ' + (data?.total_sent || 0) + ' emails.')
    } catch {
      showToast('Campaign set to active. Emails will send when the engine runs.', 'info')
    }
    fetchAll()
  }

  async function addEligibleLeads(campaignId) {
    const existing = new Set((campaigns.find(c => c.id === campaignId)?.campaign_contacts || []).map(cc => cc.lead_id))
    const { data: eligible } = await supabase
      .from('campaign_eligible_leads')
      .select('id, contact_name, company, email')
      .limit(500)
    const newLeads = (eligible || []).filter(l => !existing.has(l.id))
    if (newLeads.length === 0) { showToast('All eligible leads are already in this campaign'); return }
    const count = window.prompt('How many leads to add? (' + newLeads.length + ' available)', String(Math.min(newLeads.length, 200)))
    if (!count) return
    const toAdd = newLeads.slice(0, parseInt(count) || 100)
    const contacts = toAdd.map(l => ({
      campaign_id: campaignId,
      lead_id: l.id,
      email: l.email,
      first_name: (l.contact_name || '').split(' ')[0] || '',
      last_name: (l.contact_name || '').split(' ').slice(1).join(' ') || '',
      company: l.company || '',
      status: 'active',
    }))
    const { error } = await supabase.from('campaign_contacts').insert(contacts)
    if (error) { showToast(error.message, 'error'); return }
    showToast(contacts.length + ' leads added to campaign')
    fetchAll()
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

  async function openImportLeads() {
    setShowImportLeads(true)
    setSelectedLeadIds(new Set())
    setLeadFilterTab('all')
    setLeadSearch('')
    setHideEmailed(false)
    setImportLoading(true)
    const { data: contactData, error } = await supabase
      .from('campaign_eligible_leads')
      .select('id, lead_type, email, company, contact_name, contact_first, contact_last, status, assigned_to, in_campaign, email_send_count, last_email_sent_at')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) console.error('Eligible leads error:', error)
    setImportLeads(contactData || [])
    setImportLoading(false)
  }

  const filteredImportLeads = useMemo(() => {
    let r = importLeads
    if (leadFilterTab === 'cold_agent') r = r.filter(l => l.lead_type === 'cold_agent')
    if (leadFilterTab === 'inbound') r = r.filter(l => l.lead_type === 'inbound')
    if (hideEmailed) r = r.filter(l => !l.in_campaign && !l.email_send_count)
    if (leadSearch.trim()) {
      const q = leadSearch.trim().toLowerCase()
      r = r.filter(l => (l.company || '').toLowerCase().includes(q) || (l.contact_name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q))
    }
    return r
  }, [importLeads, leadFilterTab, leadSearch, hideEmailed])

  async function addSelectedLeadsToCampaign() {
    if (!selected || selectedLeadIds.size === 0) return
    const chosen = importLeads.filter(l => selectedLeadIds.has(l.id))
    setSaving(true)
    const selectedForInsert = chosen
    const { error: insErr } = await supabase.from('campaign_contacts').insert(
      selectedForInsert.map(l => ({
        campaign_id: selected.id,
        lead_id:     l.id,
        email:       l.email,
        first_name:  l.contact_first || (l.contact_name || '').split(' ')[0] || null,
        last_name:   l.contact_last  || (l.contact_name || '').split(' ').slice(1).join(' ') || null,
        company:     l.company || null,
        status:      'active',
        current_step: 0,
        enrolled_at: new Date().toISOString(),
      }))
    )
    setSaving(false)
    if (insErr) {
      if (insErr.message?.includes('duplicate key')) {
        showToast('Some contacts were already in this campaign and were skipped.', 'error')
      } else {
        showToast('Import failed: ' + insErr.message, 'error')
      }
      return
    }
    const { data } = await supabase.from('campaign_contacts').select('*').eq('campaign_id', selected.id).order('enrolled_at', { ascending: false })
    setContacts(data || [])
    setShowImportLeads(false)
    setSelectedLeadIds(new Set())
    showToast(selectedForInsert.length + ' contacts added ✓')
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

  const th = { textAlign: 'left', padding: '9px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA' }
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
            {selected.status === 'draft'   && <Btn small variant="success" onClick={() => launchCampaign(selected)}>🚀 Launch</Btn>}
            {selected.status === 'active'  && <Btn small variant="amber"   onClick={() => updateStatus(selected.id, 'paused')}>⏸ Pause</Btn>}
            {selected.status === 'paused'  && <Btn small variant="success" onClick={() => updateStatus(selected.id, 'active')}>▶ Resume</Btn>}
            <Btn small variant="teal" onClick={() => addEligibleLeads(selected.id)}>+ Add Leads</Btn>
            <Btn small variant="danger" onClick={() => deleteCampaign(selected.id)}>Delete</Btn>
          </div>
        </div>

        {/* Inline subject + body editor, and sending inbox selector */}
        <div style={{ marginTop:12, marginBottom:20, padding:16, background:'#F5F7FA', borderRadius:10 }}>
          <div style={{ marginBottom:10 }}>
            <label style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', display:'block', marginBottom:4 }}>Subject Line</label>
            <input
              value={selected.subject || ''}
              onChange={e => {
                const v = e.target.value
                setSelected(p => ({ ...p, subject: v }))
                setCampaigns(p => p.map(c => c.id === selected.id ? { ...c, subject: v } : c))
              }}
              onBlur={e => supabase.from('campaigns').update({ subject: e.target.value }).eq('id', selected.id)}
              placeholder="e.g. Partnership Opportunity -- My Landlord Certificate"
              style={{ width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'8px 12px', fontSize:13 }}
            />
          </div>
          <div style={{ marginBottom:10 }}>
            <label style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', display:'block', marginBottom:4 }}>
              Email Body
              <span style={{ fontWeight:400, color:'#9CA3AF', marginLeft:8, textTransform:'none' }}>
                Variables: {'{{first_name}}'} {'{{company}}'} {'{{sender_name}}'}
              </span>
            </label>
            <textarea
              value={selected.body || ''}
              onChange={e => {
                const v = e.target.value
                setSelected(p => ({ ...p, body: v }))
                setCampaigns(p => p.map(c => c.id === selected.id ? { ...c, body: v } : c))
              }}
              onBlur={e => supabase.from('campaigns').update({ body: e.target.value }).eq('id', selected.id)}
              rows={10}
              placeholder={'Dear {{first_name}},\n\nI hope this email finds you well.\n\nMy name is {{sender_name}} from My Landlord Certificate. We provide EICR, Gas Safety Certificates, EPCs, Fire Risk Assessments and all property compliance certificates across London.\n\nWe work with many estate agents and would love to support your landlord clients with fast, reliable certificates.\n\nWould you be open to a quick call this week?\n\nKind regards,\n{{sender_name}}\nMy Landlord Certificate\n020 3996 1070'}
              style={{ width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'10px 12px', fontSize:13, fontFamily:'inherit', lineHeight:1.6, resize:'vertical' }}
            />
          </div>

          {/* Inbox selector */}
          <div>
            <label style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', display:'block', marginBottom:6 }}>
              Sending Inboxes ({(selected.inbox_ids || []).length} selected)
            </label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {coldAccounts.map(acc => {
                const isSelected = (selected.inbox_ids || []).includes(acc.id)
                return (
                  <button key={acc.id} type="button"
                    onClick={async () => {
                      const newIds = isSelected
                        ? (selected.inbox_ids || []).filter(id => id !== acc.id)
                        : [...(selected.inbox_ids || []), acc.id]
                      setSelected(p => ({ ...p, inbox_ids: newIds }))
                      setCampaigns(p => p.map(c => c.id === selected.id ? { ...c, inbox_ids: newIds } : c))
                      await supabase.from('campaigns').update({ inbox_ids: newIds }).eq('id', selected.id)
                    }}
                    style={{
                      padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                      background: isSelected ? '#E6F4FC' : '#fff',
                      color: isSelected ? '#0093DB' : '#6B7280',
                      border: isSelected ? '2px solid #0093DB' : '1px solid #E5E7EB',
                    }}>
                    {acc.gmail_address.split('@')[0]}
                  </button>
                )
              })}
            </div>
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
            <div key={s.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', flex: 1, minWidth: 110 }}>
              <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Sequence steps */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
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
                <div style={{ flex: 1, background: '#FFFFFF', borderRadius: 8, padding: '10px 14px' }}>
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
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Contacts ({contacts.length})</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn small variant="teal" onClick={openImportLeads}>📋 Import from Leads</Btn>
                <Btn small onClick={() => setShowAddContacts(true)}>+ Add</Btn>
              </div>
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
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: 20 }}>
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
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: 580, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Add Sequence Step</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Step Number" value={String(newStep.step_number || steps.length + 1)} onChange={v => setNewStep(p => ({ ...p, step_number: v }))} type="number" />
                  <Field label="Send After (days)" value={newStep.delay_days} onChange={v => setNewStep(p => ({ ...p, delay_days: v }))} type="number" hint="0 = immediately on enrolment" />
                </div>
                <Field label="Subject Line" value={newStep.subject} onChange={v => setNewStep(p => ({ ...p, subject: v }))} placeholder="Quick question about {{company}}" />
                <Field label="Email Body" value={newStep.body_html} onChange={v => setNewStep(p => ({ ...p, body_html: v }))} rows={10}
                  placeholder={'Hi {{first_name}},\n\nI noticed you manage properties in London and wanted to reach out about our compliance certification services — EICR, Gas Safety (CP12), EPC, Fire Risk Assessments and more.\n\nWe work with many estate agents in your area and can turn around certificates quickly.\n\nWould you be open to a quick call?\n\nBest,\n{{rep_name}}'} />
                <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: C.muted }}>
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
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: 540, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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
              <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 20 }}>
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

        {/* Import from Leads Modal */}
        {showImportLeads && (
          <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowImportLeads(false)}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: 620, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Import from Leads</div>
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>Select leads with an email address to add to this campaign.</div>

              <div style={{ background:'#E6F4FC', border:'1px solid #0093DB44', borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:12, color:'#1F2937' }}>
                Only leads with a <strong>Verified</strong> email address can be added to a campaign.
                {' '}{importLeads.length} of your leads are currently eligible.
              </div>

              {/* Filter tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {[['all', 'All'], ['cold_agent', 'Estate Agents'], ['inbound', 'Inbound']].map(([k, l]) => (
                  <button key={k} onClick={() => setLeadFilterTab(k)}
                    style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${leadFilterTab === k ? C.accent : '#E5E7EB'}`, background: leadFilterTab === k ? C.accentSoft : '#fff', color: leadFilterTab === k ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: leadFilterTab === k ? 700 : 400 }}>
                    {l}
                  </button>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, cursor: 'pointer', marginLeft: 'auto' }}>
                  <input type="checkbox" checked={hideEmailed} onChange={e => setHideEmailed(e.target.checked)} />
                  Hide leads already emailed
                </label>
              </div>

              {/* Search */}
              <input value={leadSearch} onChange={e => setLeadSearch(e.target.value)} placeholder="Search name or email…"
                style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%', marginBottom: 12 }} />

              {/* Select all + count */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.muted, cursor: 'pointer' }}>
                  <input type="checkbox"
                    checked={filteredImportLeads.length > 0 && filteredImportLeads.every(l => selectedLeadIds.has(l.id))}
                    onChange={e => {
                      setSelectedLeadIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) filteredImportLeads.forEach(l => next.add(l.id))
                        else filteredImportLeads.forEach(l => next.delete(l.id))
                        return next
                      })
                    }} />
                  Select All
                </label>
                <span style={{ fontSize: 12, color: C.dim }}>{selectedLeadIds.size} of {filteredImportLeads.length} selected</span>
              </div>

              {/* List */}
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, maxHeight: 400, overflowY: 'auto' }}>
                {importLoading ? (
                  <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>Loading leads…</div>
                ) : filteredImportLeads.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>No leads found.</div>
                ) : filteredImportLeads.map(l => (
                  <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #F5F7FA', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedLeadIds.has(l.id)}
                      onChange={e => {
                        setSelectedLeadIds(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(l.id); else next.delete(l.id)
                          return next
                        })
                      }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.company || l.contact_name || '—'}
                        {(l.in_campaign || l.email_send_count > 0) && (
                          <span style={{ background:'#FEF3C7', color:'#D97706', borderRadius:5, padding:'1px 6px', fontSize:9, fontWeight:700, marginLeft:6 }}>
                            ALREADY EMAILED
                          </span>
                        )}
                      </div>
                      {l.company && l.contact_name && <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.contact_name}</div>}
                      <div style={{ color: C.dim, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.email}</div>
                    </div>
                    <span style={{ color: C.muted, fontSize: 11, whiteSpace: 'nowrap' }}>{l.status}</span>
                  </label>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <Btn onClick={addSelectedLeadsToCampaign} disabled={saving || selectedLeadIds.size === 0}>
                  {saving ? 'Adding…' : `Add ${selectedLeadIds.size} contact${selectedLeadIds.size !== 1 ? 's' : ''}`}
                </Btn>
                <Btn variant="ghost" onClick={() => setShowImportLeads(false)}>Cancel</Btn>
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
        <Btn onClick={openNewCampaign}>+ New Campaign</Btn>
      </div>

      {campaigns.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No campaigns yet</div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 20 }}>Create your first cold email campaign to start reaching estate agents.</div>
          <Btn onClick={openNewCampaign}>Create Campaign</Btn>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Campaign', 'Target', 'Status', 'Daily Limit', 'Actions'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCampaign(c)}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: C.dim, fontSize: 12 }}>From: {c.from_name}</div>
                    {c.inbox_ids?.length > 0 && (
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:4 }}>
                        {c.inbox_ids.map(id => {
                          const acc = coldAccounts.find(a => a.id === id)
                          return acc ? (
                            <span key={id} style={{ background:'#E6F4FC', color:'#0093DB', borderRadius:4, padding:'1px 6px', fontSize:10, fontWeight:600 }}>
                              {acc.gmail_address.split('@')[0]}
                            </span>
                          ) : null
                        })}
                        {c.rotate_inboxes && c.inbox_ids?.length > 1 && (
                          <span style={{ background:'#F0FAE0', color:'#3d7a00', borderRadius:4, padding:'1px 6px', fontSize:10, fontWeight:600 }}>
                            rotating
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={td}><span style={{ color: C.amber, fontSize: 13 }}>{c.target_type}</span></td>
                  <td style={td}><Badge status={c.status} /></td>
                  <td style={td}><span style={{ color: C.accent }}>{c.daily_limit}/day</span></td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {c.status === 'draft'  && <Btn small variant="success" onClick={() => launchCampaign(c)}>🚀 Launch</Btn>}
                      {c.status === 'active' && <Btn small variant="amber"   onClick={() => updateStatus(c.id, 'paused')}>⏸ Pause</Btn>}
                      {c.status === 'paused' && <Btn small variant="success" onClick={() => updateStatus(c.id, 'active')}>▶ Resume</Btn>}
                      <Btn small variant="ghost" onClick={() => openCampaign(c)}>View</Btn>
                      <button onClick={() => addEligibleLeads(c.id)}
                        style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'5px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                        + Add Leads
                      </button>
                      <button onClick={() => deleteCampaign(c.id)}
                        style={{ background:'#FEE2E2', color:'#DC2626', border:'1px solid #DC262644', borderRadius:6, padding:'5px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                        Delete
                      </button>
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
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>New Campaign</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Campaign Name" value={newCampaign.name} onChange={v => setNewCampaign(p => ({ ...p, name: v }))} placeholder="Q3 Estate Agent Outreach — London" />

              <div style={{ marginBottom:16 }}>
                <label style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:8 }}>
                  Sending Accounts
                </label>

                {/* Rotation toggle */}
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, padding:'10px 14px', background:'#E6F4FC', borderRadius:8, border:'1px solid #0093DB44' }}>
                  <input type="checkbox" id="rotateToggle" checked={rotateInboxes}
                    onChange={e => setRotateInboxes(e.target.checked)}
                    style={{ width:16, height:16, cursor:'pointer' }} />
                  <label htmlFor="rotateToggle" style={{ fontSize:13, color:'#0093DB', fontWeight:600, cursor:'pointer' }}>
                    Rotate across multiple inboxes (recommended)
                  </label>
                  <span style={{ fontSize:11, color:'#0093DB', marginLeft:'auto' }}>
                    Spreads sends across accounts to protect deliverability
                  </span>
                </div>

                {/* Account checkboxes */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {coldAccounts.map(acc => {
                    const isSelected = selectedInboxIds.includes(acc.id)
                    return (
                      <div key={acc.id}
                        onClick={() => {
                          if (isSelected && selectedInboxIds.length === 1) return // keep at least 1
                          setSelectedInboxIds(prev =>
                            isSelected ? prev.filter(id => id !== acc.id) : [...prev, acc.id]
                          )
                        }}
                        style={{
                          display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
                          border: `1px solid ${isSelected ? '#0093DB' : '#E5E7EB'}`,
                          borderRadius:8, cursor:'pointer',
                          background: isSelected ? '#E6F4FC' : '#fff',
                          transition:'all 0.15s'
                        }}>
                        <div style={{
                          width:18, height:18, borderRadius:4, border:`2px solid ${isSelected ? '#0093DB' : '#D1D5DB'}`,
                          background: isSelected ? '#0093DB' : '#fff',
                          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0
                        }}>
                          {isSelected && <span style={{ color:'#fff', fontSize:12, fontWeight:700 }}>✓</span>}
                        </div>
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color: isSelected ? '#0093DB' : '#1F2937' }}>
                            {acc.gmail_address.split('@')[0]}
                          </div>
                          <div style={{ fontSize:10, color:'#9CA3AF' }}>{acc.gmail_address}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {selectedInboxIds.length > 0 && (
                  <div style={{ marginTop:8, fontSize:12, color:'#6B7280' }}>
                    {selectedInboxIds.length} of {coldAccounts.length} accounts selected
                    {rotateInboxes && selectedInboxIds.length > 1
                      ? ` -- emails will rotate across all ${selectedInboxIds.length} inboxes`
                      : ' -- all emails sent from this account'}
                  </div>
                )}
              </div>

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
