import { useState, useEffect, useMemo } from 'react'
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

const JOB_STATUSES = [
  { key: 'New',         color: '#6B7280', bg: '#F5F7FA', icon: '📋' },
  { key: 'In Progress', color: '#0284C7', bg: '#DBEAFE', icon: '🔧' },
  { key: 'Confirmed',   color: '#0093DB', bg: '#E6F4FC', icon: '✓'  },
  { key: 'Completed',   color: '#3d7a00', bg: '#F0FAE0', icon: '✅' },
  { key: 'Declined',    color: '#DC2626', bg: '#FEE2E2', icon: '✕'  },
]
const STATUS_MAP = Object.fromEntries(JOB_STATUSES.map(s => [s.key, s]))
const MLC_SERVICES = ['EICR','GSC (CP12)','EPC','FRA','FSC','PAT Testing','Remedial Works','Consumer Unit','Diagnostics','Asbestos Survey','Fire Alarm','Boiler Installation','Other']

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
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

const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const lbl = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

export default function Jobs() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [jobs, setJobs]           = useState([])
  const [clients, setClients]     = useState([])
  const [engineers, setEngineers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [viewMode, setViewMode]   = useState('list')
  const [filterStatus, setFilterStatus]     = useState('All')
  const [filterEngineer, setFilterEngineer] = useState('All')
  const [filterBDL, setFilterBDL]           = useState('All')
  const [search, setSearch]                 = useState('')
  const [showNew, setShowNew]               = useState(false)

  const blankJob = {
    title: '', service_types: [], priority: 'Medium', assigned_to: '',
    scheduled_date: '', scheduled_slot: '', site_address: '', site_postcode: '',
    tenant_name: '', tenant_phone: '', access_notes: '', detail_of_service: '',
    job_source_type: 'inbound', description: '',
  }
  const [form, setForm] = useState(blankJob)
  const [lineItems, setLineItems] = useState([
    { id: 1, description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' },
  ])

  useEffect(() => { fetchAll() }, [profile])

  async function fetchAll() {
    setLoading(true)
    const [{ data: j }, { data: c }, { data: e }] = await Promise.all([
      (() => {
        let q = supabase.from('jobs').select('id, job_number, title, status, priority, scheduled_date, invoice_amount, payment_status, payment_amount, amount_received, service_types, client_id, assigned_to, auto_generated, engineer_name, engineer_paid_amount, gross_profit, certificate_status, certificate_sent, remedial_quotation_sent, google_review_requested, work_done, detail_of_service, job_source_type, site_address, clients(first_name, last_name, company_name), profiles(full_name)').order('created_at', { ascending: false })
        if (!isAdmin) q = q.eq('assigned_to', profile?.id)
        return q
      })(),
      supabase.from('clients').select('id, first_name, last_name, company_name, street_address, city, postcode').neq('is_active', false).order('company_name'),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    ])
    setJobs(j || [])
    setClients(c || [])
    setEngineers(e || [])
    setLoading(false)
  }

  async function createJob() {
    if (!form.title) { showToast('Job title is required', 'error'); return }
    setSaving(true)
    const lineTotal = lineItems.filter(l => l.description).reduce((s, l) => s + (Number(l.quantity) * Number(l.unit_price || 0)), 0)
    const payload = { title: form.title, source: 'manual' }
    if (form.client_id)         payload.client_id = form.client_id
    if (form.assigned_to)       payload.assigned_to = form.assigned_to
    else                        payload.assigned_to = profile.id
    if (form.service_types?.length > 0) payload.service_types = form.service_types
    if (form.priority)          payload.priority = form.priority
    if (form.site_address)      payload.site_address = form.site_address
    if (form.site_postcode)     payload.site_postcode = form.site_postcode
    if (form.scheduled_date)    payload.scheduled_date = form.scheduled_date
    if (form.scheduled_slot)    payload.scheduled_slot = form.scheduled_slot
    if (form.tenant_name)       payload.tenant_name = form.tenant_name
    if (form.tenant_phone)      payload.tenant_phone = form.tenant_phone
    if (form.access_notes)      payload.access_notes = form.access_notes
    if (form.detail_of_service) payload.detail_of_service = form.detail_of_service
    if (form.job_source_type)   payload.job_source_type = form.job_source_type
    if (form.description)       payload.description = form.description
    if (lineTotal > 0)          { payload.quoted_amount = lineTotal; payload.invoice_amount = lineTotal }

    const { data: job, error } = await supabase.from('jobs').insert(payload).select().single()
    if (error) { setSaving(false); showToast(error.message, 'error'); return }

    const validItems = lineItems.filter(l => l.description.trim())
    if (validItems.length > 0) {
      await supabase.from('job_line_items').insert(validItems.map(l => ({
        job_id: job.id, description: l.description, item_type: l.item_type || 'certificate',
        quantity: Number(l.quantity) || 1, unit: l.unit || 'ea', unit_price: Number(l.unit_price || 0),
      })))
    }
    setSaving(false); setShowNew(false); setForm(blankJob)
    setLineItems([{ id: 1, description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' }])
    await fetchAll()
    showToast(`Job ${job.job_number} created ✓`)
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleService = svc => setForm(p => ({ ...p, service_types: p.service_types.includes(svc) ? p.service_types.filter(s => s !== svc) : [...p.service_types, svc] }))
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'
  const lineTotal = lineItems.reduce((s, l) => s + (Number(l.quantity) * Number(l.unit_price || 0)), 0)

  const filtered = useMemo(() => jobs
    .filter(j => filterStatus === 'All' || j.status === filterStatus)
    .filter(j => filterEngineer === 'All' || j.assigned_to === filterEngineer)
    .filter(j => filterBDL === 'All' || j.assigned_to === filterBDL)
    .filter(j => {
      if (!search) return true
      const q = search.toLowerCase()
      return j.title?.toLowerCase().includes(q) || j.job_number?.toLowerCase().includes(q) || clientName(j.clients)?.toLowerCase().includes(q) || (j.engineer_name || '').toLowerCase().includes(q)
    })
  , [jobs, filterStatus, filterEngineer, filterBDL, search])

  // BDL revenue summary
  const bdlSummary = useMemo(() => {
    const summary = {}
    jobs.forEach(j => {
      const bdl = j.profiles?.full_name || 'Unassigned'
      if (!summary[bdl]) summary[bdl] = { jobs: 0, revenue: 0, profit: 0 }
      summary[bdl].jobs++
      summary[bdl].revenue += Number(j.amount_received || 0)
      summary[bdl].profit += Number(j.gross_profit || 0)
    })
    return Object.entries(summary).sort((a, b) => b[1].profit - a[1].profit)
  }, [jobs])

  const th = { textAlign: 'left', padding: '8px 12px', color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface, whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 13, verticalAlign: 'middle' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Jobs</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{jobs.length} total · {filtered.length} shown</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {[['board','▦ Board'],['list','☰ List']].map(([m, l]) => (
              <button key={m} onClick={() => setViewMode(m)}
                style={{ padding: '7px 14px', border: 'none', background: viewMode === m ? C.accent : 'transparent', color: viewMode === m ? '#fff' : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: viewMode === m ? 600 : 400 }}>
                {l}
              </button>
            ))}
          </div>
          <Btn onClick={() => setShowNew(true)}>+ New Job</Btn>
        </div>
      </div>

      {/* BDL Revenue Summary */}
      {isAdmin && bdlSummary.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, overflowX: 'auto' }}>
          {bdlSummary.map(([bdl, data]) => (
            <div key={bdl} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${C.accent}`, borderRadius: 10, padding: '10px 16px', minWidth: 140, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 4 }}>{bdl}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.greenDark }}>{fmt(data.profit)}</div>
              <div style={{ fontSize: 11, color: C.dim }}>{data.jobs} jobs · {fmt(data.revenue)} rev</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs…"
          style={{ ...inp, flex: 1, minWidth: 180, width: 'auto', padding: '8px 12px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, width: 'auto', padding: '8px 10px', fontSize: 13 }}>
          <option value="All">All Statuses</option>
          {JOB_STATUSES.map(s => <option key={s.key}>{s.key}</option>)}
        </select>
        {isAdmin && (
          <select value={filterBDL} onChange={e => setFilterBDL(e.target.value)} style={{ ...inp, width: 'auto', padding: '8px 10px', fontSize: 13 }}>
            <option value="All">All BDLs</option>
            {engineers.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading…</div>
      ) : viewMode === 'board' ? (
        /* BOARD VIEW */
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {JOB_STATUSES.map(status => {
            const statusJobs = filtered.filter(j => j.status === status.key)
            return (
              <div key={status.key} style={{ minWidth: 230, flex: '0 0 230px' }}>
                <div style={{ background: status.bg, border: `1px solid ${status.color}33`, borderLeft: `4px solid ${status.color}`, borderRadius: 8, padding: '8px 12px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: status.color, fontWeight: 700, fontSize: 13 }}>{status.icon} {status.key}</span>
                  <span style={{ background: '#fff', color: status.color, border: `1px solid ${status.color}44`, borderRadius: 20, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{statusJobs.length}</span>
                </div>
                {statusJobs.map(job => (
                  <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                    style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}>
                        {job.job_number}
                        {job.auto_generated && <span style={{ background: C.tealSoft, color: C.teal, borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, marginLeft: 5 }}>AUTO</span>}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 3 }}>{clientName(job.clients)}</div>
                    <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{job.title}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                      <span style={{ color: C.greenDark, fontWeight: 600 }}>{job.amount_received > 0 ? fmt(job.amount_received) : ''}</span>
                      <span style={{ color: C.dim }}>{job.profiles?.full_name?.split(' ')[0] || ''}</span>
                    </div>
                    {job.gross_profit != null && job.gross_profit > 0 && (
                      <div style={{ fontSize: 10, color: C.teal, fontWeight: 600, marginTop: 3 }}>GP: {fmt(job.gross_profit)}</div>
                    )}
                  </div>
                ))}
                {statusJobs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: C.dim, fontSize: 13, background: C.surface, borderRadius: 8, border: `1px dashed ${C.border}` }}>Empty</div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* LIST VIEW — Master Sheet Style */
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>No jobs found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1400 }}>
              <thead>
                <tr>
                  {['Job #','Date','Client','Service','Assigned BDL','Detail','Status','Amt Received','Payment','Work Done','Cert Sent','Cert Status','Remedial Sent','Google Review','Engineer','Eng. Paid','Gross Profit'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(job => {
                  const sc = STATUS_MAP[job.status] || { color: C.muted, bg: C.surface }
                  return (
                    <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <td style={td}>
                        <span style={{ color: C.accent, fontWeight: 700, fontSize: 12 }}>{job.job_number}</span>
                        {job.auto_generated && <span style={{ background: C.tealSoft, color: C.teal, borderRadius: 4, padding: '1px 4px', fontSize: 9, fontWeight: 700, marginLeft: 4 }}>AUTO</span>}
                      </td>
                      <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{job.scheduled_date || '—'}</span></td>
                      <td style={td}><span style={{ fontWeight: 600, color: C.text, fontSize: 12 }}>{clientName(job.clients)}</span></td>
                      <td style={td}><span style={{ fontSize: 11, color: C.muted }}>{(job.service_types || []).join(', ') || '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: C.text }}>{job.profiles?.full_name || '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 11, color: C.muted }}>{job.detail_of_service || '—'}</span></td>
                      <td style={td}><span style={{ background: sc.bg, color: sc.color, borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 600 }}>{job.status}</span></td>
                      <td style={td}><span style={{ color: C.greenDark, fontWeight: 600, fontSize: 12 }}>{job.amount_received > 0 ? fmt(job.amount_received) : '—'}</span></td>
                      <td style={td}>
                        <span style={{ background: job.payment_status === 'Paid' ? C.greenSoft : C.amberSoft, color: job.payment_status === 'Paid' ? C.greenDark : C.amber, borderRadius: 5, padding: '2px 6px', fontSize: 10, fontWeight: 600 }}>
                          {job.payment_status || '—'}
                        </span>
                      </td>
                      <td style={td}><span style={{ fontSize: 11, color: C.muted }}>{job.work_done || '—'}</span></td>
                      <td style={td}><span style={{ color: job.certificate_sent ? C.greenDark : C.dim, fontSize: 12 }}>{job.certificate_sent ? '✓' : '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 11, color: C.muted }}>{job.certificate_status || '—'}</span></td>
                      <td style={td}><span style={{ color: job.remedial_quotation_sent ? C.greenDark : C.dim, fontSize: 12 }}>{job.remedial_quotation_sent ? '✓' : '—'}</span></td>
                      <td style={td}><span style={{ color: job.google_review_requested ? C.greenDark : C.dim, fontSize: 12 }}>{job.google_review_requested ? '⭐' : '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{job.engineer_name || '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{job.engineer_paid_amount > 0 ? fmt(job.engineer_paid_amount) : '—'}</span></td>
                      <td style={td}><span style={{ fontSize: 12, fontWeight: 700, color: job.gross_profit > 0 ? C.greenDark : job.gross_profit < 0 ? C.red : C.dim }}>{job.gross_profit != null ? fmt(job.gross_profit) : '—'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* New Job Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowNew(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 680, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 24 }}>New Job</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Client</label>
                <select value={form.client_id || ''} onChange={e => {
                  const client = clients.find(c => c.id === e.target.value)
                  set('client_id', e.target.value || undefined)
                  if (client) set('site_address', [client.street_address, client.city, client.postcode].filter(Boolean).join(', '))
                }} style={inp}>
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Job Title *</label><input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. EICR + GSC — 3-bed flat" style={inp} /></div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Services</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {MLC_SERVICES.map(svc => (
                    <button key={svc} onClick={() => toggleService(svc)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${form.service_types.includes(svc) ? C.accent : C.border}`, background: form.service_types.includes(svc) ? C.accentSoft : '#fff', color: form.service_types.includes(svc) ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: form.service_types.includes(svc) ? 700 : 400 }}>
                      {svc}
                    </button>
                  ))}
                </div>
              </div>
              <div><label style={lbl}>Assign BDL</label>
                <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={inp}>
                  <option value="">— Select —</option>
                  {engineers.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Type</label>
                <select value={form.job_source_type} onChange={e => set('job_source_type', e.target.value)} style={inp}>
                  <option value="inbound">Inbound</option><option value="outbound">Outbound</option>
                </select>
              </div>
              <div><label style={lbl}>Scheduled Date</label><input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Time Slot</label>
                <select value={form.scheduled_slot} onChange={e => set('scheduled_slot', e.target.value)} style={inp}>
                  <option value="">—</option><option>Morning (8am–12pm)</option><option>Afternoon (12pm–6pm)</option>
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Site Address</label><input value={form.site_address} onChange={e => set('site_address', e.target.value)} style={inp} /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Detail of Service</label><input value={form.detail_of_service} onChange={e => set('detail_of_service', e.target.value)} placeholder="Additional details…" style={inp} /></div>
              <div><label style={lbl}>Tenant Name</label><input value={form.tenant_name} onChange={e => set('tenant_name', e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Tenant Phone</label><input value={form.tenant_phone} onChange={e => set('tenant_phone', e.target.value)} style={inp} /></div>
            </div>

            {/* Line items */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <label style={lbl}>Line Items</label>
                <button onClick={() => setLineItems(p => [...p, { id: Date.now(), description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' }])}
                  style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add line</button>
              </div>
              {lineItems.map(item => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 60px 80px 28px', gap: 6, marginBottom: 8 }}>
                  <input value={item.description} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, description: e.target.value } : l))} placeholder="Description" style={{ ...inp, padding: '7px 10px', fontSize: 13 }} />
                  <input type="number" value={item.quantity} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, quantity: e.target.value } : l))} style={{ ...inp, padding: '7px 8px', fontSize: 13 }} />
                  <input type="number" value={item.unit_price} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, unit_price: e.target.value } : l))} placeholder="£" style={{ ...inp, padding: '7px 8px', fontSize: 13 }} />
                  <button onClick={() => setLineItems(p => p.filter(l => l.id !== item.id))} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>
              ))}
              <div style={{ textAlign: 'right', color: C.accent, fontWeight: 700, fontSize: 16, marginTop: 8 }}>Total: {fmt(lineTotal)}</div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <Btn onClick={createJob} disabled={saving}>{saving ? 'Creating…' : 'Create Job'}</Btn>
              <Btn variant="ghost" onClick={() => setShowNew(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
