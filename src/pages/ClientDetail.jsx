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

const JOB_STATUS_COLORS = {
  'Quote':     { color: '#7C3AED', bg: '#EDE9FE' },
  'Scheduled': { color: '#0284C7', bg: '#E0F2FE' },
  'Invoiced':  { color: '#D97706', bg: '#FEF3C7' },
  'Paid':      { color: '#0093DB', bg: '#E6F4FC' },
  'Completed': { color: '#3d7a00', bg: '#F0FAE0' },
  'Cancelled': { color: '#DC2626', bg: '#FEE2E2' },
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

const Field = ({ label, value, editable, onChange }) => (
  <div style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
    <span style={{ color: C.muted, fontSize: 13, minWidth: 130, flexShrink: 0 }}>{label}</span>
    {editable ? (
      <input value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '4px 8px', fontSize: 13, textAlign: 'right', flex: 1 }} />
    ) : (
      <span style={{ color: C.text, fontSize: 13, textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
    )}
  </div>
)

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [client, setClient]   = useState(null)
  const [jobs, setJobs]       = useState([])
  const [invoices, setInvoices] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [showEmail, setShowEmail] = useState(false)
  const [editAssign, setEditAssign] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: j }, { data: inv }, { data: p }] = await Promise.all([
      supabase.from('clients').select('*, profiles(full_name)').eq('id', id).single(),
      supabase.from('jobs').select('id, job_number, title, status, scheduled_date, invoice_amount, payment_status, service_types, profiles(full_name)').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, invoice_number, doc_type, total, balance_due, status, created_at').eq('client_id', id).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    ])
    setClient(c)
    setJobs(j || [])
    setInvoices(inv || [])
    setProfiles(p || [])
    if (c) setEditForm(c)
    setLoading(false)
  }

  async function saveEdit() {
    setSaving(true)
    const { error } = await supabase.from('clients').update({
      company_name: editForm.company_name, first_name: editForm.first_name,
      last_name: editForm.last_name, email: editForm.email, phone: editForm.phone,
      phone_2: editForm.phone_2, whatsapp: editForm.whatsapp,
      street_address: editForm.street_address, city: editForm.city, postcode: editForm.postcode,
      billing_name: editForm.billing_name, billing_email: editForm.billing_email,
      billing_address: editForm.billing_address, notes: editForm.notes,
    }).eq('id', id)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    setClient(p => ({ ...p, ...editForm }))
    setEditing(false)
    await logActivity({ clientId: id, repId: profile.id, repName: profile.full_name, type: 'note', title: 'Client details updated', body: 'Client information was updated' })
    showToast('Client updated ✓')
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
  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))
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
          <Btn small variant="ghost" onClick={() => setShowEmail(true)}>✉ Send Email</Btn>
          <Btn small onClick={() => navigate(`/jobs?client=${id}`)}>+ New Job</Btn>
          {isAdmin && <Btn small variant={editing ? 'success' : 'ghost'} onClick={() => editing ? saveEdit() : setEditing(true)} disabled={saving}>
            {saving ? 'Saving…' : editing ? '✓ Save' : '✏ Edit'}
          </Btn>}
          {editing && <Btn small variant="ghost" onClick={() => { setEditing(false); setEditForm(client) }}>Cancel</Btn>}
          <Btn small variant={client.is_active !== false ? 'danger' : 'success'} onClick={toggleActive}>
            {client.is_active !== false ? 'Deactivate' : 'Activate'}
          </Btn>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Jobs',    value: client.total_jobs || jobs.length || 0,      color: C.accent },
          { label: 'Total Revenue', value: fmt(client.total_revenue || 0),              color: C.greenDark },
          { label: 'Invoices',      value: invoices.length,                             color: C.purple },
          { label: 'Outstanding',   value: fmt(invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.balance_due || 0), 0)), color: C.amber },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 10, padding: '12px 18px', flex: 1, minWidth: 110, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 20, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

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
        {[['overview','📄 Overview'],['jobs','🔧 Jobs'],['invoices','🧾 Invoices'],['activity','📋 Activity']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === t ? 700 : 400, background: activeTab === t ? '#fff' : 'transparent', color: activeTab === t ? C.accent : C.muted }}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Contact Details</div>
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[['First Name','first_name'],['Last Name','last_name'],['Company','company_name'],['Email','email'],['Phone','phone'],['Phone 2','phone_2'],['WhatsApp','whatsapp']].map(([l,k]) => (
                  <div key={k}><label style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>{l}</label>
                    <input value={editForm[k] || ''} onChange={e => ef(k, e.target.value)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <Field label="Company"    value={client.company_name} />
                <Field label="First Name" value={client.first_name} />
                <Field label="Last Name"  value={client.last_name} />
                <Field label="Email"      value={client.email} />
                <Field label="Phone"      value={client.phone} />
                <Field label="Phone 2"    value={client.phone_2} />
                <Field label="WhatsApp"   value={client.whatsapp} />
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Address & Billing</div>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[['Street Address','street_address'],['City','city'],['Postcode','postcode'],['Billing Name','billing_name'],['Billing Email','billing_email'],['Billing Address','billing_address']].map(([l,k]) => (
                    <div key={k}><label style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>{l}</label>
                      <input value={editForm[k] || ''} onChange={e => ef(k, e.target.value)} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <Field label="Address"     value={[client.street_address, client.city, client.postcode].filter(Boolean).join(', ')} />
                  <Field label="Billing Name"  value={client.billing_name} />
                  <Field label="Billing Email" value={client.billing_email} />
                  <Field label="Billing Addr"  value={client.billing_address} />
                </>
              )}
            </div>

            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Notes</div>
              {editing ? (
                <textarea value={editForm.notes || ''} onChange={e => ef('notes', e.target.value)} rows={4}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '8px 10px', fontSize: 13, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
              ) : (
                <div style={{ color: client.notes ? C.text : C.dim, fontSize: 13, lineHeight: 1.7 }}>{client.notes || 'No notes.'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Jobs tab */}
      {activeTab === 'jobs' && (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.border}`, alignItems: 'center' }}>
            <div style={{ fontWeight: 700, color: C.text }}>{jobs.length} Jobs</div>
            <Btn small onClick={() => navigate('/jobs')}>+ New Job</Btn>
          </div>
          {jobs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>No jobs yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {['Job #','Title','Status','Services','Engineer','Value','Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => {
                  const sc = JOB_STATUS_COLORS[job.status] || { color: C.muted, bg: C.surface }
                  return (
                    <tr key={job.id} onClick={() => navigate(`/jobs/${job.id}`)} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}` }}><span style={{ color: C.accent, fontWeight: 700 }}>{job.job_number}</span></td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontWeight: 600, color: C.text }}>{job.title}</td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}` }}><span style={{ background: sc.bg, color: sc.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{job.status}</span></td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>{(job.service_types || []).join(', ') || '—'}</td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, color: C.muted }}>{job.profiles?.full_name || '—'}</td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, color: C.greenDark, fontWeight: 600 }}>{job.invoice_amount > 0 ? fmt(job.invoice_amount) : '—'}</td>
                      <td style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.dim }}>{job.scheduled_date || '—'}</td>
                    </tr>
                  )
                })}
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
