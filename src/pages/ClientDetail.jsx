import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED',
  teal: '#0D9488',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const STATUSES = ['New','Contacted','Qualified','Proposal Sent','Active Client','Closed Won','Closed Lost','Unsubscribed']

const STATUS_COLORS = {
  'New':           { color: C.muted,   bg: C.surface },
  'Contacted':     { color: C.amber,   bg: C.amberSoft },
  'Qualified':     { color: C.purple,  bg: '#EDE9FE' },
  'Proposal Sent': { color: '#0284C7', bg: '#E0F2FE' },
  'Active Client': { color: C.green,   bg: C.greenSoft },
  'Closed Won':    { color: C.green,   bg: C.greenSoft },
  'Closed Lost':   { color: C.red,     bg: C.redSoft },
  'Unsubscribed':  { color: C.dim,     bg: C.surface },
}

const TYPE_META = {
  inbound:    { label: 'Inbound',     color: C.green },
  verified:   { label: 'Verified',    color: C.accent },
  cold_agent: { label: 'Cold Agent',  color: C.amber },
}

const JOB_STATUS_COLORS = {
  'Quote': C.purple, 'Scheduled': '#0284C7', 'In Progress': C.amber,
  'Completed': C.teal, 'Invoiced': C.accent, 'Paid': C.green, 'Cancelled': C.red,
}

const ACT_ICONS = { note: '📝', call: '📞', email: '✉️', whatsapp: '💬', meeting: '🤝', status_change: '🔄', job_created: '🔧', invoice_sent: '🧾', payment_received: '💰' }

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

const InfoRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}18`, fontSize: 14 }}>
    <span style={{ color: C.muted, minWidth: 130 }}>{label}</span>
    <span style={{ color: C.text, textAlign: 'right' }}>{value || '—'}</span>
  </div>
)

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [client, setClient]       = useState(null)
  const [jobs, setJobs]           = useState([])
  const [activities, setActivities] = useState([])
  const [profiles, setProfiles]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  const [actInput, setActInput]   = useState({ type: 'note', content: '' })
  const [editStatus, setEditStatus] = useState(false)
  const [editAssign, setEditAssign] = useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchClient(), fetchJobs(), fetchActivities(), fetchProfiles()])
    setLoading(false)
  }

  async function fetchClient() {
    const { data } = await supabase
      .from('clients')
      .select('*, profiles(full_name)')
      .eq('id', id)
      .single()
    setClient(data)
  }

  async function fetchJobs() {
    const { data } = await supabase
      .from('jobs')
      .select('id, job_number, title, status, scheduled_date, invoice_amount, payment_status')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
    setJobs(data || [])
  }

  async function fetchActivities() {
    const { data } = await supabase
      .from('client_activities')
      .select('*')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(50)
    setActivities(data || [])
  }

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('is_active', true)
    setProfiles(data || [])
  }

  async function logActivity() {
    if (!actInput.content.trim()) return
    setSaving(true)
    const { error } = await supabase.from('client_activities').insert({
      client_id: id,
      rep_id: profile.id,
      rep_name: profile.full_name,
      type: actInput.type,
      content: actInput.content,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    setActInput({ type: 'note', content: '' })
    await fetchActivities()
    showToast('Activity logged ✓')
  }

  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('clients').update({ status }).eq('id', id)
    await supabase.from('client_activities').insert({
      client_id: id, rep_id: profile.id, rep_name: profile.full_name,
      type: 'status_change', content: `Status changed to "${status}"`,
    })
    setSaving(false)
    setClient(p => ({ ...p, status }))
    setActivities(prev => [{ type: 'status_change', content: `Status changed to "${status}"`, rep_name: profile.full_name, created_at: new Date().toISOString() }, ...prev])
    setEditStatus(false)
    showToast(`Status updated to ${status}`)
  }

  async function updateAssignment(assigned_to) {
    await supabase.from('clients').update({ assigned_to }).eq('id', id)
    setClient(p => ({ ...p, assigned_to }))
    setEditAssign(false)
    showToast('Assigned rep updated ✓')
  }

  async function deleteClient() {
    if (!window.confirm('Delete this client? This cannot be undone.')) return
    await supabase.from('clients').delete().eq('id', id)
    navigate('/clients')
    showToast('Client deleted')
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || c?.email || 'Unnamed'

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!client) return <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Client not found.</div>

  const sm = STATUS_COLORS[client.status] || { color: C.muted, bg: C.surface }
  const tm = TYPE_META[client.customer_type] || { label: client.customer_type, color: C.muted }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <Btn variant="ghost" small onClick={() => navigate('/clients')}>← Back</Btn>
            <span style={{ background: tm.color + '22', color: tm.color, border: `1px solid ${tm.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
              {tm.label}
            </span>
            <span style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
              {client.status}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{clientName(client)}</h1>
          {client.company_name && (client.first_name || client.last_name) && (
            <div style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>
              Contact: {client.first_name} {client.last_name}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="primary" onClick={() => navigate(`/jobs?client=${id}`)}>+ New Job</Btn>
          {isAdmin && <Btn small variant="danger" onClick={deleteClient}>Delete</Btn>}
        </div>
      </div>

      {/* Lifetime stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total Jobs',    value: client.total_jobs || 0,              color: C.accent },
          { label: 'Total Revenue', value: fmt(client.total_revenue),            color: C.green },
          { label: 'Source',        value: client.source || '—',                color: C.muted },
          { label: 'Added',         value: new Date(client.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), color: C.muted },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', flex: 1, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 20, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* ── LEFT COLUMN ─────────────────────────────────── */}
        <div>
          {/* Contact info */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Contact Information</div>
            <InfoRow label="Email"        value={client.email} />
            <InfoRow label="Phone"        value={client.phone} />
            <InfoRow label="Phone 2"      value={client.phone_2} />
            <InfoRow label="WhatsApp"     value={client.whatsapp} />
            <InfoRow label="Address"      value={[client.street_address, client.city, client.postcode].filter(Boolean).join(', ')} />
            {client.website && <InfoRow label="Website" value={<a href={client.website} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{client.website}</a>} />}
            {client.zoopla_phone && <InfoRow label="Zoopla Phone" value={client.zoopla_phone} />}
          </div>

          {/* Billing info (verified/cold_agent) */}
          {(client.billing_name || client.billing_email || client.billing_address) && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Billing Contact</div>
              <InfoRow label="Billing Name"    value={client.billing_name} />
              <InfoRow label="Billing Email"   value={client.billing_email} />
              <InfoRow label="Billing Address" value={client.billing_address} />
              <InfoRow label="Billing Phone"   value={client.billing_phone} />
            </div>
          )}

          {/* Inbound booking details */}
          {client.customer_type === 'inbound' && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Booking Details</div>
              <InfoRow label="Property Type"    value={client.property_type} />
              <InfoRow label="Property Sub-type" value={client.property_subtype} />
              <InfoRow label="Services"          value={client.services_requested} />
              <InfoRow label="Appointment Date"  value={client.appointment_date} />
              <InfoRow label="Time Slot"         value={client.time_slot} />
              <InfoRow label="Quoted Price"      value={client.quoted_price ? `£${client.quoted_price}` : null} />
              <InfoRow label="Payment Status"    value={client.payment_status} />
              <InfoRow label="Booking Status"    value={client.booking_status} />
            </div>
          )}

          {/* CRM status */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>CRM Status</div>
            {editStatus ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {STATUSES.map(s => {
                  const m = STATUS_COLORS[s] || { color: C.muted, bg: C.surface }
                  return (
                    <button key={s} onClick={() => updateStatus(s)}
                      style={{ background: client.status === s ? m.bg : 'transparent', color: m.color, border: `1px solid ${m.color}55`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: client.status === s ? 700 : 400 }}>
                      {s}
                    </button>
                  )
                })}
                <Btn small variant="ghost" onClick={() => setEditStatus(false)}>Cancel</Btn>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}33`, borderRadius: 8, padding: '5px 14px', fontSize: 13, fontWeight: 600 }}>
                  {client.status}
                </span>
                <Btn small variant="ghost" onClick={() => setEditStatus(true)}>Change</Btn>
              </div>
            )}
          </div>

          {/* Assigned rep */}
          {isAdmin && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Assigned Rep</div>
              {editAssign ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    defaultValue={client.assigned_to || ''}
                    onChange={e => updateAssignment(e.target.value)}
                    style={{ flex: 1, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: '#1F2937', padding: '8px 12px', fontSize: 14 }}
                  >
                    <option value="">— Unassigned —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <Btn small variant="ghost" onClick={() => setEditAssign(false)}>Cancel</Btn>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: C.text, fontSize: 14 }}>{client.profiles?.full_name || 'Unassigned'}</span>
                  <Btn small variant="ghost" onClick={() => setEditAssign(true)}>Change</Btn>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {client.notes && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Notes</div>
              <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, margin: 0 }}>{client.notes}</p>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────── */}
        <div>
          {/* Jobs */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Jobs ({jobs.length})</div>
              <Btn small onClick={() => navigate('/jobs/new?client=' + id)}>+ New Job</Btn>
            </div>
            {jobs.length === 0 ? (
              <div style={{ color: C.dim, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No jobs yet for this client.</div>
            ) : jobs.map(j => {
              const sc = JOB_STATUS_COLORS[j.status] || C.muted
              return (
                <div key={j.id} onClick={() => navigate(`/jobs/${j.id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.border}18`, cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{j.title}</div>
                    <div style={{ fontSize: 12, color: C.dim }}>{j.job_number} {j.scheduled_date ? `· 📅 ${j.scheduled_date}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ background: sc + '22', color: sc, border: `1px solid ${sc}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      {j.status}
                    </span>
                    {j.invoice_amount > 0 && (
                      <span style={{ color: C.accent, fontWeight: 600, fontSize: 12 }}>{fmt(j.invoice_amount)}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Activity Log */}
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Activity Log</div>

            {/* Log input */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={actInput.type} onChange={e => setActInput(p => ({ ...p, type: e.target.value }))}
                  style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: '#1F2937', padding: '8px 10px', fontSize: 13 }}>
                  <option value="note">📝 Note</option>
                  <option value="call">📞 Call</option>
                  <option value="email">✉️ Email</option>
                  <option value="whatsapp">💬 WhatsApp</option>
                  <option value="meeting">🤝 Meeting</option>
                </select>
                <input
                  value={actInput.content}
                  onChange={e => setActInput(p => ({ ...p, content: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && logActivity()}
                  placeholder="Log an activity… (Enter to save)"
                  style={{ flex: 1, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: '#1F2937', padding: '8px 12px', fontSize: 13 }}
                />
              </div>
              <Btn small onClick={logActivity} disabled={saving || !actInput.content.trim()}>
                {saving ? 'Saving…' : 'Log Activity'}
              </Btn>
            </div>

            {/* Activity list */}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {activities.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No activity yet.</div>}
              {activities.map((a, i) => (
                <div key={a.id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}18` }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{ACT_ICONS[a.type] || '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{a.content}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {a.rep_name} · {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
