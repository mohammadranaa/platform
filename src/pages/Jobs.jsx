import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', surface2: '#EAECF0', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#5a9400',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  teal: '#0D9488', tealSoft: '#CCFBF1',
  sky: '#0284C7', skySoft: '#E0F2FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const JOB_STATUSES = [
  { key: 'In Progress',          color: '#D97706', bg: '#FEF3C7', icon: '🔧' },
  { key: 'Scheduled',            color: '#0284C7', bg: '#E0F2FE', icon: '📅' },
  { key: 'Paid',                 color: '#0093DB', bg: '#E6F4FC', icon: '💰' },
  { key: 'Completed',            color: '#0D9488', bg: '#CCFBF1', icon: '✅' },
  { key: 'Certificate Delivered',color: '#3d7a00', bg: '#F0FAE0', icon: '📜' },
  { key: 'Cancelled',            color: '#DC2626', bg: '#FEE2E2', icon: '✕'  },
]
const STATUS_MAP = Object.fromEntries(JOB_STATUSES.map(s => [s.key, s]))
const MLC_SERVICES = ['EICR','GSC (CP12)','EPC','FRA','FSC','PAT Testing','Remedial Works','Consumer Unit','Diagnostics','Asbestos Survey','Other']
const PRIORITIES = ['Low','Medium','High','Emergency']

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.muted, border: `1px solid ${C.border}` },
    success: { background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.green}66` },
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

const StatusBadge = ({ status, small }) => {
  const m = STATUS_MAP[status] || { color: C.muted, bg: C.surface, icon: '?' }
  return (
    <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`,
      borderRadius: 6, padding: small ? '2px 8px' : '3px 10px',
      fontSize: small ? 11 : 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {m.icon} {status}
    </span>
  )
}

const PriorityChip = ({ priority }) => {
  const colors = { Low: C.dim, Medium: C.amber, High: C.red, Emergency: '#DC2626' }
  return <span style={{ color: colors[priority] || C.muted, fontSize: 12, fontWeight: 600 }}>● {priority}</span>
}

export default function Jobs() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast, showToast } = useToast()

  const [jobs, setJobs]         = useState([])
  const [clients, setClients]   = useState([])
  const [engineers, setEngineers] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [viewMode, setViewMode] = useState('board')

  const initialStatus = searchParams.get('status') || 'All'
  const [filterStatus,   setFilterStatus]   = useState(initialStatus)
  const [filterEngineer, setFilterEngineer] = useState('All')
  const [search, setSearch]                 = useState('')
  const [showNew, setShowNew] = useState(false)

  const blankJob = {
    client_id: '', title: '', service_types: [],
    job_type: 'Inspection', priority: 'Medium',
    assigned_to: '', scheduled_date: '', scheduled_slot: 'Morning (8am–12pm)',
    site_address: '', site_postcode: '', access_notes: '',
    tenant_name: '', tenant_phone: '', description: '', quoted_amount: '',
  }
  const [form, setForm] = useState(blankJob)
  const [lineItems, setLineItems] = useState([
    { id: 1, description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' },
  ])

  useEffect(() => { fetchAll() }, [profile])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchJobs(), fetchClients(), fetchEngineers()])
    setLoading(false)
  }

  async function fetchJobs() {
    let q = supabase
      .from('jobs')
      .select('id, job_number, title, status, priority, scheduled_date, invoice_amount, payment_status, service_types, client_id, assigned_to, clients(first_name, last_name, company_name), profiles(full_name)')
      .order('created_at', { ascending: false })
    if (!isAdmin) q = q.eq('assigned_to', profile.id)
    const { data, error } = await q
    if (!error) setJobs(data || [])
  }

  async function fetchClients() {
    const { data } = await supabase.from('clients').select('id, first_name, last_name, company_name, street_address, city, postcode').order('company_name')
    setClients(data || [])
  }

  async function fetchEngineers() {
    const { data } = await supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
    setEngineers(data || [])
  }

  async function createJob() {
    if (!form.title) { showToast('Job title is required', 'error'); return }
    setSaving(true)
    const { data: job, error } = await supabase.from('jobs').insert({
      ...form,
      assigned_to: form.assigned_to || profile.id,
      quoted_amount: Number(form.quoted_amount) || 0,
      invoice_amount: lineItems.filter(l => l.description).reduce((s, l) => s + (Number(l.quantity) * Number(l.unit_price || 0)), 0),
      source: 'manual',
    }).select().single()
    if (error) { setSaving(false); showToast(error.message, 'error'); return }
    const validItems = lineItems.filter(l => l.description.trim())
    if (validItems.length > 0) {
      await supabase.from('job_line_items').insert(validItems.map(l => ({ ...l, job_id: job.id, quantity: Number(l.quantity), unit_price: Number(l.unit_price || 0) })))
    }
    if (form.client_id) {
      await supabase.from('client_activities').insert({ client_id: form.client_id, rep_id: profile.id, rep_name: profile.full_name, type: 'job_created', content: `Job created: ${form.title} (${job.job_number})` })
    }
    setSaving(false)
    setShowNew(false)
    setForm(blankJob)
    setLineItems([{ id: 1, description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' }])
    await fetchJobs()
    showToast(`Job ${job.job_number} created ✓`)
    navigate(`/jobs/${job.id}`)
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggleService = (svc) => setForm(p => ({ ...p, service_types: p.service_types.includes(svc) ? p.service_types.filter(s => s !== svc) : [...p.service_types, svc] }))
  const lineTotal = lineItems.reduce((s, l) => s + (Number(l.quantity) * Number(l.unit_price || 0)), 0)
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'

  const filtered = useMemo(() => jobs
    .filter(j => filterStatus === 'All' || j.status === filterStatus)
    .filter(j => filterEngineer === 'All' || j.assigned_to === filterEngineer)
    .filter(j => { if (!search) return true; const q = search.toLowerCase(); return j.title?.toLowerCase().includes(q) || j.job_number?.toLowerCase().includes(q) || clientName(j.clients)?.toLowerCase().includes(q) })
  , [jobs, filterStatus, filterEngineer, search])

  const byStatus = (key) => filtered.filter(j => j.status === key)

  const inputStyle = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }

  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Jobs</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{jobs.length} total · {filtered.length} shown</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* View toggle */}
          <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {[['board','▦ Board'], ['list','☰ List']].map(([mode, label]) => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{ padding: '7px 14px', border: 'none', background: viewMode === mode ? C.accent : 'transparent', color: viewMode === mode ? '#fff' : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: viewMode === mode ? 600 : 400 }}>
                {label}
              </button>
            ))}
          </div>
          <Btn onClick={() => setShowNew(true)}>+ New Job</Btn>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs…"
          style={{ ...inputStyle, flex: 1, minWidth: 180, width: 'auto' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All Statuses</option>
          {JOB_STATUSES.map(s => <option key={s.key}>{s.key}</option>)}
        </select>
        {isAdmin && (
          <select value={filterEngineer} onChange={e => setFilterEngineer(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '8px 12px' }}>
            <option value="All">All Engineers</option>
            {engineers.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading jobs…</div>
      ) : viewMode === 'board' ? (
        /* BOARD VIEW */
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {JOB_STATUSES.map(status => {
            const statusJobs = byStatus(status.key)
            return (
              <div key={status.key} style={{ minWidth: 220, flex: '0 0 220px' }}>
                {/* Column header — light with coloured left border */}
                <div style={{
                  background: status.bg,
                  border: `1px solid ${status.color}33`,
                  borderLeft: `4px solid ${status.color}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  marginBottom: 10,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ color: status.color, fontWeight: 700, fontSize: 13 }}>{status.icon} {status.key}</span>
                  <span style={{ background: '#fff', color: status.color, border: `1px solid ${status.color}44`, borderRadius: 20, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{statusJobs.length}</span>
                </div>
                {statusJobs.map(job => (
                  <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                    style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}>{job.job_number}</span>
                      <PriorityChip priority={job.priority} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 4, lineHeight: 1.3 }}>{job.title}</div>
                    <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>{clientName(job.clients)}</div>
                    {job.service_types?.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                        {job.service_types.slice(0,3).map(s => (
                          <span key={s} style={{ background: C.accentSoft, color: C.accent, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>{s}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {job.invoice_amount > 0 ? <span style={{ color: C.greenDark, fontSize: 13, fontWeight: 600 }}>{fmt(job.invoice_amount)}</span> : <span />}
                      <span style={{ color: C.dim, fontSize: 11 }}>{job.profiles?.full_name?.split(' ')[0]}</span>
                    </div>
                    {job.scheduled_date && (
                      <div style={{ marginTop: 6, padding: '3px 8px', background: C.surface, borderRadius: 5, fontSize: 11, color: C.muted }}>
                        📅 {job.scheduled_date}
                      </div>
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
        /* LIST VIEW */
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>No jobs found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Job #','Title','Client','Services','Status','Engineer','Value','Date'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map(job => (
                  <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}><span style={{ color: C.accent, fontWeight: 700, fontSize: 13 }}>{job.job_number}</span></td>
                    <td style={td}><div style={{ fontWeight: 600, color: C.text }}>{job.title}</div><PriorityChip priority={job.priority} /></td>
                    <td style={td}><span style={{ color: C.text }}>{clientName(job.clients)}</span></td>
                    <td style={td}><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{(job.service_types || []).slice(0,2).map(s => <span key={s} style={{ background: C.accentSoft, color: C.accent, borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>{s}</span>)}</div></td>
                    <td style={td}><StatusBadge status={job.status} small /></td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{job.profiles?.full_name || '—'}</span></td>
                    <td style={td}><span style={{ color: C.greenDark, fontWeight: 600 }}>{job.invoice_amount > 0 ? fmt(job.invoice_amount) : '—'}</span></td>
                    <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{job.scheduled_date || '—'}</span></td>
                  </tr>
                ))}
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
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Client</label>
                <select value={form.client_id} onChange={e => { const client = clients.find(c => c.id === e.target.value); set('client_id', e.target.value); if (client) set('site_address', [client.street_address, client.city, client.postcode].filter(Boolean).join(', ')) }} style={inputStyle}>
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Job Title *</label>
                <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. EICR + GSC — 3-bed flat" style={inputStyle} />
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Services</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {MLC_SERVICES.map(svc => (
                    <button key={svc} onClick={() => toggleService(svc)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${form.service_types.includes(svc) ? C.accent : C.border}`, background: form.service_types.includes(svc) ? C.accentSoft : '#fff', color: form.service_types.includes(svc) ? C.accent : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: form.service_types.includes(svc) ? 700 : 400 }}>
                      {svc}
                    </button>
                  ))}
                </div>
              </div>
              {[
                { label: 'Priority', key: 'priority', options: PRIORITIES },
                { label: 'Assign Engineer', key: 'assigned_to', custom: engineers.map(e => ({ value: e.id, label: e.full_name })) },
                { label: 'Scheduled Date', key: 'scheduled_date', type: 'date' },
                { label: 'Time Slot', key: 'scheduled_slot', options: ['Morning (8am–12pm)','Afternoon (12pm–6pm)'] },
              ].map(f => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</label>
                  {f.custom ? (
                    <select value={form[f.key]} onChange={e => set(f.key, e.target.value)} style={inputStyle}>
                      <option value="">— Select —</option>
                      {f.custom.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.options ? (
                    <select value={form[f.key]} onChange={e => set(f.key, e.target.value)} style={inputStyle}>
                      {f.options.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type || 'text'} value={form[f.key]} onChange={e => set(f.key, e.target.value)} style={inputStyle} />
                  )}
                </div>
              ))}
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Site Address</label>
                <input value={form.site_address} onChange={e => set('site_address', e.target.value)} placeholder="Property address" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant Name</label>
                <input value={form.tenant_name} onChange={e => set('tenant_name', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tenant Phone</label>
                <input value={form.tenant_phone} onChange={e => set('tenant_phone', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Access Notes</label>
                <input value={form.access_notes} onChange={e => set('access_notes', e.target.value)} placeholder="e.g. Call tenant 30 mins before. Key under mat." style={inputStyle} />
              </div>
            </div>

            {/* Line items */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Line Items</label>
                <button onClick={() => setLineItems(p => [...p, { id: Date.now(), description: '', item_type: 'certificate', quantity: 1, unit: 'ea', unit_price: '' }])}
                  style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add line</button>
              </div>
              {lineItems.map((item, i) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 55px 80px 90px 28px', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <input value={item.description} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, description: e.target.value } : l))} placeholder="Description" style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} />
                  <select value={item.item_type} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, item_type: e.target.value } : l))} style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}>
                    <option value="certificate">Cert</option><option value="labour">Labour</option><option value="material">Material</option><option value="other">Other</option>
                  </select>
                  <input type="number" value={item.quantity} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, quantity: e.target.value } : l))} style={{ ...inputStyle, padding: '7px 8px', fontSize: 13 }} />
                  <select value={item.unit} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, unit: e.target.value } : l))} style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}>
                    {['ea','hr','set','m','day'].map(u => <option key={u}>{u}</option>)}
                  </select>
                  <input type="number" value={item.unit_price} onChange={e => setLineItems(p => p.map(l => l.id === item.id ? { ...l, unit_price: e.target.value } : l))} placeholder="£0.00" style={{ ...inputStyle, padding: '7px 8px', fontSize: 13 }} />
                  <button onClick={() => setLineItems(p => p.filter(l => l.id !== item.id))} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <span style={{ color: C.muted, fontSize: 13 }}>Total: </span>
                <span style={{ color: C.accent, fontWeight: 700, fontSize: 16, marginLeft: 8 }}>{fmt(lineTotal)}</span>
              </div>
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
