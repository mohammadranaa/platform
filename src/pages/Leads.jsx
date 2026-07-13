import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

const LEAD_STATUSES = ['New','Contacted','In Discussion','Declined','Accepted']
const STATUS_COLORS = {
  'New':           { color: C.muted,    bg: C.surface },
  'Contacted':     { color: C.accent,   bg: C.accentSoft },
  'In Discussion': { color: C.amber,    bg: C.amberSoft },
  'Declined':      { color: C.red,      bg: C.redSoft },
  'Accepted':      { color: C.greenDark, bg: C.greenSoft },
}

const TYPE_META = {
  inbound:    { label: 'Inbound',     color: C.accent,  bg: C.accentSoft },
  verified:   { label: 'Verified',    color: C.purple,  bg: C.purpleSoft },
  cold_agent: { label: 'Cold Agents', color: C.amber,   bg: C.amberSoft  },
}

const RENEWAL_YEARS = { 'FRA': 1, 'GSC': 1, 'CP12': 1, 'Gas Safety': 1, 'PAT': 1, 'FSC': 1, 'EICR': 5, 'EPC': 10 }

function calcRenewal(workDone, jobDate) {
  if (!workDone || !jobDate) return null
  let earliest = null
  Object.entries(RENEWAL_YEARS).forEach(([svc, years]) => {
    if (workDone.toLowerCase().includes(svc.toLowerCase())) {
      const d = new Date(jobDate)
      d.setFullYear(d.getFullYear() + years)
      if (!earliest || d < earliest) earliest = d
    }
  })
  return earliest ? earliest.toISOString().slice(0, 10) : null
}

// Parse services string from inbound form e.g. "EICR Certificate — 1–3 Bedrooms (£94.99), Gas Safety..."
function parseServices(servicesStr) {
  if (!servicesStr) return []
  return servicesStr.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const priceMatch = s.match(/\(£([\d.]+)\)/)
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0
    const name = s.replace(/\s*\(£[\d.]+\)/, '').trim()
    return { name, price }
  })
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    purple:  { background: C.purpleSoft, color: C.purple,    border: `1px solid ${C.purple}44` },
    amber:   { background: C.amberSoft,  color: C.amber,     border: `1px solid ${C.amber}66` },
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

const StatusBadge = ({ status }) => {
  const m = STATUS_COLORS[status] || { color: C.muted, bg: C.surface }
  return <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{status}</span>
}

const TypeChip = ({ type }) => {
  const m = TYPE_META[type] || { label: type, color: C.muted, bg: C.surface }
  return <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{m.label}</span>
}

const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const lbl = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

const TABS = [
  { key: 'all', label: 'All Leads' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'verified', label: 'Verified' },
  { key: 'cold_agent', label: 'Cold Agents' },
]

export default function Leads() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast, showToast } = useToast()
  const fileRef = useRef()

  const [leads, setLeads]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [tab, setTab]             = useState(searchParams.get('type') || 'all')
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [renewalFilter, setRenewalFilter] = useState('All')
  const [selected, setSelected]   = useState(null) // lead detail panel
  const [showAdd, setShowAdd]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importType, setImportType] = useState('inbound')
  const [csvText, setCsvText]     = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [addType, setAddType]     = useState('inbound')
  const [form, setForm]           = useState({ status: 'New', email_verified: 'Unknown' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchLeads() }, [tab, profile])

  async function fetchLeads() {
    setLoading(true)
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (tab !== 'all') q = q.eq('lead_type', tab)
    if (!isAdmin) q = q.eq('assigned_to', profile?.id)
    const { data } = await q
    setLeads(data || [])
    setLoading(false)
  }

  // ── Update lead status ─────────────────────────────────────
  async function updateStatus(leadId, status) {
    await supabase.from('leads').update({ status }).eq('id', leadId)
    setLeads(p => p.map(l => l.id === leadId ? { ...l, status } : l))
    if (selected?.id === leadId) setSelected(p => ({ ...p, status }))

    // If accepted → auto-convert to client
    if (status === 'Accepted') {
      await convertToClient(leads.find(l => l.id === leadId) || selected)
    }
    showToast(`Status → ${status}`)
  }

  // ── Convert lead to client ─────────────────────────────────
  async function convertToClient(lead) {
    if (!lead) return
    const clientName = lead.inbound_name || lead.company_name || `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()
    const email = lead.inbound_email || lead.email_address || lead.cold_email
    const phone = lead.inbound_phone || lead.job_telephone || lead.job_mobile || lead.direct_number

    // Create client
    const { data: client, error } = await supabase.from('clients').insert({
      client_type: lead.lead_type === 'cold_agent' ? 'Estate Agent' : 'Landlord',
      company_name: lead.company_name || lead.cold_company_name || null,
      first_name: lead.contact_first || (lead.inbound_name ? lead.inbound_name.split(' ')[0] : null),
      last_name: lead.contact_last || (lead.inbound_name ? lead.inbound_name.split(' ').slice(1).join(' ') : null),
      email,
      phone,
      street_address: lead.street_address || lead.address || lead.cold_address,
      city: lead.city,
      postcode: lead.postcode,
      source: 'converted-lead',
      lead_id: lead.id,
      assigned_to: lead.assigned_to || profile.id,
      is_active: true,
      status: 'Active',
    }).select().single()

    if (error) { showToast('Client created but error: ' + error.message, 'error'); return }

    showToast(`✓ ${clientName} added to clients`)

    // For inbound leads that are paid → also create jobs automatically
    if (lead.lead_type === 'inbound' && lead.payment_status?.toLowerCase() === 'paid') {
      await autoCreateJobs(lead, client.id)
    }
  }

  // ── Auto-create jobs from inbound lead ────────────────────
  async function autoCreateJobs(lead, clientId) {
    const services = parseServices(lead.services_requested)
    if (!services.length) return

    const siteAddress = [lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ')

    // Group by address — since it's one form entry, all services go to one job
    const { data: job } = await supabase.from('jobs').insert({
      client_id: clientId,
      lead_id: lead.id,
      title: services.map(s => s.name.split('—')[0].trim()).join(' + '),
      service_types: services.map(s => s.name),
      site_address: siteAddress,
      site_postcode: lead.postcode,
      scheduled_date: lead.appointment_date,
      scheduled_slot: lead.time_slot,
      status: lead.payment_status?.toLowerCase() === 'paid' ? 'Scheduled' : 'Quote',
      payment_status: lead.payment_status?.toLowerCase() === 'paid' ? 'Paid' : 'Unpaid',
      payment_amount: lead.payment_status?.toLowerCase() === 'paid' ? lead.total_price : 0,
      invoice_amount: lead.total_price || 0,
      quoted_amount: lead.total_price || 0,
      source: 'inbound-form',
      assigned_to: lead.assigned_to || profile.id,
    }).select().single()

    if (job) {
      // Insert line items per service
      await supabase.from('job_line_items').insert(
        services.map(s => ({
          job_id: job.id,
          description: s.name,
          item_type: 'certificate',
          quantity: 1,
          unit: 'ea',
          unit_price: s.price,
        }))
      )
      showToast(`✓ Job created: ${job.job_number}`)
    }
  }

  // ── CSV parsing ────────────────────────────────────────────
  function parseCSV(text) {
    const lines = text.trim().split('\n').filter(Boolean)
    if (lines.length < 2) return []
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase().replace(/[\s\-\/]+/g, '_'))
    return lines.slice(1).map(line => {
      const vals = []
      let current = '', inQuotes = false
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes
        else if (ch === ',' && !inQuotes) { vals.push(current.trim()); current = '' }
        else current += ch
      }
      vals.push(current.trim())
      const row = {}
      headers.forEach((h, i) => { row[h] = vals[i] || '' })
      return row
    }).filter(row => Object.values(row).some(v => v))
  }

  function handleCSVFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setCsvText(ev.target.result); setCsvPreview(parseCSV(ev.target.result).slice(0, 3)) }
    reader.readAsText(file)
  }

  async function importCSV() {
    if (!csvText) return
    const rows = parseCSV(csvText)
    if (!rows.length) { showToast('No valid rows found', 'error'); return }
    setImporting(true)

    const toInsert = rows.map(row => {
      if (importType === 'inbound') {
        const services = row.services_readable || row['services_(readable)'] || row.services || ''
        const payStatus = (row.payment_status || '').toLowerCase()
        const autoStatus = payStatus === 'paid' ? 'Accepted' : 'New'
        return {
          lead_type: 'inbound',
          form_timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
          inbound_name: row.name || '',
          inbound_email: row.email || '',
          inbound_phone: row.phone || '',
          tenant_phone: row.tenant_phone || '',
          street_address: row.street_address || row.address || '',
          city: row.city || '',
          postcode: row.postcode || '',
          property_type: row.property_type || '',
          property_subtype: row.property_sub_type || row.property_subtype || '',
          services_requested: services,
          additional_charges: row.additional_charges || '',
          appointment_date: row.appointment_date || null,
          time_slot: row.time_slot || '',
          total_price: parseFloat(row.total_price) || null,
          payment_status: row.payment_status || '',
          status: autoStatus,
          assigned_to: profile.id,
        }
      } else if (importType === 'verified') {
        const workDone = row.previous_job || row.work_done || ''
        const jobDate = row.date || row.previous_job_date || null
        return {
          lead_type: 'verified',
          form_timestamp: jobDate ? new Date(jobDate).toISOString() : null,
          previous_job_date: jobDate || null,
          company_name: row.company || '',
          contact_first: row.contact_first || '',
          contact_last: row.contact_last || '',
          email_address: row.email_address || row.email || '',
          job_telephone: row.telephone_number || row.job_telephone || '',
          job_mobile: row.mobile_number || row.job_mobile || '',
          address: row.address || '',
          work_done: workDone,
          last_payment_amount: parseFloat(row.payment_amount) || null,
          last_invoice_amount: parseFloat(row.total_invoice_amount) || null,
          notes: row.notes || '',
          renewal_due_date: calcRenewal(workDone, jobDate),
          renewal_services: workDone,
          status: 'New',
          assigned_to: profile.id,
        }
      } else {
        return {
          lead_type: 'cold_agent',
          cold_company_name: row.company_name || '',
          cold_address: row.address || '',
          cold_contact_name: row.name || '',
          zoopla_number: row.zoopla_number || row.zoople_number || '',
          landline_number: row.landline_number || '',
          direct_number: row.direct_number || '',
          cold_email: row.email || '',
          email_verified: row.email_verified === 'Verified' || row.email_verified === 'yes' || row.email_verified === 'true' ? 'Verified' : row.email_verified === 'Unverified' ? 'Unverified' : 'Unknown',
          website: row.website || '',
          status: 'New',
          assigned_to: profile.id,
        }
      }
    })

    const { error } = await supabase.from('leads').insert(toInsert)
    setImporting(false)
    if (error) { showToast(error.message, 'error'); return }

    // Auto-convert paid inbound leads
    if (importType === 'inbound') {
      const paidRows = toInsert.filter(r => r.status === 'Accepted')
      showToast(`${toInsert.length} leads imported · ${paidRows.length} auto-converted (paid)`)
    } else {
      showToast(`${toInsert.length} leads imported ✓`)
    }

    await fetchLeads()
    setShowImport(false)
    setCsvText('')
    setCsvPreview([])
  }

  // ── Add single lead ────────────────────────────────────────
  async function addLead() {
    setSaving(true)
    const payload = { ...form, lead_type: addType, assigned_to: profile.id }
    if (addType === 'verified' && payload.work_done && payload.previous_job_date) {
      payload.renewal_due_date = calcRenewal(payload.work_done, payload.previous_job_date)
    }
    const { error } = await supabase.from('leads').insert(payload)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchLeads()
    setShowAdd(false)
    setForm({ status: 'New', email_verified: 'Unknown' })
    showToast('Lead added ✓')
  }

  // ── Display helpers ────────────────────────────────────────
  const displayName = l => {
    if (l.lead_type === 'inbound')    return l.inbound_name || l.inbound_email || '—'
    if (l.lead_type === 'verified')   return l.company_name || `${l.contact_first || ''} ${l.contact_last || ''}`.trim() || l.email_address || '—'
    return l.cold_company_name || l.cold_contact_name || l.cold_email || '—'
  }
  const displayEmail = l => l.inbound_email || l.email_address || l.cold_email || '—'
  const displayPhone = l => l.inbound_phone || l.job_telephone || l.job_mobile || l.direct_number || l.landline_number || '—'

  const counts = {
    all: leads.length,
    inbound: leads.filter(l => l.lead_type === 'inbound').length,
    verified: leads.filter(l => l.lead_type === 'verified').length,
    cold_agent: leads.filter(l => l.lead_type === 'cold_agent').length,
  }

  const filtered = useMemo(() => leads
    .filter(l => filterStatus === 'All' || l.status === filterStatus)
    .filter(l => {
      if (renewalFilter === 'All' || l.lead_type !== 'verified') return renewalFilter === 'All' ? true : false
      const days = l.renewal_due_date ? Math.floor((new Date(l.renewal_due_date) - new Date()) / 86400000) : null
      if (renewalFilter === '0') return days !== null && days < 0
      return days !== null && days <= parseInt(renewalFilter)
    })
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
      return displayName(l).toLowerCase().includes(q) || displayEmail(l).toLowerCase().includes(q) || (l.company_name || l.cold_company_name || '').toLowerCase().includes(q)
    })
  , [leads, filterStatus, renewalFilter, search])

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }

  // ── Render columns per tab ─────────────────────────────────
  const renderRow = (l) => {
    const days = l.renewal_due_date ? Math.floor((new Date(l.renewal_due_date) - new Date()) / 86400000) : null
    const renewColor = days === null ? C.dim : days < 0 ? C.red : days <= 14 ? C.amber : C.greenDark

    return (
      <tr key={l.id}
        onMouseEnter={e => e.currentTarget.style.background = C.surface}
        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
        {/* Name */}
        <td style={td}>
          <div style={{ fontWeight: 600, color: C.text }}>{displayName(l)}</div>
          {l.lead_type === 'verified' && l.company_name && <div style={{ fontSize: 12, color: C.muted }}>{l.contact_first} {l.contact_last}</div>}
          {l.form_timestamp && <div style={{ fontSize: 11, color: C.dim }}>{new Date(l.form_timestamp).toLocaleDateString('en-GB')}</div>}
        </td>

        {/* Type (all tab only) */}
        {tab === 'all' && <td style={td}><TypeChip type={l.lead_type} /></td>}

        {/* Email */}
        <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{displayEmail(l)}</span></td>

        {/* Phone */}
        <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{displayPhone(l)}</span></td>

        {/* Type-specific columns */}
        {(tab === 'inbound') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.street_address}{l.city ? `, ${l.city}` : ''} {l.postcode}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.property_type} {l.property_subtype ? `· ${l.property_subtype}` : ''}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.services_requested ? l.services_requested.split(',').length + ' services' : '—'}</span></td>
          <td style={td}><span style={{ fontSize: 13, fontWeight: 600, color: C.greenDark }}>{l.total_price ? `£${l.total_price}` : '—'}</span></td>
          <td style={td}><span style={{ background: l.payment_status?.toLowerCase() === 'paid' ? C.greenSoft : C.amberSoft, color: l.payment_status?.toLowerCase() === 'paid' ? C.greenDark : C.amber, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{l.payment_status || '—'}</span></td>
        </>}

        {(tab === 'verified') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.address}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.work_done}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.greenDark }}>{l.last_payment_amount ? `£${l.last_payment_amount}` : '—'}</span></td>
          <td style={td}>
            {l.renewal_due_date ? (
              <span style={{ color: renewColor, fontSize: 12, fontWeight: 600 }}>
                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d — ${l.renewal_due_date}`}
              </span>
            ) : <span style={{ color: C.dim }}>—</span>}
          </td>
        </>}

        {(tab === 'cold_agent') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.cold_address}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.direct_number || l.landline_number}</span></td>
          <td style={td}>
            <span style={{
              background: l.email_verified === 'Verified' ? C.greenSoft : l.email_verified === 'Unverified' ? C.redSoft : C.surface,
              color: l.email_verified === 'Verified' ? C.greenDark : l.email_verified === 'Unverified' ? C.red : C.muted,
              borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600,
            }}>{l.email_verified || 'Unknown'}</span>
          </td>
          <td style={td}>{l.website ? <a href={l.website} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 12 }}>Visit</a> : <span style={{ color: C.dim }}>—</span>}</td>
        </>}

        {/* Status */}
        <td style={td}><StatusBadge status={l.status} /></td>

        {/* Actions */}
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <select value={l.status} onChange={e => updateStatus(l.id, e.target.value)}
              style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </td>
      </tr>
    )
  }

  const renderHeaders = () => {
    const common = ['Name', 'Email', 'Phone']
    const typeSpecific = {
      inbound:    ['Address','Property','Services','Price','Payment'],
      verified:   ['Address','Work Done','Last Payment','Renewal Due'],
      cold_agent: ['Address','Phone','Email Verified','Website'],
    }
    const headers = [
      ...(tab === 'all' ? ['Type'] : []),
      ...common,
      ...(tab !== 'all' ? (typeSpecific[tab] || []) : []),
      'Status', 'Change Status',
    ]
    return headers.map(h => <th key={h} style={th}>{h}</th>)
  }

  return (
    <div>
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Leads</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{leads.length} total · {filtered.length} shown</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && <Btn small variant="ghost" onClick={() => setShowImport(true)}>⬆ Import CSV</Btn>}
          <Btn small onClick={() => setShowAdd(true)}>+ Add Lead</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, marginBottom: 16, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setRenewalFilter('All') }}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 400, background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? C.accent : C.muted }}>
            {t.label} <span style={{ color: tab === t.key ? C.accent : C.dim, fontSize: 12 }}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company…"
          style={{ ...inp, flex: 1, minWidth: 200, width: 'auto', padding: '8px 14px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All Statuses</option>
          {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        {(tab === 'verified' || tab === 'all') && (
          <select value={renewalFilter} onChange={e => setRenewalFilter(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
            <option value="All">All Renewals</option>
            <option value="14">Due in 14 days</option>
            <option value="30">Due in 30 days</option>
            <option value="60">Due in 60 days</option>
            <option value="0">Overdue</option>
          </select>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No leads found.{' '}
            {isAdmin && <button onClick={() => setShowImport(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Import CSV</button>}
            {' or '}<button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Add one →</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead><tr>{renderHeaders()}</tr></thead>
            <tbody>{filtered.map(renderRow)}</tbody>
          </table>
        )}
      </div>

      {/* ── Import Modal ─────────────────────────────────────── */}
      {showImport && isAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowImport(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Import Leads — CSV</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Admin only. First row must be column headers.</div>

            {/* Type */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => setImportType(key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${importType === key ? meta.color : C.border}`, background: importType === key ? meta.bg : '#fff', color: importType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: importType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            {/* Column guide */}
            <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>Expected columns ({TYPE_META[importType]?.label}):</strong><br /><br />
              {importType === 'inbound' && 'Timestamp, Name, Email, Phone, Tenant Phone, Street Address, City, Postcode, Property Type, Property Sub-Type, Services (Readable), Additional Charges, Appointment Date, Time Slot, Total Price, Payment Status, Status'}
              {importType === 'verified' && 'Date, Company, Contact First, Contact Last, Email Address, Telephone Number, Mobile Number, Address, Previous Job, Payment Amount, Total Invoice Amount, Notes'}
              {importType === 'cold_agent' && 'Company Name, Address, Name, Zoopla Number, Landline Number, Direct Number, Email, Email Verified, Website'}
            </div>

            {/* Notes for inbound */}
            {importType === 'inbound' && (
              <div style={{ background: C.accentSoft, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.accent }}>
                ℹ Paid inbound leads will be automatically converted to clients and jobs on import.
              </div>
            )}
            {importType === 'cold_agent' && (
              <div style={{ background: C.greenSoft, border: `1px solid ${C.green}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.greenDark }}>
                ℹ Only leads with Email Verified = "Verified" will be available for email campaigns.
              </div>
            )}

            <label style={{ ...lbl, marginBottom: 6 }}>Upload CSV File</label>
            <input type="file" accept=".csv" onChange={handleCSVFile}
              style={{ display: 'block', padding: '8px', border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', fontSize: 13, marginBottom: 14, cursor: 'pointer' }} />

            <label style={{ ...lbl, marginBottom: 6 }}>Or Paste CSV Content</label>
            <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setCsvPreview(parseCSV(e.target.value).slice(0, 3)) }} rows={5}
              placeholder="Paste CSV here…"
              style={{ ...inp, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, marginBottom: 14 }} />

            {csvPreview.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Preview (first {csvPreview.length} rows)</label>
                <div style={{ background: C.surface, borderRadius: 8, padding: 12, fontSize: 11, color: C.muted, maxHeight: 120, overflowY: 'auto', fontFamily: 'monospace' }}>
                  {csvPreview.map((row, i) => (
                    <div key={i} style={{ padding: '3px 0', borderBottom: `1px solid ${C.border}` }}>
                      {Object.entries(row).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  ))}
                </div>
                <div style={{ color: C.accent, fontSize: 13, marginTop: 6 }}>{parseCSV(csvText).length} rows ready to import</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={importCSV} disabled={importing || !csvText.trim()}>{importing ? 'Importing…' : `Import ${parseCSV(csvText).length || 0} Leads`}</Btn>
              <Btn variant="ghost" onClick={() => { setShowImport(false); setCsvText(''); setCsvPreview([]) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Lead Modal ───────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 20 }}>Add New Lead</div>

            {/* Type selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => setAddType(key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${addType === key ? meta.color : C.border}`, background: addType === key ? meta.bg : '#fff', color: addType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: addType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Status always shown */}
              <div><label style={lbl}>Status</label>
                <select value={form.status || 'New'} onChange={e => set('status', e.target.value)} style={inp}>
                  {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {addType === 'inbound' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Full Name</label><input value={form.inbound_name || ''} onChange={e => set('inbound_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.inbound_email || ''} onChange={e => set('inbound_email', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Phone</label><input value={form.inbound_phone || ''} onChange={e => set('inbound_phone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Tenant Phone</label><input value={form.tenant_phone || ''} onChange={e => set('tenant_phone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Property Type</label><input value={form.property_type || ''} onChange={e => set('property_type', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Street Address</label><input value={form.street_address || ''} onChange={e => set('street_address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>City</label><input value={form.city || ''} onChange={e => set('city', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Postcode</label><input value={form.postcode || ''} onChange={e => set('postcode', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Services Requested</label><input value={form.services_requested || ''} onChange={e => set('services_requested', e.target.value)} placeholder="EICR Certificate — 1–3 Bedrooms (£94.99), Gas Safety (£84.99)" style={inp} /></div>
                <div><label style={lbl}>Appointment Date</label><input type="date" value={form.appointment_date || ''} onChange={e => set('appointment_date', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Time Slot</label>
                  <select value={form.time_slot || ''} onChange={e => set('time_slot', e.target.value)} style={inp}>
                    <option value="">—</option><option>Morning (8am–12pm)</option><option>Afternoon (12pm–6pm)</option>
                  </select>
                </div>
                <div><label style={lbl}>Total Price (£)</label><input type="number" value={form.total_price || ''} onChange={e => set('total_price', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Payment Status</label>
                  <select value={form.payment_status || ''} onChange={e => set('payment_status', e.target.value)} style={inp}>
                    <option value="">—</option><option>Paid</option><option>Unpaid</option><option>Partial</option>
                  </select>
                </div>
              </>}

              {addType === 'verified' && <>
                <div><label style={lbl}>Company</label><input value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact First</label><input value={form.contact_first || ''} onChange={e => set('contact_first', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact Last</label><input value={form.contact_last || ''} onChange={e => set('contact_last', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.email_address || ''} onChange={e => set('email_address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Telephone</label><input value={form.job_telephone || ''} onChange={e => set('job_telephone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Mobile</label><input value={form.job_mobile || ''} onChange={e => set('job_mobile', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Job Date</label><input type="date" value={form.previous_job_date || ''} onChange={e => set('previous_job_date', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Previous Job / Work Done</label><input value={form.work_done || ''} onChange={e => set('work_done', e.target.value)} placeholder="EICR, GSC, FRA…" style={inp} /></div>
                <div><label style={lbl}>Payment Amount (£)</label><input type="number" value={form.last_payment_amount || ''} onChange={e => set('last_payment_amount', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Invoice Amount (£)</label><input type="number" value={form.last_invoice_amount || ''} onChange={e => set('last_invoice_amount', e.target.value)} style={inp} /></div>
                {form.previous_job_date && form.work_done && (
                  <div style={{ gridColumn: 'span 2', background: C.purpleSoft, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.purple }}>
                    📅 Renewal due: <strong>{calcRenewal(form.work_done, form.previous_job_date)}</strong>
                  </div>
                )}
              </>}

              {addType === 'cold_agent' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Company Name</label><input value={form.cold_company_name || ''} onChange={e => set('cold_company_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact Name</label><input value={form.cold_contact_name || ''} onChange={e => set('cold_contact_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.cold_email || ''} onChange={e => set('cold_email', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email Verified</label>
                  <select value={form.email_verified || 'Unknown'} onChange={e => set('email_verified', e.target.value)} style={inp}>
                    <option>Unknown</option><option>Verified</option><option>Unverified</option>
                  </select>
                </div>
                <div><label style={lbl}>Direct Number</label><input value={form.direct_number || ''} onChange={e => set('direct_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Landline</label><input value={form.landline_number || ''} onChange={e => set('landline_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Zoopla Number</label><input value={form.zoopla_number || ''} onChange={e => set('zoopla_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Website</label><input value={form.website || ''} onChange={e => set('website', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Address</label><input value={form.cold_address || ''} onChange={e => set('cold_address', e.target.value)} style={inp} /></div>
              </>}

              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Notes</label>
                <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
                  style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Btn onClick={addLead} disabled={saving}>{saving ? 'Saving…' : 'Add Lead'}</Btn>
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
