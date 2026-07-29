import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import EmailCompose from '../components/EmailCompose'

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

const JOB_STATUSES = ['New', 'In Progress', 'Confirmed', 'Completed', 'Declined']
const STATUS_STYLE = {
  'New':         { color: '#6B7280', bg: '#F5F7FA' },
  'In Progress': { color: '#0284C7', bg: '#DBEAFE' },
  'Confirmed':   { color: C.accent,    bg: C.accentSoft },
  'Completed':   { color: C.greenDark, bg: C.greenSoft },
  'Declined':    { color: C.red,       bg: C.redSoft },
}
const CERT_STATUSES = ['Not Issued', 'Issued', 'Delivered', 'Passed', 'Failed']
const PAYMENT_STATUSES = ['Paid', 'Unpaid', 'Partial']
const DIARY_ICONS = { note: '📝', call: '📞', email: '✉️', whatsapp: '💬', status_change: '🔄', system: '⚙️' }

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    amber:   { background: C.amberSoft,  color: C.amber,     border: `1px solid ${C.amber}66` },
    teal:    { background: C.tealSoft,   color: C.teal,      border: `1px solid ${C.teal}66` },
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

const InfoRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
    <span style={{ color: C.muted, minWidth: 130 }}>{label}</span>
    <span style={{ color: C.text, textAlign: 'right' }}>{value || '—'}</span>
  </div>
)

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile, isAdmin } = useAuth()
  const { toast, showToast } = useToast()

  const [job, setJob]             = useState(null)
  const [client, setClient]       = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [diary, setDiary]         = useState([])
  const [engineers, setEngineers] = useState([])
  const [files, setFiles]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox]   = useState(null)
  const [editEngineer, setEditEngineer] = useState(false)
  const [editRemarks, setEditRemarks]   = useState(false)
  const [remarksText, setRemarksText]   = useState('')
  const [diaryInput, setDiaryInput]     = useState({ type: 'note', content: '' })
  const [editingClient, setEditingClient]         = useState(false)
  const [allClients, setAllClients]               = useState([])
  const [showEmailCompose, setShowEmailCompose]   = useState(false)

  const certRef  = useRef()
  const photoRef = useRef()

  useEffect(() => { if (id) fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchJob(), fetchDiary(), fetchEngineers(), fetchFiles()])
    setLoading(false)
  }

  async function fetchJob() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*, clients(id, first_name, last_name, company_name, email, phone, street_address), profiles!jobs_assigned_to_fkey(id, full_name), job_line_items(*), job_diary(*), job_files(*)')
      .eq('id', id)
      .single()
    if (error) {
      console.error('JobDetail fetch error:', error, 'ID:', id)
      setJob(null)
    } else {
      console.log('Job loaded:', data?.job_number)
      setJob(data)
      setClient(data.clients)
      setLineItems(data.job_line_items || [])
      setRemarksText(data.engineer_remarks || '')
    }

    const { data: clientsData } = await supabase.from('clients').select('id, first_name, last_name, company_name').eq('is_active', true).order('company_name')
    setAllClients(clientsData || [])
  }

  async function saveField(field, value) {
    await supabase.from('jobs').update({ [field]: value }).eq('id', id)
    setJob(p => ({ ...p, [field]: value }))
    showToast('Saved ✓')
  }

  async function fetchDiary() {
    const { data } = await supabase.from('job_diary').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setDiary(data || [])
  }

  async function fetchEngineers() {
    const { data } = await supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
    setEngineers(data || [])
  }

  async function fetchFiles() {
    const { data } = await supabase.from('job_files').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setFiles(data || [])
  }

  // ── Upload certificates ──────────────────────────────────────
  async function uploadCertificates(e) {
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    setUploading(true)
    for (const file of selected) {
      const path = `jobs/${id}/certificates/${Date.now()}_${file.name}`
      const { error } = await supabase.storage.from('job-files').upload(path, file)
      if (error) { showToast(`Failed: ${file.name}`, 'error'); continue }
      await supabase.from('job_files').insert({
        job_id: id, uploaded_by: profile.id, uploader_name: profile.full_name,
        file_type: 'certificate', file_name: file.name,
        storage_path: path, file_size: file.size, mime_type: file.type,
      })
    }
    setUploading(false)
    await fetchFiles()
    showToast(`${selected.length} certificate(s) uploaded ✓`)
    certRef.current.value = ''
  }

  // ── Upload photos ────────────────────────────────────────────
  async function uploadPhotos(e) {
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    const currentPhotos = files.filter(f => f.file_type === 'photo').length
    if (currentPhotos + selected.length > 50) {
      showToast(`Max 50 photos. You have ${currentPhotos} already.`, 'error'); return
    }
    setUploading(true)
    let uploaded = 0
    for (const file of selected) {
      const path = `jobs/${id}/photos/${Date.now()}_${file.name}`
      const { error } = await supabase.storage.from('job-files').upload(path, file)
      if (error) { showToast(`Failed: ${file.name}`, 'error'); continue }
      await supabase.from('job_files').insert({
        job_id: id, uploaded_by: profile.id, uploader_name: profile.full_name,
        file_type: 'photo', file_name: file.name,
        storage_path: path, file_size: file.size, mime_type: file.type,
      })
      uploaded++
    }
    setUploading(false)
    await fetchFiles()
    showToast(`${uploaded} photo(s) uploaded ✓`)
    photoRef.current.value = ''
  }

  function getFileUrl(path) {
    const { data } = supabase.storage.from('job-files').getPublicUrl(path)
    return data.publicUrl
  }

  async function deleteFile(file) {
    if (!window.confirm(`Delete "${file.file_name}"?`)) return
    await supabase.storage.from('job-files').remove([file.storage_path])
    await supabase.from('job_files').delete().eq('id', file.id)
    setFiles(p => p.filter(f => f.id !== file.id))
    showToast('File deleted')
  }

  // ── Update engineer ──────────────────────────────────────────
  async function updateEngineer(engineerId) {
    await supabase.from('jobs').update({ assigned_to: engineerId }).eq('id', id)
    const eng = engineers.find(e => e.id === engineerId)
    setJob(p => ({ ...p, assigned_to: engineerId, profiles: eng }))
    setEditEngineer(false)
    showToast('Engineer updated ✓')
  }

  // ── Save engineer remarks ────────────────────────────────────
  async function saveRemarks() {
    setSaving(true)
    await supabase.from('jobs').update({ engineer_remarks: remarksText }).eq('id', id)
    setJob(p => ({ ...p, engineer_remarks: remarksText }))
    setSaving(false)
    setEditRemarks(false)
    showToast('Remarks saved ✓')
  }

  // ── Update status ────────────────────────────────────────────
  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('jobs').update({ status }).eq('id', id)
    await supabase.from('job_diary').insert({ job_id: id, author_id: profile.id, author_name: profile.full_name, entry_type: 'status_change', content: `Status changed to "${status}"` })
    setSaving(false)
    setJob(p => ({ ...p, status }))
    await fetchDiary()
    showToast(`Status → ${status}`)
  }

  // ── Diary entry ──────────────────────────────────────────────
  async function addDiaryEntry() {
    if (!diaryInput.content.trim()) return
    setSaving(true)
    await supabase.from('job_diary').insert({ job_id: id, author_id: profile.id, author_name: profile.full_name, entry_type: diaryInput.type, content: diaryInput.content })
    setSaving(false)
    setDiaryInput({ type: 'note', content: '' })
    await fetchDiary()
    showToast('Entry added ✓')
  }

  async function deleteJob() {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    await supabase.from('job_files').delete().eq('job_id', id)
    await supabase.from('job_line_items').delete().eq('job_id', id)
    await supabase.from('job_diary').delete().eq('job_id', id)
    await supabase.from('jobs').delete().eq('id', id)
    navigate('/jobs')
    showToast('Job deleted')
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'
  const lineTotal = lineItems.reduce((s, l) => s + (l.total || l.quantity * l.unit_price), 0)
  const certificates = files.filter(f => f.file_type === 'certificate')
  const photos       = files.filter(f => f.file_type === 'photo')
  const fmtSize = b => b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading job…</div>
  if (!job)    return <div style={{ color: C.red,   padding: 40, textAlign: 'center' }}>Job not found.</div>

  const sm = STATUS_STYLE[job.status] || { color: C.muted, bg: C.surface }

  return (
    <div>
      {/* Hidden inputs */}
      <input ref={certRef}  type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={uploadCertificates} />
      <input ref={photoRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={uploadPhotos} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Btn variant="ghost" small onClick={() => navigate('/jobs')}>← Jobs</Btn>
            <span style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{job.job_number}</span>
            <span style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>
              {job.status}
            </span>
            <span style={{ color: { Low: C.dim, Medium: C.amber, High: C.red }[job.priority] || C.muted, fontSize: 12, fontWeight: 600 }}>● {job.priority}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{job.title}</h1>
          {editingClient ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <select value={job.client_id || ''} onChange={async e => {
                const newId = e.target.value || null
                await supabase.from('jobs').update({ client_id: newId }).eq('id', id)
                setJob(p => ({ ...p, client_id: newId }))
                setClient(allClients.find(c => c.id === newId) || null)
                setEditingClient(false)
                showToast('Client updated ✓')
              }} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '6px 10px', fontSize: 13, minWidth: 200 }}>
                <option value="">— No client —</option>
                {allClients.map(c => <option key={c.id} value={c.id}>{c.company_name || c.first_name + ' ' + (c.last_name || '')}</option>)}
              </select>
              <button onClick={() => setEditingClient(false)} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 600, color: C.accent }}>{clientName(client)}</span>
              <button onClick={() => setEditingClient(true)} style={{ background: '#E6F4FC', color: '#0093DB', border: '1px solid #0093DB44', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>Change</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => navigate('/invoices/new', { state: { job } })}
            style={{ background: '#F0FAE0', color: '#3d7a00', border: '1px solid #80D10066', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            🧾 Generate Invoice
          </button>
          <button onClick={() => setShowEmailCompose(true)}
            style={{ background: '#E6F4FC', color: '#0093DB', border: '1px solid #0093DB44', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ✉ Send Email
          </button>
          {isAdmin && <Btn small variant="danger" onClick={deleteJob}>Delete</Btn>}
        </div>
      </div>

      {/* Status */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Job Status</div>
        <select value={job.status} disabled={saving} onChange={e => updateStatus(e.target.value)}
          style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44`, borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Job details */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Details</div>
            <InfoRow label="Client"    value={client ? <button onClick={() => navigate(`/clients/${job.client_id}`)} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, fontSize: 14 }}>{clientName(client)}</button> : null} />
            <InfoRow label="Services"  value={job.service_types?.join(', ')} />
            <InfoRow label="Scheduled" value={job.scheduled_date ? `${job.scheduled_date}${job.scheduled_slot ? ` · ${job.scheduled_slot}` : ''}` : null} />
            <InfoRow label="Completed" value={job.completed_date} />

            {/* Engineer — editable */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
              <span style={{ color: C.muted, minWidth: 130 }}>Engineer</span>
              {editEngineer ? (
                <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                  <select defaultValue={job.assigned_to || ''} onChange={e => updateEngineer(e.target.value)}
                    style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '5px 10px', fontSize: 13, flex: 1, maxWidth: 200 }}>
                    <option value="">— Unassigned —</option>
                    {engineers.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.role})</option>)}
                  </select>
                  <button onClick={() => setEditEngineer(false)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: C.text }}>{job.profiles?.full_name || <span style={{ color: C.dim }}>Unassigned</span>}</span>
                  <button onClick={() => setEditEngineer(true)}
                    style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                    {job.profiles ? 'Change' : 'Assign'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Job Tracking */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Tracking</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Engineer Name</label>
                <input defaultValue={job.engineer_name || job.profiles?.full_name || ''} onBlur={e => saveField('engineer_name', e.target.value)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Engineer Paid (£)</label>
                <input type="number" defaultValue={job.engineer_paid_amount || ''} onBlur={e => saveField('engineer_paid_amount', Number(e.target.value) || 0)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Work Done</label>
                <input defaultValue={job.work_done || ''} onBlur={e => saveField('work_done', e.target.value)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Amount Received (£)</label>
                <input type="number" defaultValue={job.amount_received || ''} onBlur={e => saveField('amount_received', Number(e.target.value) || 0)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }} />
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Payment Status</label>
                <select value={job.payment_status || ''} onChange={e => saveField('payment_status', e.target.value)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }}>
                  <option value="">—</option>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Certificate Status</label>
                <select value={job.certificate_status || ''} onChange={e => saveField('certificate_status', e.target.value)}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 10px', fontSize: 13, width: '100%' }}>
                  <option value="">—</option>
                  {CERT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                <input type="checkbox" checked={!!job.certificate_sent} onChange={e => saveField('certificate_sent', e.target.checked)} id="certificate_sent" />
                <label htmlFor="certificate_sent" style={{ color: C.text, fontSize: 13, cursor: 'pointer' }}>Certificate Sent</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                <input type="checkbox" checked={!!job.remedial_quotation_sent} onChange={e => saveField('remedial_quotation_sent', e.target.checked)} id="remedial_quotation_sent" />
                <label htmlFor="remedial_quotation_sent" style={{ color: C.text, fontSize: 13, cursor: 'pointer' }}>Remedial Quotation Sent</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!job.google_review_requested} onChange={e => saveField('google_review_requested', e.target.checked)} id="google_review_requested" />
                <label htmlFor="google_review_requested" style={{ color: C.text, fontSize: 13, cursor: 'pointer' }}>Google Review Requested</label>
              </div>
            </div>
          </div>

          {/* Site & Access */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Site & Access</div>
            <InfoRow label="Site Address" value={job.site_address} />
            <InfoRow label="Postcode"     value={job.site_postcode} />
            <InfoRow label="Tenant Name"  value={job.tenant_name} />
            <InfoRow label="Tenant Phone" value={job.tenant_phone} />
            {job.access_notes && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 8, fontSize: 13, color: C.amber, fontWeight: 600 }}>
                ⚠ {job.access_notes}
              </div>
            )}
          </div>

          {/* Engineer Remarks */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Engineer Remarks</div>
              {!editRemarks && (
                <button onClick={() => setEditRemarks(true)}
                  style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  {job.engineer_remarks ? 'Edit' : 'Add Remarks'}
                </button>
              )}
            </div>
            {editRemarks ? (
              <div>
                <textarea value={remarksText} onChange={e => setRemarksText(e.target.value)} rows={4}
                  placeholder="Enter engineer remarks, findings, notes about the job…"
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '10px 12px', fontSize: 13, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Btn small onClick={saveRemarks} disabled={saving}>{saving ? 'Saving…' : 'Save Remarks'}</Btn>
                  <Btn small variant="ghost" onClick={() => { setEditRemarks(false); setRemarksText(job.engineer_remarks || '') }}>Cancel</Btn>
                </div>
              </div>
            ) : job.engineer_remarks ? (
              <p style={{ color: C.text, fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{job.engineer_remarks}</p>
            ) : (
              <p style={{ color: C.dim, fontSize: 13, margin: 0 }}>No remarks added yet.</p>
            )}
          </div>

          {/* Certificates */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Certificates ({certificates.length})
              </div>
              <Btn small variant="success" onClick={() => certRef.current.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : '+ Attach'}
              </Btn>
            </div>
            {certificates.length === 0 ? (
              <div onClick={() => certRef.current.click()} style={{ border: `2px dashed ${C.border}`, borderRadius: 10, padding: 24, textAlign: 'center', cursor: 'pointer', color: C.dim, fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
                Click to attach certificates (PDF, JPG, PNG)
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {certificates.map(cert => (
                  <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: C.greenSoft, border: `1px solid ${C.green}44`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>{cert.mime_type === 'application/pdf' ? '📋' : '🖼'}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cert.file_name}</div>
                        <div style={{ fontSize: 11, color: C.dim }}>{cert.uploader_name} · {fmtSize(cert.file_size || 0)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a href={getFileUrl(cert.storage_path)} target="_blank" rel="noreferrer"
                        style={{ background: C.accent, color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>Open</a>
                      <button onClick={() => deleteFile(cert)}
                        style={{ background: C.redSoft, color: C.red, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>✕</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => certRef.current.click()}
                  style={{ background: 'none', border: `1px dashed ${C.border}`, borderRadius: 8, padding: '8px', color: C.dim, fontSize: 12, cursor: 'pointer' }}>
                  + Add more certificates
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Line items */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Line Items</div>
            {lineItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.dim, fontSize: 13 }}>No line items.</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {['Description','Qty','Price','Total'].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 14px', color: C.dim, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, background: C.surface }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{lineItems.map((item, i) => (
                    <tr key={item.id || i}>
                      <td style={{ padding: '9px 14px', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: 13, color: C.text }}>{item.description}</div>
                        <div style={{ fontSize: 11, color: C.dim, textTransform: 'capitalize' }}>{item.item_type}</div>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: C.muted, fontSize: 13, borderBottom: `1px solid ${C.border}` }}>{item.quantity} {item.unit}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: C.muted, fontSize: 13, borderBottom: `1px solid ${C.border}` }}>{fmt(item.unit_price)}</td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: C.accent, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{fmt(item.total || item.quantity * item.unit_price)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: C.muted, fontSize: 13 }}>Total (ex. VAT)</span>
                  <span style={{ color: C.accent, fontWeight: 800, fontSize: 20 }}>{fmt(lineTotal)}</span>
                </div>
              </>
            )}
          </div>

          {/* Job Diary */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Diary</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select value={diaryInput.type} onChange={e => setDiaryInput(p => ({ ...p, type: e.target.value }))}
                style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 10px', fontSize: 13 }}>
                <option value="note">📝 Note</option>
                <option value="call">📞 Call</option>
                <option value="email">✉️ Email</option>
                <option value="whatsapp">💬 WhatsApp</option>
              </select>
              <input value={diaryInput.content} onChange={e => setDiaryInput(p => ({ ...p, content: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addDiaryEntry()}
                placeholder="Add diary entry…"
                style={{ flex: 1, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }} />
            </div>
            <Btn small onClick={addDiaryEntry} disabled={saving || !diaryInput.content.trim()}>Add Entry</Btn>
            <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 14 }}>
              {diary.length === 0 && <div style={{ color: C.dim, fontSize: 13 }}>No entries yet.</div>}
              {diary.map((entry, i) => (
                <div key={entry.id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>{DIARY_ICONS[entry.entry_type] || '📝'}</span>
                  <div>
                    <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{entry.content}</div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{entry.author_name} · {new Date(entry.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Photo Gallery */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginTop: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Site Photos ({photos.length}/50)</div>
            {photos.length >= 50 && <div style={{ color: C.red, fontSize: 12, marginTop: 2 }}>Maximum 50 photos reached</div>}
          </div>
          <Btn small variant="amber" onClick={() => photoRef.current.click()} disabled={uploading || photos.length >= 50}>
            {uploading ? 'Uploading…' : '📷 Add Photos'}
          </Btn>
        </div>

        {photos.length === 0 ? (
          <div onClick={() => photoRef.current.click()}
            style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', color: C.dim }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Add site photos</div>
            <div style={{ fontSize: 12 }}>Up to 50 photos per job</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {photos.map(photo => (
              <div key={photo.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <img src={getFileUrl(photo.storage_path)} alt={photo.file_name} onClick={() => setLightbox(getFileUrl(photo.storage_path))}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button onClick={e => { e.stopPropagation(); deleteFile(photo) }}
                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(220,38,38,0.85)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            ))}
            {photos.length < 50 && (
              <div onClick={() => photoRef.current.click()}
                style={{ aspectRatio: '1', borderRadius: 8, border: `2px dashed ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.dim, fontSize: 12, gap: 4 }}>
                <span style={{ fontSize: 24 }}>+</span><span>Add more</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000EE', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400 }}
          onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer' }}>✕</button>
          <a href={lightbox} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>
            ↗ Full size
          </a>
          <img src={lightbox} alt="" onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }} />
        </div>
      )}

      {showEmailCompose && job.clients && (
        <EmailCompose
          context={{
            clientId: job.client_id,
            jobId: job.id,
            toEmail: job.clients.email,
            toName: job.clients.company_name || job.clients.first_name,
            name: job.clients.company_name || job.clients.first_name,
            address: job.site_address,
            services: (job.service_types || []).join(', '),
            repName: profile?.full_name,
            scheduledDate: job.scheduled_date,
          }}
          onClose={() => setShowEmailCompose(false)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
