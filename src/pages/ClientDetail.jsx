import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import ActivityFeed, { logActivity } from '../components/ActivityFeed.jsx'
import EmailCompose from '../components/EmailCompose.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}


const TYPE_COLORS = {
  'Landlord':     { color: C.accent,    bg: C.accentSoft },
  'Estate Agent': { color: C.purple,    bg: C.purpleSoft },
  'Other':        { color: C.muted,     bg: C.surface    },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
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

function Field({ label, field, value, type = 'text', options = null, wide = false, save }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  useEffect(() => setVal(value || ''), [value])

  if (options) {
    return (
      <div style={{ marginBottom:14, gridColumn: wide ? 'span 2' : undefined }}>
        <div style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{label}</div>
        <select value={val} onChange={e => { setVal(e.target.value); save(field, e.target.value) }}
          style={{ width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'8px 12px', fontSize:14, color:'#1F2937' }}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div style={{ marginBottom:14, gridColumn: wide ? 'span 2' : undefined }}>
      <div style={{ color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{label}</div>
      {editing ? (
        type === 'textarea' ? (
          <textarea autoFocus value={val} onChange={e => setVal(e.target.value)}
            onBlur={() => { save(field, val); setEditing(false) }}
            rows={4}
            style={{ width:'100%', background:'#fff', border:'1px solid #0093DB', borderRadius:8, padding:'8px 12px', fontSize:14, color:'#1F2937', fontFamily:'inherit', resize:'vertical' }} />
        ) : (
          <input autoFocus type={type} value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={() => { save(field, val); setEditing(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { save(field, val); setEditing(false) }
              if (e.key === 'Escape') { setVal(value || ''); setEditing(false) }
            }}
            style={{ width:'100%', background:'#fff', border:'1px solid #0093DB', borderRadius:8, padding:'8px 12px', fontSize:14, color:'#1F2937' }} />
        )
      ) : (
        <div onClick={() => setEditing(true)}
          style={{ padding:'8px 12px', background:'#F5F7FA', borderRadius:8, cursor:'text', fontSize:14, color: val ? '#1F2937' : '#9CA3AF', minHeight:40, display:'flex', alignItems:'center', justifyContent:'space-between', border:'1px solid transparent' }}
          title="Click to edit">
          <span>{val || 'Click to add...'}</span>
          <span style={{ color:'#D1D5DB', fontSize:12, flexShrink:0, marginLeft:8 }}>✏</span>
        </div>
      )}
    </div>
  )
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [client, setClient]   = useState(null)
  const [clientJobs, setClientJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEmail, setShowEmail] = useState(false)
  const [editAssign, setEditAssign] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: j }, { data: inv }, { data: p }] = await Promise.all([
      supabase.from('clients').select('*, profiles(full_name)').eq('id', id).single(),
      supabase.from('jobs').select('id, job_number, title, status, amount_received, gross_profit, scheduled_date, payment_status, service_types').eq('client_id', id).order('scheduled_date', { ascending: false }),
      supabase.from('invoices').select('id, invoice_number, doc_type, total, balance_due, status, created_at').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    ])
    setClient(c)
    setClientJobs(j || [])
    setInvoices(inv || [])
    setProfiles(p || [])
    setLoading(false)
  }

  async function saveField(field, value) {
    const { error } = await supabase
      .from('clients')
      .update({ [field]: value })
      .eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setClient(prev => ({ ...prev, [field]: value }))
    showToast('Saved')
  }

  async function updateAssignment(repId) {
    const rep = profiles.find(p => p.id === repId)
    await supabase.from('clients').update({ assigned_to: repId }).eq('id', id)
    await logActivity({ clientId: id, repId: profile.id, repName: profile.full_name, type: 'assignment', title: `Assigned to ${rep?.full_name}`, body: `Client assigned to ${rep?.full_name}` })
    setClient(p => ({ ...p, assigned_to: repId, profiles: rep }))
    setEditAssign(false)
    showToast(`Assigned to ${rep?.full_name}`)
  }

  async function toggleActive() {
    const newVal = !client.is_active
    await supabase.from('clients').update({ is_active: newVal }).eq('id', id)
    setClient(p => ({ ...p, is_active: newVal }))
    showToast(newVal ? 'Client activated' : 'Client deactivated')
  }

  const clientName = () => client?.company_name || `${client?.first_name || ''} ${client?.last_name || ''}`.trim() || client?.email
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const tm = TYPE_COLORS[client?.client_type] || { color: C.muted, bg: C.surface }

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!client) return <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Client not found.</div>

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Btn variant="ghost" small onClick={() => navigate('/clients')}>← Clients</Btn>
            <span style={{ background: tm.bg, color: tm.color, border: `1px solid ${tm.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{client.client_type}</span>
            <span style={{ background: client.is_active !== false ? C.greenSoft : C.redSoft, color: client.is_active !== false ? C.greenDark : C.red, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
              {client.is_active !== false ? 'Active' : 'Inactive'}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{clientName()}</h1>
          {client.email && <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{client.email}</div>}
          {client.phone && <div style={{ color: C.muted, fontSize: 13 }}>{client.phone}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {client.phone && (
            <a href={`tel:${client.phone}`}
              onClick={() => logActivity({ clientId: id, repId: profile.id, repName: profile.full_name, type: 'call', title: `Outbound call to ${client.phone}`, body: `Called ${clientName()} on ${client.phone}` })}
              style={{ background: '#F0FAE0', color: '#3d7a00', border: '1px solid #80D10066', borderRadius: 8, padding: '6px 13px', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              📞 Call
            </a>
          )}
          <Btn small variant="ghost" onClick={() => setShowEmail(true)}>✉ Send Email</Btn>
          <Btn small onClick={() => navigate(`/jobs?client=${id}`)}>+ New Job</Btn>
          <Btn small variant={client.is_active !== false ? 'danger' : 'success'} onClick={toggleActive}>
            {client.is_active !== false ? 'Deactivate' : 'Activate'}
          </Btn>
        </div>
      </div>

      {/* Stats bar */}
      {clientJobs.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Jobs', value: clientJobs.length, color: '#0093DB' },
            { label: 'Total Revenue', value: '£' + clientJobs.reduce((s, j) => s + Number(j.amount_received || 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 }), color: '#3d7a00' },
            { label: 'Gross Profit', value: '£' + clientJobs.reduce((s, j) => s + Number(j.gross_profit || 0), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 }), color: '#0D9488' },
            { label: 'Completed', value: clientJobs.filter(j => j.status === 'Completed').length, color: '#3d7a00' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 110 }}>
              <div style={{ color: '#6B7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ color: s.color, fontSize: 18, fontWeight: 800 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Assigned rep bar */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>👤</span>
          <div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assigned Rep</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{client.profiles?.full_name || 'Unassigned'}</div>
          </div>
        </div>
        {editAssign ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select onChange={e => updateAssignment(e.target.value)} defaultValue=""
              style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '6px 10px', fontSize: 13 }}>
              <option value="">— Select rep —</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>)}
            </select>
            <button onClick={() => setEditAssign(false)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <Btn small variant="ghost" onClick={() => setEditAssign(true)}>Reassign</Btn>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content' }}>
        {[['overview','📄 Overview'],['jobs',`🔧 Jobs (${clientJobs.length})`],['invoices','🧾 Invoices'],['activity','📋 Activity']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === t ? 700 : 400, background: activeTab === t ? '#fff' : 'transparent', color: activeTab === t ? C.accent : C.muted }}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Contact Details</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <Field label="First Name" field="first_name" value={client.first_name} save={saveField} />
            <Field label="Last Name" field="last_name" value={client.last_name} save={saveField} />
            <Field label="Company / Estate Agency" field="company_name" value={client.company_name} wide={false} save={saveField} />
            <Field label="Client Type" field="client_type" value={client.client_type} options={['Landlord','Estate Agent','Other']} save={saveField} />
            <Field label="Email" field="email" value={client.email} type="email" save={saveField} />
            <Field label="Phone" field="phone" value={client.phone} type="tel" save={saveField} />
            <Field label="Phone 2 (Mobile/Alt)" field="phone_2" value={client.phone_2} type="tel" save={saveField} />
            <Field label="WhatsApp" field="whatsapp" value={client.whatsapp} type="tel" save={saveField} />
            <Field label="Street Address" field="street_address" value={client.street_address} wide={true} save={saveField} />
            <Field label="City" field="city" value={client.city} save={saveField} />
            <Field label="Postcode" field="postcode" value={client.postcode} save={saveField} />
            <Field label="Billing Name" field="billing_name" value={client.billing_name} save={saveField} />
            <Field label="Billing Email" field="billing_email" value={client.billing_email} type="email" save={saveField} />
            <Field label="Billing Address" field="billing_address" value={client.billing_address} wide={true} save={saveField} />
            <Field label="Notes" field="notes" value={client.notes} type="textarea" wide={true} save={saveField} />
          </div>
        </div>
      )}

      {/* Jobs tab */}
      {activeTab === 'jobs' && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          {clientJobs.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: '#9CA3AF' }}>No jobs yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Job #','Date','Service','Status','Revenue','Profit'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA', color: '#6B7280' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientJobs.map(j => (
                  <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/jobs/' + j.id)} onMouseEnter={e => e.currentTarget.style.background = '#F5F7FA'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 12 }}><span style={{ color: '#0093DB', fontWeight: 700 }}>{j.job_number}</span></td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 12, color: '#9CA3AF' }}>{j.scheduled_date || '—'}</td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 12, color: '#6B7280' }}>{(j.service_types || []).join(', ') || j.title}</td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB' }}><span style={{ background: j.status === 'Completed' ? '#F0FAE0' : '#F5F7FA', color: j.status === 'Completed' ? '#3d7a00' : '#6B7280', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 600 }}>{j.status}</span></td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 12, fontWeight: 700, color: '#3d7a00' }}>£{Number(j.amount_received || 0).toFixed(2)}</td>
                    <td style={{ padding: '9px 12px', borderBottom: '1px solid #E5E7EB', fontSize: 12, fontWeight: 700, color: Number(j.gross_profit) > 0 ? '#0D9488' : '#DC2626' }}>£{Number(j.gross_profit || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Invoices tab */}
      {activeTab === 'invoices' && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontWeight: 700, color: C.text }}>{invoices.length} Invoices / Quotes</div>
            <Btn small onClick={() => navigate('/invoices')}>+ New Invoice</Btn>
          </div>
          {invoices.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>No invoices yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {['#','Type','Total','Balance','Status','Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} onClick={() => navigate('/invoices')} style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, color: C.accent, fontWeight: 700 }}>{inv.invoice_number}</td>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>{inv.doc_type}</td>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{fmt(inv.total)}</td>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, color: inv.balance_due > 0 ? C.amber : C.greenDark, fontWeight: 600 }}>{fmt(inv.balance_due)}</td>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ background: inv.status === 'paid' ? C.greenSoft : C.amberSoft, color: inv.status === 'paid' ? C.greenDark : C.amber, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{inv.status}</span>
                    </td>
                    <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.dim }}>{new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Activity tab */}
      {activeTab === 'activity' && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>Activity Timeline</div>
          <ActivityFeed clientId={id} />
        </div>
      )}

      {showEmail && (
        <EmailCompose
          onClose={() => setShowEmail(false)}
          context={{
            clientId: id,
            toEmail:  client.billing_email || client.email,
            toName:   clientName(),
            name:     clientName(),
            repName:  profile.full_name,
            address:  [client.street_address, client.city, client.postcode].filter(Boolean).join(', '),
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
