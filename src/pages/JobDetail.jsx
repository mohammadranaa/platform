import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast'

const C = {
  bg: '#0F1117', surface: '#1A1D27', border: '#252836',
  accent: '#4F6EF7', accentSoft: '#1E2A5E',
  green: '#22C55E', greenSoft: '#14532D',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7', purpleSoft: '#2E1065',
  teal: '#2DD4BF', tealSoft: '#0D3330',
  text: '#F1F5F9', muted: '#94A3B8', dim: '#475569',
}

const JOB_STATUSES = [
  { key: 'Quote',       color: C.purple, bg: C.purpleSoft,  icon: '📋' },
  { key: 'Scheduled',   color: '#38BDF8', bg: '#0C2A3D',    icon: '📅' },
  { key: 'In Progress', color: C.amber,  bg: C.amberSoft,   icon: '🔧' },
  { key: 'Completed',   color: C.teal,   bg: C.tealSoft,    icon: '✅' },
  { key: 'Invoiced',    color: C.accent, bg: C.accentSoft,  icon: '🧾' },
  { key: 'Paid',        color: C.green,  bg: C.greenSoft,   icon: '💰' },
]
const STATUS_MAP = Object.fromEntries(JOB_STATUSES.map(s => [s.key, s]))

const DIARY_ICONS = { note: '📝', call: '📞', email: '✉️', whatsapp: '💬', status_change: '🔄', system: '⚙️' }

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: C.muted, border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft, color: C.red, border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.green, border: `1px solid ${C.green}44` },
    amber:   { background: C.amberSoft, color: C.amber, border: `1px solid ${C.amber}44` },
    teal:    { background: C.tealSoft, color: C.teal, border: `1px solid ${C.teal}44` },
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8, fontWeight: 600, padding: small ? '6px 13px' : '9px 18px', fontSize: small ? 12 : 14, opacity: disabled ? 0.5 : 1, ...v[variant], ...sx }}>
      {children}
    </button>
  )
}

const InfoRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}18`, fontSize: 14 }}>
    <span style={{ color: C.muted, minWidth: 120 }}>{label}</span>
    <span style={{ color: C.text, textAlign: 'right' }}>{value || '—'}</span>
  </div>
)

// Invoice preview component
function InvoicePreview({ job, client, onClose }) {
  const subtotal = job.lineItems?.reduce((s, l) => s + (l.total || l.quantity * l.unit_price), 0) || 0
  const tax = subtotal * 0.20 // 20% UK VAT
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim()

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000AA', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 48, width: 660, maxHeight: '90vh', overflowY: 'auto', color: '#111' }} onClick={e => e.stopPropagation()}>
        {/* Invoice header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a2e', letterSpacing: '-1px' }}>INVOICE</div>
            <div style={{ color: '#666', fontSize: 13, marginTop: 4 }}>{job.invoice_number || `INV-${job.job_number}`}</div>
            {job.invoice_sent_date && <div style={{ color: '#999', fontSize: 12, marginTop: 2 }}>Issued: {job.invoice_sent_date}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>MLC Services</div>
            <div style={{ color: '#666', fontSize: 13, marginTop: 2 }}>invoices@mlcservices.co.uk</div>
          </div>
        </div>

        {/* Bill to / job info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28, padding: '16px 0', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }}>
          <div>
            <div style={{ fontSize: 11, color: '#999', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Billed To</div>
            <div style={{ fontWeight: 600 }}>{clientName(client)}</div>
            {client?.billing_name && client.billing_name !== clientName(client) && <div style={{ color: '#666', fontSize: 13 }}>Attn: {client.billing_name}</div>}
            <div style={{ color: '#666', fontSize: 13 }}>{client?.billing_email || client?.email}</div>
            <div style={{ color: '#666', fontSize: 13 }}>{client?.billing_address || [client?.street_address, client?.city, client?.postcode].filter(Boolean).join(', ')}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#999', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job Details</div>
            <div style={{ fontWeight: 600 }}>{job.title}</div>
            <div style={{ color: '#666', fontSize: 13 }}>Ref: {job.job_number}</div>
            <div style={{ color: '#666', fontSize: 13 }}>Site: {job.site_address}</div>
            {job.completed_date && <div style={{ color: '#666', fontSize: 13 }}>Completed: {job.completed_date}</div>}
          </div>
        </div>

        {/* Line items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {['Description', 'Type', 'Qty', 'Unit Price', 'Total'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', borderBottom: '2px solid #eee', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(job.lineItems || []).map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 12px', fontSize: 14 }}>{item.description}</td>
                <td style={{ padding: '10px 12px', fontSize: 12, color: '#888', textAlign: 'right', textTransform: 'capitalize' }}>{item.item_type}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right' }}>{item.quantity} {item.unit}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right' }}>{fmt(item.unit_price)}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{fmt(item.total || item.quantity * item.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 260 }}>
            {[['Subtotal', fmt(subtotal)], ['VAT (20%)', fmt(tax)], ['Total Due', fmt(subtotal + tax)]].map(([label, val], i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: i === 2 ? '2px solid #111' : '1px solid #eee', fontWeight: i === 2 ? 700 : 400, fontSize: i === 2 ? 16 : 14 }}>
                <span style={{ color: i === 2 ? '#111' : '#666' }}>{label}</span>
                <span>{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 12, color: '#999', textAlign: 'center' }}>
          Payment due within 14 days. Thank you for your business. · MLC Services Ltd · NICEIC Registered
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Close</button>
          <button onClick={() => { alert('In the live app, this emails the invoice to the client.'); onClose() }}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#4F6EF7', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            ✉ Send Invoice
          </button>
        </div>
      </div>
    </div>
  )
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [job, setJob]           = useState(null)
  const [client, setClient]     = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [diary, setDiary]       = useState([])
  const [engineers, setEngineers] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showInvoice, setShowInvoice] = useState(false)

  const [diaryInput, setDiaryInput] = useState({ type: 'note', content: '' })

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchJob(), fetchDiary(), fetchEngineers()])
    setLoading(false)
  }

  async function fetchJob() {
    const { data } = await supabase
      .from('jobs')
      .select('*, clients(*), profiles(full_name), job_line_items(*)')
      .eq('id', id)
      .single()
    if (data) {
      setJob(data)
      setClient(data.clients)
      setLineItems(data.job_line_items || [])
    }
  }

  async function fetchDiary() {
    const { data } = await supabase
      .from('job_diary')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false })
    setDiary(data || [])
  }

  async function fetchEngineers() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('is_active', true)
    setEngineers(data || [])
  }

  async function updateStatus(status) {
    setSaving(true)
    const updates = {
      status,
      ...(status === 'Completed' && !job.completed_date ? { completed_date: new Date().toISOString().slice(0, 10) } : {}),
      ...(status === 'Invoiced' ? {
        invoice_number: job.invoice_number || `INV-${job.job_number}`,
        invoice_sent_date: new Date().toISOString().slice(0, 10),
        invoice_amount: lineItems.reduce((s, l) => s + (l.total || l.quantity * l.unit_price), 0),
      } : {}),
      ...(status === 'Paid' ? {
        payment_status: 'Paid',
        paid_date: new Date().toISOString().slice(0, 10),
        payment_amount: lineItems.reduce((s, l) => s + (l.total || l.quantity * l.unit_price), 0),
      } : {}),
    }

    await supabase.from('jobs').update(updates).eq('id', id)

    // Log to diary
    await supabase.from('job_diary').insert({
      job_id: id, author_id: profile.id, author_name: profile.full_name,
      entry_type: 'status_change', content: `Status changed to "${status}"`,
    })

    // Log to client activity
    if (job.client_id) {
      await supabase.from('client_activities').insert({
        client_id: job.client_id, rep_id: profile.id, rep_name: profile.full_name,
        type: status === 'Paid' ? 'payment_received' : status === 'Invoiced' ? 'invoice_sent' : 'status_change',
        content: `Job ${job.job_number}: status → ${status}`,
      })
    }

    setSaving(false)
    setJob(p => ({ ...p, ...updates }))
    await fetchDiary()

    // Sync client totals
    if (status === 'Paid' && job.client_id) {
      await supabase.rpc('sync_client_totals', { p_client_id: job.client_id })
    }

    showToast(`Status updated to ${status}`)
  }

  async function addDiaryEntry() {
    if (!diaryInput.content.trim()) return
    setSaving(true)
    await supabase.from('job_diary').insert({
      job_id: id, author_id: profile.id, author_name: profile.full_name,
      entry_type: diaryInput.type, content: diaryInput.content,
    })
    setSaving(false)
    setDiaryInput({ type: 'note', content: '' })
    await fetchDiary()
    showToast('Entry added ✓')
  }

  async function deleteJob() {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    await supabase.from('job_line_items').delete().eq('job_id', id)
    await supabase.from('job_diary').delete().eq('job_id', id)
    await supabase.from('jobs').delete().eq('id', id)
    navigate('/jobs')
    showToast('Job deleted')
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'
  const lineTotal = lineItems.reduce((s, l) => s + (l.total || (l.quantity * l.unit_price)), 0)

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading job…</div>
  if (!job) return <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Job not found.</div>

  const sm = STATUS_MAP[job.status] || { color: C.muted, bg: C.surface, icon: '?' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <Btn variant="ghost" small onClick={() => navigate('/jobs')}>← Jobs</Btn>
            <span style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{job.job_number}</span>
            <span style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>
              {sm.icon} {job.status}
            </span>
            <span style={{ color: { Low: C.dim, Medium: C.amber, High: C.red, Emergency: '#FF6B6B' }[job.priority], fontSize: 12, fontWeight: 600 }}>
              ● {job.priority}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>{job.title}</h1>
          {client && (
            <button onClick={() => navigate(`/clients/${job.client_id}`)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 14, marginTop: 4, padding: 0 }}>
              {clientName(client)} →
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {job.status === 'Completed' && (
            <>
              <Btn small variant="amber" onClick={() => updateStatus('Invoiced')} disabled={saving}>Generate Invoice</Btn>
              <Btn small variant="teal" onClick={() => setShowInvoice(true)}>Preview Invoice</Btn>
            </>
          )}
          {job.status === 'Invoiced' && (
            <>
              <Btn small variant="teal" onClick={() => setShowInvoice(true)}>View Invoice</Btn>
              <Btn small variant="success" onClick={() => updateStatus('Paid')} disabled={saving}>Mark as Paid ✓</Btn>
            </>
          )}
          {isAdmin && <Btn small variant="danger" onClick={deleteJob}>Delete Job</Btn>}
        </div>
      </div>

      {/* Lifecycle stepper */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Lifecycle — Click to advance</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
          {JOB_STATUSES.map((step, i) => {
            const isActive = job.status === step.key
            const statusOrder = JOB_STATUSES.map(s => s.key)
            const isDone = statusOrder.indexOf(job.status) > statusOrder.indexOf(step.key)
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <button
                  onClick={() => updateStatus(step.key)}
                  disabled={saving}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '8px 12px', background: isActive ? step.bg : isDone ? '#1C2A1C' : 'transparent',
                    border: `1px solid ${isActive ? step.color : isDone ? C.green + '44' : C.border}`,
                    borderRadius: 8, cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{step.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? step.color : isDone ? C.green : C.dim, whiteSpace: 'nowrap' }}>
                    {step.key}
                  </span>
                </button>
                {i < JOB_STATUSES.length - 1 && (
                  <div style={{ width: 24, height: 2, background: isDone ? C.green + '66' : C.border, flexShrink: 0 }} />
                )}
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 8 }}>
            <div style={{ width: 24, height: 2, background: C.border }} />
            <button onClick={() => updateStatus('Cancelled')} disabled={saving}
              style={{ padding: '8px 12px', background: job.status === 'Cancelled' ? C.redSoft : 'transparent', border: `1px solid ${C.red}44`, borderRadius: 8, cursor: 'pointer', color: C.red, fontSize: 12, fontWeight: 600 }}>
              ✕ Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Invoice status bar */}
      {['Invoiced','Paid'].includes(job.status) && (
        <div style={{ background: job.status === 'Paid' ? C.greenSoft : C.amberSoft, border: `1px solid ${job.status === 'Paid' ? C.green : C.amber}44`, borderRadius: 10, padding: '12px 18px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: job.status === 'Paid' ? C.green : C.amber, fontWeight: 600 }}>
            {job.status === 'Paid' ? `💰 Paid on ${job.paid_date}` : `🧾 Invoice ${job.invoice_number} · Sent ${job.invoice_sent_date}`}
          </span>
          <span style={{ color: job.status === 'Paid' ? C.green : C.amber, fontWeight: 700, fontSize: 18 }}>
            {fmt(job.invoice_amount)}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* LEFT */}
        <div>
          {/* Job details */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Details</div>
            <InfoRow label="Client"      value={<button onClick={() => navigate(`/clients/${job.client_id}`)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, fontSize: 14 }}>{clientName(client)}</button>} />
            <InfoRow label="Engineer"    value={job.profiles?.full_name} />
            <InfoRow label="Job Type"    value={job.job_type} />
            <InfoRow label="Services"    value={job.service_types?.join(', ')} />
            <InfoRow label="Scheduled"   value={job.scheduled_date ? `${job.scheduled_date} · ${job.scheduled_slot || ''}` : null} />
            <InfoRow label="Completed"   value={job.completed_date} />
          </div>

          {/* Site / access */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Site & Access</div>
            <InfoRow label="Site Address" value={job.site_address} />
            <InfoRow label="Postcode"     value={job.site_postcode} />
            <InfoRow label="Tenant Name"  value={job.tenant_name} />
            <InfoRow label="Tenant Phone" value={job.tenant_phone} />
            {job.access_notes && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: C.amberSoft, borderRadius: 8, fontSize: 13, color: C.amber, lineHeight: 1.6 }}>
                ⚠ {job.access_notes}
              </div>
            )}
          </div>

          {/* Description */}
          {job.description && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Description</div>
              <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, margin: 0 }}>{job.description}</p>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div>
          {/* Line items */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Line Items
            </div>
            {lineItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>No line items added.</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Description', 'Qty', 'Price', 'Total'].map(h => (
                        <th key={h} style={{ textAlign: h === 'Description' ? 'left' : 'right', padding: '8px 14px', color: C.dim, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, i) => (
                      <tr key={item.id || i}>
                        <td style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}18` }}>
                          <div style={{ fontSize: 13 }}>{item.description}</div>
                          <div style={{ fontSize: 11, color: C.dim, textTransform: 'capitalize' }}>{item.item_type}</div>
                        </td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', color: C.muted, fontSize: 13, borderBottom: `1px solid ${C.border}18` }}>{item.quantity} {item.unit}</td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', color: C.muted, fontSize: 13, borderBottom: `1px solid ${C.border}18` }}>{fmt(item.unit_price)}</td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', color: C.accent, fontWeight: 600, borderBottom: `1px solid ${C.border}18` }}>{fmt(item.total || item.quantity * item.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.border}` }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Total (ex. VAT)</span>
                  <span style={{ color: C.accent, fontWeight: 700, fontSize: 20 }}>{fmt(lineTotal)}</span>
                </div>
              </>
            )}
          </div>

          {/* Job diary */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Diary</div>

            {/* Input */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={diaryInput.type} onChange={e => setDiaryInput(p => ({ ...p, type: e.target.value }))}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 10px', fontSize: 13 }}>
                  <option value="note">📝 Note</option>
                  <option value="call">📞 Call</option>
                  <option value="email">✉️ Email</option>
                  <option value="whatsapp">💬 WhatsApp</option>
                </select>
                <input
                  value={diaryInput.content}
                  onChange={e => setDiaryInput(p => ({ ...p, content: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addDiaryEntry()}
                  placeholder="Add a diary entry…"
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }}
                />
              </div>
              <Btn small onClick={addDiaryEntry} disabled={saving || !diaryInput.content.trim()}>
                {saving ? 'Saving…' : 'Add Entry'}
              </Btn>
            </div>

            {/* Diary entries */}
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {diary.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No entries yet.</div>}
              {diary.map((entry, i) => (
                <div key={entry.id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}18` }}>
                  <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{DIARY_ICONS[entry.entry_type] || '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{entry.content}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {entry.author_name} · {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Invoice modal */}
      {showInvoice && (
        <InvoicePreview
          job={{ ...job, lineItems }}
          client={client}
          onClose={() => setShowInvoice(false)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
