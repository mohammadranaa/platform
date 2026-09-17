import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  surface:'#F5F7FA', border:'#E5E7EB',
  accent:'#0093DB', accentSoft:'#E6F4FC',
  green:'#80D100', greenSoft:'#F0FAE0', greenDark:'#3d7a00',
  amber:'#D97706', amberSoft:'#FEF3C7',
  red:'#DC2626', redSoft:'#FEE2E2',
  teal:'#0D9488', tealSoft:'#CCFBF1',
  text:'#1F2937', muted:'#6B7280', dim:'#9CA3AF',
}

// Certificate type → expiry years (matches JobDetail)
const EXPIRY_YEARS = {
  'EICR':5,'Commercial EICR':5,
  'Gas Safety Certificate':1,'Gas Safety Certificate (CP12)':1,'GSC (CP12)':1,'Gas Safety':1,
  'EPC':10,'Commercial EPC':10,
  'Fire Risk Assessment':1,'FRA':1,
  'PAT Testing':1,'PAT':1,
  'Fire Safety Certificate':1,'FSC':1,
  'Fire Door Certificate':1,
  'Emergency Lights':1,
  'Asbestos Survey':2,
  'Legionella':2,
}

// Short display labels
const SVC_LABEL = {
  'EICR':'EICR','Commercial EICR':'EICR (Comm)',
  'Gas Safety Certificate':'GSC','Gas Safety Certificate (CP12)':'GSC','GSC (CP12)':'GSC','Gas Safety':'GSC',
  'EPC':'EPC','Commercial EPC':'EPC (Comm)',
  'Fire Risk Assessment':'FRA','FRA':'FRA',
  'PAT Testing':'PAT','PAT':'PAT',
  'Fire Safety Certificate':'FSC','FSC':'FSC',
  'Fire Door Certificate':'Fire Door',
  'Emergency Lights':'Em. Lights',
  'Asbestos Survey':'Asbestos',
}

// KEY compliance types to track — anything else is "other work"
const KEY_CERTS = ['EICR','Commercial EICR','Gas Safety Certificate','Gas Safety Certificate (CP12)',
  'GSC (CP12)','Gas Safety','EPC','Commercial EPC','Fire Risk Assessment','FRA',
  'PAT Testing','PAT','Fire Safety Certificate','FSC']

function trafficLight(latestDate, certType) {
  if (!latestDate) return 'missing'
  const years = EXPIRY_YEARS[certType] || 1
  const issued = new Date(latestDate)
  const expiry = new Date(issued)
  expiry.setFullYear(expiry.getFullYear() + years)
  const now = new Date()
  const daysLeft = Math.floor((expiry - now) / 86400000)
  if (daysLeft < 0)   return 'expired'
  if (daysLeft < 90)  return 'due-soon'
  return 'valid'
}

const LIGHT = {
  valid:    { color: C.greenDark,  bg: C.greenSoft,  label: 'Valid',    dot: '🟢' },
  'due-soon':{ color: C.amber,    bg: C.amberSoft,  label: 'Due soon', dot: '🟡' },
  expired:  { color: C.red,       bg: C.redSoft,    label: 'Expired',  dot: '🔴' },
  missing:  { color: C.muted,     bg: C.surface,    label: 'None',     dot: '⚫' },
}

function fmtD(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
}

function cName(c) {
  return c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(' ') || '—'
}

// ── CompliancePill ────────────────────────────────────────────────────────────
function CompliancePill({ type, date }) {
  const status = trafficLight(date, type)
  const s = LIGHT[status]
  const label = SVC_LABEL[type] || type
  return (
    <span title={date ? `Last: ${fmtD(date)}` : 'No record'} style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.color}44`,
      borderRadius: 6, padding: '2px 7px',
      fontSize: 11, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 4,
      whiteSpace: 'nowrap',
    }}>
      {s.dot} {label}
    </span>
  )
}

// ── PropertyDetail modal ──────────────────────────────────────────────────────
function PropertyDetail({ property, jobs, onClose, navigate }) {
  const c = property.client

  // Group jobs by address match
  const propJobs = jobs
    .filter(j => j.client_id === property.client_id)
    .filter(j => {
      if (!j.site_address) return false
      const a1 = (j.site_address || '').toLowerCase().replace(/\s+/g,' ').trim()
      const a2 = (property.address || '').toLowerCase().replace(/\s+/g,' ').trim()
      return a1.includes(a2.split(',')[0].trim()) || a2.includes(a1.split(',')[0].trim())
    })
    .sort((a,b) => new Date(b.scheduled_date||b.created_at) - new Date(a.scheduled_date||a.created_at))

  // Compliance from all jobs at this property
  const latestByCert = {}
  for (const j of propJobs) {
    for (const svc of (j.service_types || [])) {
      if (KEY_CERTS.includes(svc)) {
        if (!latestByCert[svc] || new Date(j.scheduled_date) > new Date(latestByCert[svc])) {
          latestByCert[svc] = j.scheduled_date
        }
      }
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:680, maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        {/* Header */}
        <div style={{ padding:'20px 24px 16px', borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, background:'#fff', zIndex:1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:16, fontWeight:800, color:C.text }}>{property.address}</div>
              <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>
                {c ? <span style={{ cursor:'pointer', color:C.accent }} onClick={() => { onClose(); navigate(`/clients/${c.id}`) }}>
                  👤 {cName(c)}
                </span> : '—'}
                {c?.client_type && <span style={{ marginLeft:8, background:C.surface, borderRadius:4, padding:'1px 6px', fontSize:11, color:C.muted }}>{c.client_type}</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:C.muted, padding:'0 4px' }}>✕</button>
          </div>
        </div>

        <div style={{ padding:'20px 24px' }}>
          {/* Compliance status */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>Compliance Status</div>
            {Object.keys(latestByCert).length === 0 ? (
              <div style={{ color:C.dim, fontSize:13, fontStyle:'italic' }}>No compliance records found for this address.</div>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {Object.entries(latestByCert).map(([cert, date]) => (
                  <div key={cert} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                    <CompliancePill type={cert} date={date} />
                    <div style={{ fontSize:10, color:C.dim }}>{fmtD(date)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Job history */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>
              Job History ({propJobs.length})
            </div>
            {propJobs.length === 0 ? (
              <div style={{ color:C.dim, fontSize:13, fontStyle:'italic' }}>No jobs matched to this address yet.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {propJobs.map(j => (
                  <div key={j.id} onClick={() => { onClose(); navigate(`/jobs/${j.id}`) }}
                    style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13, color:C.accent }}>{j.job_number} — {j.title}</div>
                      <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                        {fmtD(j.scheduled_date)}
                        {j.invoice_amount > 0 && <span> · £{Number(j.invoice_amount).toFixed(2)}</span>}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <span style={{
                        background: j.status === 'Completed' ? C.greenSoft : j.status === 'Cancelled' ? C.redSoft : C.accentSoft,
                        color: j.status === 'Completed' ? C.greenDark : j.status === 'Cancelled' ? C.red : C.accent,
                        borderRadius:5, padding:'2px 8px', fontSize:11, fontWeight:600
                      }}>{j.status}</span>
                      <span style={{ color:C.dim, fontSize:11 }}>→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Properties() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [properties, setProperties] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // all | valid | due-soon | expired | missing
  const [filterType, setFilterType] = useState('all')     // all | Landlord | Estate Agent
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: props }, { data: jobData }] = await Promise.all([
      supabase.from('properties')
        .select('*, clients(id, first_name, last_name, company_name, client_type, email, phone)')
        .order('address'),
      supabase.from('jobs')
        .select('id, job_number, title, client_id, site_address, site_postcode, service_types, scheduled_date, status, invoice_amount, payment_status, created_at')
        .not('site_address', 'is', null)
        .order('scheduled_date', { ascending: false }),
    ])
    setProperties(props || [])
    setJobs(jobData || [])
    setLoading(false)
  }

  // For each property, compute compliance from matching jobs
  const enriched = useMemo(() => {
    return (properties || []).map(p => {
      const client = p.clients
      const clientJobs = (jobs || []).filter(j => j.client_id === p.client_id)

      // Fuzzy address match: first postcode segment or first line word
      const addrKey = (p.address || '').toLowerCase().replace(/\s+/g,' ').trim()
      const propJobs = clientJobs.filter(j => {
        const jAddr = (j.site_address || '').toLowerCase().replace(/\s+/g,' ').trim()
        if (!jAddr || !addrKey) return false
        const p1 = addrKey.split(',')[0].split(' ').filter(w => w.length > 2)[0] || ''
        const p2 = jAddr.split(',')[0].split(' ').filter(w => w.length > 2)[0] || ''
        return p1 && p2 && (jAddr.includes(p1) || addrKey.includes(p2))
      })

      // Latest date per cert type
      const latestByCert = {}
      for (const j of propJobs) {
        for (const svc of (j.service_types || [])) {
          if (KEY_CERTS.includes(svc)) {
            if (!latestByCert[svc] || new Date(j.scheduled_date) > new Date(latestByCert[svc])) {
              latestByCert[svc] = j.scheduled_date
            }
          }
        }
      }

      // Worst status across all certs
      let worstStatus = 'missing'
      const statOrder = ['expired','due-soon','valid','missing']
      for (const [cert, date] of Object.entries(latestByCert)) {
        const s = trafficLight(date, cert)
        if (statOrder.indexOf(s) < statOrder.indexOf(worstStatus)) worstStatus = s
      }

      const totalSpend = propJobs.reduce((s, j) => s + Number(j.invoice_amount || 0), 0)
      const lastJob = propJobs[0]

      return { ...p, client, propJobs, latestByCert, worstStatus, totalSpend, lastJob }
    })
  }, [properties, jobs])

  const filtered = useMemo(() => {
    let rows = enriched
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(p =>
        (p.address || '').toLowerCase().includes(q) ||
        (cName(p.client)).toLowerCase().includes(q) ||
        (p.postcode || '').toLowerCase().includes(q)
      )
    }
    if (filterStatus !== 'all') rows = rows.filter(p => p.worstStatus === filterStatus)
    if (filterType !== 'all') rows = rows.filter(p => p.client?.client_type === filterType)
    return rows
  }, [enriched, search, filterStatus, filterType])

  // Summary counts
  const counts = useMemo(() => ({
    all: enriched.length,
    valid: enriched.filter(p => p.worstStatus === 'valid').length,
    'due-soon': enriched.filter(p => p.worstStatus === 'due-soon').length,
    expired: enriched.filter(p => p.worstStatus === 'expired').length,
    missing: enriched.filter(p => p.worstStatus === 'missing').length,
  }), [enriched])

  const inp = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', fontSize:13, color:C.text, outline:'none' }
  const td = { padding:'11px 14px', borderBottom:`1px solid ${C.border}`, fontSize:13, verticalAlign:'middle' }

  return (
    <div style={{ maxWidth:1200, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, color:C.text, margin:0 }}>Properties</h1>
          <div style={{ color:C.muted, fontSize:13, marginTop:3 }}>
            {enriched.length} properties · compliance tracked from job history
          </div>
        </div>
      </div>

      {/* Compliance summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
        {[
          { key:'valid',    label:'Fully Compliant', icon:'🟢', color:C.greenDark, bg:C.greenSoft },
          { key:'due-soon', label:'Due Within 90 Days', icon:'🟡', color:C.amber, bg:C.amberSoft },
          { key:'expired',  label:'Certificate Expired', icon:'🔴', color:C.red, bg:C.redSoft },
          { key:'missing',  label:'No Records', icon:'⚫', color:C.muted, bg:C.surface },
        ].map(s => (
          <button key={s.key} onClick={() => setFilterStatus(filterStatus === s.key ? 'all' : s.key)}
            style={{ background: filterStatus === s.key ? s.bg : '#fff', border:`2px solid ${filterStatus === s.key ? s.color+'66' : C.border}`, borderRadius:10, padding:'14px 16px', textAlign:'left', cursor:'pointer', transition:'all 0.15s' }}>
            <div style={{ fontSize:24, fontWeight:800, color:s.color }}>{counts[s.key]}</div>
            <div style={{ fontSize:12, color:s.color, fontWeight:600, marginTop:2 }}>{s.icon} {s.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search address, client, postcode…"
          style={{ ...inp, flex:1, minWidth:220 }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, width:'auto' }}>
          <option value="all">All clients</option>
          <option value="Landlord">Landlords</option>
          <option value="Estate Agent">Estate Agents</option>
        </select>
        {filterStatus !== 'all' && (
          <button onClick={() => setFilterStatus('all')}
            style={{ background:C.redSoft, color:C.red, border:`1px solid ${C.red}44`, borderRadius:8, padding:'8px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
            ✕ Clear filter
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:C.muted, fontSize:14 }}>Loading properties…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:C.muted, fontSize:14 }}>
          No properties match your filters.
        </div>
      ) : (
        <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:C.surface }}>
                {['Address','Client','Compliance','Last Job','Jobs',''].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', borderBottom:`1px solid ${C.border}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} onClick={() => setSelected(p)}
                  style={{ cursor:'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.surface}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={td}>
                    <div style={{ fontWeight:600, color:C.text, fontSize:13 }}>{p.address}</div>
                    {p.postcode && <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{p.postcode}</div>}
                  </td>
                  <td style={td}>
                    {p.client ? (
                      <div>
                        <div style={{ fontSize:13, color:C.accent, fontWeight:600 }}
                          onClick={e => { e.stopPropagation(); navigate(`/clients/${p.client.id}`) }}>
                          {cName(p.client)}
                        </div>
                        <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{p.client.client_type}</div>
                      </div>
                    ) : <span style={{ color:C.dim }}>—</span>}
                  </td>
                  <td style={td}>
                    {Object.keys(p.latestByCert).length === 0 ? (
                      <span style={{ fontSize:12, color:C.dim, fontStyle:'italic' }}>No records</span>
                    ) : (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                        {Object.entries(p.latestByCert).map(([cert, date]) => (
                          <CompliancePill key={cert} type={cert} date={date} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {p.lastJob ? (
                      <div>
                        <div style={{ fontSize:12, color:C.text }}>{fmtD(p.lastJob.scheduled_date)}</div>
                        <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{p.lastJob.title?.split('—')[0]?.trim()}</div>
                      </div>
                    ) : <span style={{ color:C.dim, fontSize:12 }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign:'center' }}>
                    <span style={{ fontWeight:700, color:p.propJobs.length > 0 ? C.accent : C.dim }}>
                      {p.propJobs.length}
                    </span>
                  </td>
                  <td style={{ ...td, width:40 }}>
                    <span style={{ color:C.dim, fontSize:13 }}>→</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Property detail modal */}
      {selected && (
        <PropertyDetail
          property={selected}
          jobs={jobs}
          onClose={() => setSelected(null)}
          navigate={navigate}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
