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
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const TYPE_META = {
  inbound:    { label: 'Inbound',     color: C.accent,  bg: C.accentSoft },
  verified:   { label: 'Verified',    color: C.purple,  bg: C.purpleSoft },
  cold_agent: { label: 'Cold Agent',  color: C.amber,   bg: C.amberSoft  },
}

const MLC_SERVICES = ['EICR','GSC (CP12)','EPC','FRA','FSC','PAT Testing','Remedial Works','Consumer Unit','Diagnostics','Other']

const RENEWAL_YEARS = { 'FRA': 1, 'GSC': 1, 'CP12': 1, 'Gas Safety': 1, 'PAT': 1, 'FSC': 1, 'EICR': 5, 'EPC': 10 }

function calculateRenewal(workDone, jobDate) {
  if (!workDone || !jobDate) return null
  let earliest = null
  Object.entries(RENEWAL_YEARS).forEach(([service, years]) => {
    if (workDone.toLowerCase().includes(service.toLowerCase())) {
      const d = new Date(jobDate)
      d.setFullYear(d.getFullYear() + years)
      if (!earliest || d < earliest) earliest = d
    }
  })
  return earliest ? earliest.toISOString().slice(0, 10) : null
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,    color: '#fff',       border: 'none' },
    ghost:   { background: '#fff',      color: C.muted,      border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,   color: C.red,        border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.greenDark,  border: `1px solid ${C.green}66` },
    purple:  { background: C.purpleSoft,color: C.purple,     border: `1px solid ${C.purple}44` },
    amber:   { background: C.amberSoft, color: C.amber,      border: `1px solid ${C.amber}66` },
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

const TypeChip = ({ type }) => {
  const m = TYPE_META[type] || { label: type, color: C.muted, bg: C.surface }
  return <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</span>
}

const TABS = [
  { key: 'all', label: 'All Leads' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'verified', label: 'Verified' },
  { key: 'cold_agent', label: 'Cold Agents' },
]

const inputStyle = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const labelStyle = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

export default function Leads() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast, showToast } = useToast()
  const fileRef = useRef()

  const [leads, setLeads]     = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [tab, setTab]         = useState(searchParams.get('type') || 'all')
  const [search, setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [renewalFilter, setRenewalFilter] = useState(searchParams.get('filter') === 'renewals' ? '30' : 'All')

  // Modals
  const [showAdd, setShowAdd]       = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [addType, setAddType]       = useState('inbound')
  const [importType, setImportType] = useState('inbound')
  const [csvText, setCsvText]       = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [importing, setImporting]   = useState(false)

  // Form
  const blank = { lead_type: 'inbound', status: 'New', notes: '' }
  const [form, setForm] = useState(blank)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchLeads() }, [tab, profile])

  async function fetchLeads() {
    setLoading(true)
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (tab !== 'all') q = q.eq('lead_type', tab)
    if (!isAdmin) q = q.eq('assigned_to', profile?.id)
    const { data, error } = await q
    if (!error) setLeads(data || [])
    setLoading(false)
  }

  // ── CSV Import ────────────────────────────────────────────────
  function parseCSV(text) {
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase().replace(/\s+/g, '_'))
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/"/g, ''))
      const row = {}
      headers.forEach((h, i) => { row[h] = vals[i] || '' })
      return row
    }).filter(row => Object.values(row).some(v => v))
  }

  function handleCSVFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target.result
      setCsvText(text)
      setCsvPreview(parseCSV(text).slice(0, 5))
    }
    reader.readAsText(file)
  }

  async function importCSV() {
    if (!csvText) return
    const rows = parseCSV(csvText)
    if (!rows.length) { showToast('No valid rows found in CSV', 'error'); return }
    setImporting(true)
    const toInsert = rows.map(row => {
      if (importType === 'inbound') {
        return {
          lead_type: 'inbound',
          inbound_name: row.name || row.full_name || '',
          inbound_email: row.email || '',
          inbound_phone: row.phone || '',
          tenant_name: row.tenant || row.tenant_name || '',
          tenant_phone: row.tenant_phone || '',
          street_address: row.street_address || row.address || '',
          city: row.city || '',
          postcode: row.postcode || '',
          property_type: row.property_type || '',
          property_subtype: row.property_sub_type || row.property_subtype || '',
          services_requested: row.services || '',
          additional_charges: row.additional_charges || '',
          appointment_date: row.appointment_date || null,
          time_slot: row.time_slot || '',
          total_price: parseFloat(row.total_price) || null,
          payment_status: row.payment_status || '',
          status: row.status || 'New',
          notes: row.notes || '',
          assigned_to: profile.id,
        }
      } else if (importType === 'verified') {
        const jobDate = row.previous_job_date || null
        const workDone = row.work_done || ''
        const renewalDate = calculateRenewal(workDone, jobDate)
        return {
          lead_type: 'verified',
          previous_job_date: jobDate || null,
          previous_job_status: row.previous_job_status || '',
          company_name: row.company || '',
          contact_first: row.contact_first || '',
          contact_last: row.contact_last || '',
          email_address: row.email_address || row.email || '',
          job_telephone: row.job_telephone_number || row.job_telephone || '',
          job_mobile: row.job_mobile_number || row.job_mobile || '',
          address: row.address || '',
          billing_address: row.billing_address || '',
          work_done: workDone,
          last_payment_amount: parseFloat(row.last_payment_amount) || null,
          last_invoice_amount: parseFloat(row.last_total_invoice_amount) || null,
          notes: row.notes || '',
          current_payment: row.current_payment || '',
          current_status: row.current_status || '',
          current_notes: row.current_notes || '',
          renewal_due_date: renewalDate,
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
          email_verified: row.email_verified === 'true' || row.email_verified === 'yes' || false,
          website: row.website || '',
          status: row.status || 'New',
          assigned_to: profile.id,
        }
      }
    })
    const { error } = await supabase.from('leads').insert(toInsert)
    setImporting(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchLeads()
    setShowImport(false)
    setCsvText('')
    setCsvPreview([])
    showToast(`${toInsert.length} leads imported ✓`)
  }

  // ── Add single lead ───────────────────────────────────────────
  async function addLead() {
    setSaving(true)
    const payload = { ...form, lead_type: addType, assigned_to: profile.id }
    if (addType === 'verified' && payload.previous_job_date && payload.work_done) {
      payload.renewal_due_date = calculateRenewal(payload.work_done, payload.previous_job_date)
    }
    const { error } = await supabase.from('leads').insert(payload)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchLeads()
    setShowAdd(false)
    setForm(blank)
    showToast('Lead added ✓')
  }

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    return leads
      .filter(l => filterStatus === 'All' || l.status === filterStatus)
      .filter(l => {
        if (renewalFilter === 'All') return true
        const days = l.renewal_due_date ? Math.floor((new Date(l.renewal_due_date) - new Date()) / 86400000) : null
        if (days === null || days === undefined) return false
        return days <= parseInt(renewalFilter)
      })
      .filter(l => {
        if (!search) return true
        const q = search.toLowerCase()
        const name = displayName(l).toLowerCase()
        const email = (l.email_address || l.inbound_email || l.cold_email || '').toLowerCase()
        const company = (l.company_name || l.cold_company_name || '').toLowerCase()
        return name.includes(q) || email.includes(q) || company.includes(q)
      })
  }, [leads, filterStatus, renewalFilter, search])

  function displayName(l) {
    if (l.lead_type === 'inbound') return l.inbound_name || l.inbound_email || '—'
    if (l.lead_type === 'verified') return l.company_name || `${l.contact_first || ''} ${l.contact_last || ''}`.trim() || l.email_address || '—'
    return l.cold_company_name || l.cold_contact_name || l.cold_email || '—'
  }

  function displayEmail(l) {
    return l.email_address || l.inbound_email || l.cold_email || '—'
  }

  function displayPhone(l) {
    return l.inbound_phone || l.job_telephone || l.job_mobile || l.direct_number || l.landline_number || '—'
  }

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }

  const counts = {
    all: leads.length,
    inbound: leads.filter(l => l.lead_type === 'inbound').length,
    verified: leads.filter(l => l.lead_type === 'verified').length,
    cold_agent: leads.filter(l => l.lead_type === 'cold_agent').length,
  }

  return (
    <div>
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
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 400, background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? C.accent : C.muted }}>
            {t.label} <span style={{ color: tab === t.key ? C.accent : C.dim, fontSize: 12 }}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, company…"
          style={{ ...inputStyle, flex: 1, minWidth: 200, width: 'auto', padding: '8px 14px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All Statuses</option>
          {['New','Contacted','Qualified','Proposal Sent','Active','Closed Won','Closed Lost','Unsubscribed'].map(s => <option key={s}>{s}</option>)}
        </select>
        {(tab === 'verified' || tab === 'all') && (
          <select value={renewalFilter} onChange={e => setRenewalFilter(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '8px 12px' }}>
            <option value="All">All Renewals</option>
            <option value="14">Renewal in 14 days</option>
            <option value="30">Renewal in 30 days</option>
            <option value="60">Renewal in 60 days</option>
            <option value="0">Overdue renewals</option>
          </select>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No leads found.
            {isAdmin && <> <button onClick={() => setShowImport(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Import CSV</button> or <button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>add one →</button></>}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name / Company', 'Type', 'Email', 'Phone', 'Status', tab === 'verified' ? 'Renewal Due' : 'Service/Work', 'Added'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const days = l.renewal_due_date ? Math.floor((new Date(l.renewal_due_date) - new Date()) / 86400000) : null
                const renewalColor = days === null ? C.dim : days < 0 ? C.red : days <= 14 ? C.amber : C.greenDark
                return (
                  <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: C.text }}>{displayName(l)}</div>
                      {l.lead_type === 'verified' && l.company_name && <div style={{ fontSize: 12, color: C.muted }}>{l.contact_first} {l.contact_last}</div>}
                    </td>
                    <td style={td}><TypeChip type={l.lead_type} /></td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{displayEmail(l)}</span></td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{displayPhone(l)}</span></td>
                    <td style={td}>
                      <span style={{ background: C.surface, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                        {l.status || 'New'}
                      </span>
                    </td>
                    <td style={td}>
                      {l.lead_type === 'verified' ? (
                        <div>
                          <div style={{ fontSize: 12, color: renewalColor, fontWeight: 600 }}>
                            {l.renewal_due_date ? (days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d — ${l.renewal_due_date}`) : '—'}
                          </div>
                          <div style={{ fontSize: 11, color: C.dim }}>{l.work_done}</div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 13, color: C.muted }}>{l.services_requested || l.cold_company_name || '—'}</span>
                      )}
                    </td>
                    <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Import Modal ────────────────────────────────────── */}
      {showImport && isAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowImport(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Import Leads from CSV</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Admin only. Select lead type and upload your CSV file.</div>

            {/* Type selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => setImportType(key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${importType === key ? meta.color : C.border}`, background: importType === key ? meta.bg : '#fff', color: importType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: importType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            {/* Column guide */}
            <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>Expected CSV columns for {TYPE_META[importType]?.label}:</strong><br /><br />
              {importType === 'inbound' && 'Name, Email, Phone, Tenant, Tenant Phone, Street Address, City, Postcode, Property Type, Property Sub-Type, Services, Additional Charges, Appointment Date, Time Slot, Total Price, Payment Status, Status, Notes'}
              {importType === 'verified' && 'Previous Job Date, Previous Job Status, Company, Contact First, Contact Last, Email Address, Job Telephone Number, Job Mobile Number, Address, Billing Address, Work Done, Last Payment Amount, Last Total Invoice Amount, Notes, Current Payment, Current Status, Current Notes'}
              {importType === 'cold_agent' && 'Company Name, Address, Name, Zoopla Number, Landline Number, Direct Number, Email, Email Verified, Website, Status'}
            </div>

            {/* Upload */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Upload CSV File</label>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVFile}
                style={{ display: 'block', padding: '8px', border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', fontSize: 13, cursor: 'pointer' }} />
            </div>

            {/* Or paste */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Or Paste CSV Data</label>
              <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setCsvPreview(parseCSV(e.target.value).slice(0, 5)) }} rows={6}
                placeholder="Paste CSV content here…"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
            </div>

            {/* Preview */}
            {csvPreview.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Preview (first {csvPreview.length} rows)</label>
                <div style={{ background: C.surface, borderRadius: 8, padding: 12, fontSize: 12, color: C.muted, maxHeight: 160, overflowY: 'auto' }}>
                  {csvPreview.map((row, i) => (
                    <div key={i} style={{ padding: '4px 0', borderBottom: `1px solid ${C.border}`, fontFamily: 'monospace' }}>
                      {Object.entries(row).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  ))}
                </div>
                <div style={{ color: C.accent, fontSize: 13, marginTop: 6 }}>
                  {parseCSV(csvText).length} rows ready to import
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={importCSV} disabled={importing || !csvText.trim()}>{importing ? 'Importing…' : `Import ${parseCSV(csvText).length || 0} Leads`}</Btn>
              <Btn variant="ghost" onClick={() => { setShowImport(false); setCsvText(''); setCsvPreview([]) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Lead Modal ─────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 600, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 20 }}>Add New Lead</div>

            {/* Type */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => { setAddType(key); set('lead_type', key) }}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${addType === key ? meta.color : C.border}`, background: addType === key ? meta.bg : '#fff', color: addType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: addType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {addType === 'inbound' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Full Name</label><input value={form.inbound_name || ''} onChange={e => set('inbound_name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Email</label><input type="email" value={form.inbound_email || ''} onChange={e => set('inbound_email', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Phone</label><input value={form.inbound_phone || ''} onChange={e => set('inbound_phone', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Tenant Name</label><input value={form.tenant_name || ''} onChange={e => set('tenant_name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Tenant Phone</label><input value={form.tenant_phone || ''} onChange={e => set('tenant_phone', e.target.value)} style={inputStyle} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Street Address</label><input value={form.street_address || ''} onChange={e => set('street_address', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>City</label><input value={form.city || ''} onChange={e => set('city', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Postcode</label><input value={form.postcode || ''} onChange={e => set('postcode', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Property Type</label>
                  <select value={form.property_type || ''} onChange={e => set('property_type', e.target.value)} style={inputStyle}>
                    <option value="">—</option>
                    {['Residential','Commercial','HMO','Flat','House','Studio'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>Property Sub-Type</label>
                  <select value={form.property_subtype || ''} onChange={e => set('property_subtype', e.target.value)} style={inputStyle}>
                    <option value="">—</option>
                    {['Studio','1 Bed','2 Bed','3 Bed','4 Bed','5 Bed+'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Services Requested</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {MLC_SERVICES.map(s => {
                      const services = (form.services_requested || '').split(',').map(x => x.trim())
                      const active = services.includes(s)
                      return <button key={s} onClick={() => { const current = services.filter(Boolean); const next = active ? current.filter(x => x !== s) : [...current, s]; set('services_requested', next.join(', ')) }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentSoft : '#fff', color: active ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400 }}>{s}</button>
                    })}
                  </div>
                </div>
                <div><label style={labelStyle}>Appointment Date</label><input type="date" value={form.appointment_date || ''} onChange={e => set('appointment_date', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Time Slot</label>
                  <select value={form.time_slot || ''} onChange={e => set('time_slot', e.target.value)} style={inputStyle}>
                    <option value="">—</option>
                    <option>Morning (8am–12pm)</option>
                    <option>Afternoon (12pm–6pm)</option>
                  </select>
                </div>
                <div><label style={labelStyle}>Total Price (£)</label><input type="number" value={form.total_price || ''} onChange={e => set('total_price', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Payment Status</label>
                  <select value={form.payment_status || ''} onChange={e => set('payment_status', e.target.value)} style={inputStyle}>
                    <option value="">—</option>
                    <option>Paid</option><option>Unpaid</option><option>Partial</option>
                  </select>
                </div>
              </>}

              {addType === 'verified' && <>
                <div><label style={labelStyle}>Company</label><input value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Contact First</label><input value={form.contact_first || ''} onChange={e => set('contact_first', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Contact Last</label><input value={form.contact_last || ''} onChange={e => set('contact_last', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Email</label><input type="email" value={form.email_address || ''} onChange={e => set('email_address', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Job Telephone</label><input value={form.job_telephone || ''} onChange={e => set('job_telephone', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Job Mobile</label><input value={form.job_mobile || ''} onChange={e => set('job_mobile', e.target.value)} style={inputStyle} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} style={inputStyle} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Work Done (determines renewal)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {MLC_SERVICES.map(s => {
                      const services = (form.work_done || '').split(',').map(x => x.trim())
                      const active = services.includes(s)
                      return <button key={s} onClick={() => { const current = services.filter(Boolean); const next = active ? current.filter(x => x !== s) : [...current, s]; set('work_done', next.join(', ')) }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${active ? C.purple : C.border}`, background: active ? C.purpleSoft : '#fff', color: active ? C.purple : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400 }}>{s}</button>
                    })}
                  </div>
                </div>
                <div><label style={labelStyle}>Previous Job Date</label><input type="date" value={form.previous_job_date || ''} onChange={e => set('previous_job_date', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Previous Job Status</label><input value={form.previous_job_status || ''} onChange={e => set('previous_job_status', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Last Payment (£)</label><input type="number" value={form.last_payment_amount || ''} onChange={e => set('last_payment_amount', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Last Invoice (£)</label><input type="number" value={form.last_invoice_amount || ''} onChange={e => set('last_invoice_amount', e.target.value)} style={inputStyle} /></div>
                {form.previous_job_date && form.work_done && (
                  <div style={{ gridColumn: 'span 2', background: C.purpleSoft, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.purple }}>
                    📅 Renewal due: <strong>{calculateRenewal(form.work_done, form.previous_job_date)}</strong>
                  </div>
                )}
              </>}

              {addType === 'cold_agent' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Company Name</label><input value={form.cold_company_name || ''} onChange={e => set('cold_company_name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Contact Name</label><input value={form.cold_contact_name || ''} onChange={e => set('cold_contact_name', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Email</label><input type="email" value={form.cold_email || ''} onChange={e => set('cold_email', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Direct Number</label><input value={form.direct_number || ''} onChange={e => set('direct_number', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Landline</label><input value={form.landline_number || ''} onChange={e => set('landline_number', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Zoopla Number</label><input value={form.zoopla_number || ''} onChange={e => set('zoopla_number', e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Website</label><input value={form.website || ''} onChange={e => set('website', e.target.value)} style={inputStyle} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Address</label><input value={form.cold_address || ''} onChange={e => set('cold_address', e.target.value)} style={inputStyle} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, gridColumn: 'span 1' }}>
                  <input type="checkbox" checked={form.email_verified || false} onChange={e => set('email_verified', e.target.checked)} id="ev" />
                  <label htmlFor="ev" style={{ color: C.text, fontSize: 14, cursor: 'pointer' }}>Email Verified</label>
                </div>
              </>}

              {/* Notes always */}
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle}>Notes</label>
                <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
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
