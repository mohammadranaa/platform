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

const LEAD_STATUSES = ['New','Contacted','In Discussion','Declined','Accepted']
const STATUS_COLORS = {
  'New':           { color: C.muted,     bg: C.surface   },
  'Contacted':     { color: C.accent,    bg: C.accentSoft },
  'In Discussion': { color: C.amber,     bg: C.amberSoft  },
  'Declined':      { color: C.red,       bg: C.redSoft    },
  'Accepted':      { color: C.greenDark, bg: C.greenSoft  },
}

const TYPE_META = {
  inbound:    { label: 'Inbound',     color: C.accent,  bg: C.accentSoft },
  verified:   { label: 'Verified',    color: C.purple,  bg: C.purpleSoft },
  cold_agent: { label: 'Cold Agent',  color: C.amber,   bg: C.amberSoft  },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
    purple:  { background: C.purpleSoft, color: C.purple,    border: `1px solid ${C.purple}44` },
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

const Field = ({ label, value }) => (
  <div style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
    <span style={{ color: C.muted, fontSize: 13, minWidth: 140, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, fontSize: 13, textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
  </div>
)

export default function LeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [lead, setLead]         = useState(null)
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [editAssign, setEditAssign] = useState(false)
  const [activeTab, setActiveTab]   = useState('details')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [{ data: l }, { data: p }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', id).single(),
      supabase.from('profiles').select('id, full_name, role').eq('is_active', true),
    ])
    setLead(l)
    setProfiles(p || [])
    setLoading(false)
  }

  async function updateStatus(status) {
    const old = lead.status
    setSaving(true)
    await supabase.from('leads').update({ status }).eq('id', id)
    await logActivity({
      leadId: id, repId: profile.id, repName: profile.full_name,
      type: 'status_change', title: `Status: ${old} → ${status}`,
      body: `Lead status changed from ${old} to ${status}`,
      metadata: { from: old, to: status },
    })
    setLead(p => ({ ...p, status }))
    setSaving(false)
    showToast(`Status → ${status}`)

    // Auto-convert to client if Accepted
    if (status === 'Accepted') await convertToClient()
  }

  async function updateAssignment(repId) {
    const rep = profiles.find(p => p.id === repId)
    await supabase.from('leads').update({ assigned_to: repId }).eq('id', id)
    await logActivity({
      leadId: id, repId: profile.id, repName: profile.full_name,
      type: 'assignment', title: `Assigned to ${rep?.full_name}`,
      body: `Lead assigned to ${rep?.full_name}`,
    })
    setLead(p => ({ ...p, assigned_to: repId }))
    setEditAssign(false)
    showToast(`Assigned to ${rep?.full_name}`)
  }

  async function convertToClient() {
    const name = lead.inbound_name || lead.company_name || lead.cold_company_name ||
      `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()
    const email = lead.inbound_email || lead.email_address || lead.cold_email
    const phone = lead.inbound_phone || lead.job_telephone || lead.job_mobile || lead.direct_number

    const { data: client, error } = await supabase.from('clients').insert({
      client_type:   lead.lead_type === 'cold_agent' ? 'Estate Agent' : 'Landlord',
      company_name:  lead.company_name || lead.cold_company_name || null,
      first_name:    lead.contact_first || (lead.inbound_name ? lead.inbound_name.split(' ')[0] : null),
      last_name:     lead.contact_last  || (lead.inbound_name ? lead.inbound_name.split(' ').slice(1).join(' ') : null),
      email, phone,
      street_address: lead.street_address || lead.address || lead.cold_address,
      city: lead.city, postcode: lead.postcode,
      source: 'converted-lead', lead_id: id,
      assigned_to: lead.assigned_to || profile.id,
      is_active: true,
    }).select().single()

    if (!error && client) showToast(`✓ ${name} added to Clients`)
  }

  const displayName = () => {
    if (!lead) return ''
    if (lead.lead_type === 'inbound')    return lead.inbound_name || lead.inbound_email
    if (lead.lead_type === 'verified')   return lead.company_name || `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()
    return lead.cold_company_name || lead.cold_contact_name
  }

  const displayEmail = () => lead?.inbound_email || lead?.email_address || lead?.cold_email
  const displayPhone = () => lead?.inbound_phone || lead?.job_telephone || lead?.job_mobile || lead?.direct_number

  const renewalDays = lead?.renewal_due_date
    ? Math.floor((new Date(lead.renewal_due_date) - new Date()) / 86400000) : null

  const assignedRep = profiles.find(p => p.id === lead?.assigned_to)

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!lead)   return <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Lead not found.</div>

  const tm = TYPE_META[lead.lead_type] || { label: lead.lead_type, color: C.muted, bg: C.surface }
  const sm = STATUS_COLORS[lead.status] || { color: C.muted, bg: C.surface }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Btn variant="ghost" small onClick={() => navigate('/leads')}>← Leads</Btn>
            <span style={{ background: tm.bg, color: tm.color, border: `1px solid ${tm.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{tm.label}</span>
            <span style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{lead.status}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{displayName()}</h1>
          {displayEmail() && <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{displayEmail()}</div>}
          {displayPhone() && <div style={{ color: C.muted, fontSize: 13 }}>{displayPhone()}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Btn small variant="ghost" onClick={() => setShowEmail(true)}>✉ Send Email</Btn>
          {lead.status !== 'Accepted' && (
            <Btn small variant="success" onClick={() => updateStatus('Accepted')} disabled={saving}>
              ✓ Accept → Client
            </Btn>
          )}
          {/* Status dropdown */}
          <select value={lead.status} onChange={e => updateStatus(e.target.value)} disabled={saving}
            style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44`, borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Assigned rep bar */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>👤</span>
          <div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assigned Rep</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{assignedRep?.full_name || 'Unassigned'}</div>
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
        {['details','activity'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            style={{ padding: '7px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === t ? 700 : 400, background: activeTab === t ? '#fff' : 'transparent', color: activeTab === t ? C.accent : C.muted, textTransform: 'capitalize' }}>
            {t === 'activity' ? '📋 Activity' : '📄 Details'}
          </button>
        ))}
      </div>

      {activeTab === 'details' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Left col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Core info */}
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Contact Details</div>
              {lead.lead_type === 'inbound' && <>
                <Field label="Full Name"      value={lead.inbound_name} />
                <Field label="Email"          value={lead.inbound_email} />
                <Field label="Phone"          value={lead.inbound_phone} />
                <Field label="Tenant Phone"   value={lead.tenant_phone} />
                <Field label="Address"        value={[lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ')} />
                <Field label="Property Type"  value={`${lead.property_type || ''} ${lead.property_subtype || ''}`.trim()} />
              </>}
              {lead.lead_type === 'verified' && <>
                <Field label="Company"        value={lead.company_name} />
                <Field label="Contact"        value={`${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()} />
                <Field label="Email"          value={lead.email_address} />
                <Field label="Telephone"      value={lead.job_telephone} />
                <Field label="Mobile"         value={lead.job_mobile} />
                <Field label="Address"        value={lead.address} />
                <Field label="Billing"        value={lead.billing_address} />
              </>}
              {lead.lead_type === 'cold_agent' && <>
                <Field label="Company"        value={lead.cold_company_name} />
                <Field label="Contact"        value={lead.cold_contact_name} />
                <Field label="Email"          value={lead.cold_email} />
                <Field label="Direct"         value={lead.direct_number} />
                <Field label="Landline"       value={lead.landline_number} />
                <Field label="Zoopla #"       value={lead.zoopla_number} />
                <Field label="Address"        value={lead.cold_address} />
                <Field label="Website"        value={lead.website} />
                <Field label="Email Verified" value={lead.email_verified} />
              </>}
              {lead.notes && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: C.surface, borderRadius: 8, fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                  {lead.notes}
                </div>
              )}
            </div>
          </div>

          {/* Right col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {lead.lead_type === 'inbound' && (
              <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Booking Details</div>
                <Field label="Appointment"    value={lead.appointment_date} />
                <Field label="Time Slot"      value={lead.time_slot} />
                <Field label="Services"       value={lead.services_requested} />
                <Field label="Total Price"    value={lead.total_price ? `£${lead.total_price}` : null} />
                <Field label="Payment Status" value={lead.payment_status} />
                <Field label="Additional"     value={lead.additional_charges} />
                <Field label="Timestamp"      value={lead.form_timestamp ? new Date(lead.form_timestamp).toLocaleString('en-GB') : null} />
              </div>
            )}

            {lead.lead_type === 'verified' && (
              <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Previous Job & Renewal</div>
                <Field label="Job Date"       value={lead.previous_job_date} />
                <Field label="Work Done"      value={lead.work_done} />
                <Field label="Last Payment"   value={lead.last_payment_amount ? `£${lead.last_payment_amount}` : null} />
                <Field label="Last Invoice"   value={lead.last_invoice_amount ? `£${lead.last_invoice_amount}` : null} />
                {lead.renewal_due_date && (
                  <div style={{ marginTop: 12, padding: '12px 14px', background: renewalDays < 0 ? C.redSoft : renewalDays <= 14 ? C.amberSoft : C.greenSoft, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: renewalDays < 0 ? C.red : renewalDays <= 14 ? C.amber : C.greenDark, textTransform: 'uppercase', marginBottom: 3 }}>Renewal Due</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: renewalDays < 0 ? C.red : renewalDays <= 14 ? C.amber : C.greenDark }}>
                        {lead.renewal_due_date}
                      </div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: renewalDays < 0 ? C.red : renewalDays <= 14 ? C.amber : C.greenDark }}>
                      {renewalDays < 0 ? `${Math.abs(renewalDays)}d overdue` : `${renewalDays}d left`}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Meta */}
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Record Info</div>
              <Field label="Created"       value={new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
              <Field label="Lead Type"     value={TYPE_META[lead.lead_type]?.label} />
              <Field label="Assigned To"   value={assignedRep?.full_name || 'Unassigned'} />
              <Field label="Source"        value={lead.source} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>Activity Timeline</div>
          <ActivityFeed leadId={id} />
        </div>
      )}

      {/* Email compose window */}
      {showEmail && (
        <EmailCompose
          onClose={() => setShowEmail(false)}
          context={{
            leadId:    id,
            toEmail:   displayEmail(),
            toName:    displayName(),
            name:      displayName(),
            repName:   profile.full_name,
            address:   lead.street_address || lead.address || lead.cold_address,
            services:  lead.services_requested || lead.work_done,
            renewalDate: lead.renewal_due_date,
            lastJobDate: lead.previous_job_date,
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
