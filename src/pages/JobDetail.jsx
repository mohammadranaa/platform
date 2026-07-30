import { useState, useEffect } from 'react'
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
const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const lbl = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

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
  const [savingItems, setSavingItems] = useState(false)
  const [diary, setDiary]         = useState([])
  const [files, setFiles]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editRemarks, setEditRemarks]   = useState(false)
  const [remarksText, setRemarksText]   = useState('')
  const [diaryInput, setDiaryInput]     = useState({ type: 'note', content: '' })
  const [editingClient, setEditingClient]         = useState(false)
  const [allClients, setAllClients]               = useState([])
  const [allProfiles, setAllProfiles]             = useState([])
  const [showEmailCompose, setShowEmailCompose]   = useState(false)

  useEffect(() => { if (id) fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchJob(), fetchDiary(), fetchFiles()])
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
      setRemarksText(data.engineer_remarks || '')
    }

    const [{ data: clientsData }, { data: profilesData }] = await Promise.all([
      supabase.from('clients').select('id, first_name, last_name, company_name').eq('is_active', true).order('company_name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true)
    ])
    setAllClients(clientsData || [])
    setAllProfiles(profilesData || [])

    const { data: items } = await supabase.from('job_line_items').select('*').eq('job_id', id).order('created_at')
    setLineItems(items || [])
  }

  async function saveField(field, value) {
    const { error } = await supabase.from('jobs').update({ [field]: value }).eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setJob(prev => ({ ...prev, [field]: value }))
    showToast('Saved ✓')
  }

  async function fetchDiary() {
    const { data } = await supabase.from('job_diary').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setDiary(data || [])
  }

  async function fetchFiles() {
    const { data } = await supabase.from('job_files').select('*').eq('job_id', id).order('created_at', { ascending: false })
    setFiles(data || [])
  }

  // ── Upload a file (certificate, photo, or video) ───────────────
  async function uploadFile(file, fileType = 'certificate') {
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${id}/${fileType}_${Date.now()}.${ext}`

    const { error } = await supabase.storage
      .from('job-files')
      .upload(path, file, { cacheControl: '3600', upsert: false })

    if (error) {
      console.error('Upload error:', error)
      showToast('Upload failed: ' + error.message, 'error')
      setUploading(false)
      return
    }

    // job_files schema uses storage_path (not file_url) — URL is computed on read via getFileUrl()
    await supabase.from('job_files').insert({
      job_id: id,
      file_name: file.name,
      storage_path: path,
      file_type: fileType,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: profile?.id,
      uploader_name: profile?.full_name,
    })

    setUploading(false)
    showToast('File uploaded ✓')
    await fetchFiles()
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

  if (loading) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading job…</div>
  if (!job)    return <div style={{ color: C.red,   padding: 40, textAlign: 'center' }}>Job not found.</div>

  const sm = STATUS_STYLE[job.status] || { color: C.muted, bg: C.surface }

  return (
    <div>
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
                await saveField('client_id', newId)
                setEditingClient(false)
                await fetchJob()
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
          {isAdmin && <Btn small variant="danger" onClick={deleteJob}>Delete</Btn>}
        </div>
      </div>

      {/* Status */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Job Status</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={job.status} disabled={saving} onChange={e => updateStatus(e.target.value)}
            style={{ background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44`, borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => navigate('/invoices/new', { state: { job: { ...job, line_items: lineItems } } })}
            style={{ background: '#F0FAE0', color: '#3d7a00', border: '1px solid #80D10066', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            🧾 Generate Invoice
          </button>
          <button onClick={() => {
            const clientEmail = job.clients?.email || ''
            const clientNameVal = job.clients?.company_name || (job.clients?.first_name + ' ' + (job.clients?.last_name||'')).trim() || 'Customer'
            const total = lineItems.reduce((s,l) => s + (l.quantity||1) * (l.unit_price||0), 0).toFixed(2)

            navigate('/invoices/new', { state: {
              job: { ...job, line_items: lineItems },
              autoSend: true,
              prefillEmail: clientEmail,
              prefillName: clientNameVal,
              prefillTotal: total,
            }})
          }}
            style={{ background: '#0093DB', color: '#fff', border: '1px solid #0093DB44', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            📧 Send Invoice
          </button>
          <button onClick={() => setShowEmailCompose(true)}
            style={{ background: '#E6F4FC', color: '#0093DB', border: '1px solid #0093DB44', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ✉ Send Email
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Job details */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20, marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:16 }}>Job Details</div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              {/* Title */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Job Title</label>
                <input value={job.title || ''}
                  onChange={e => setJob(p=>({...p, title: e.target.value}))}
                  onBlur={e => saveField('title', e.target.value)}
                  style={inp} />
              </div>

              {/* Client - with Change button */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Client</label>
                {editingClient ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <select value={job.client_id || ''} onChange={async e => {
                      await saveField('client_id', e.target.value || null)
                      setEditingClient(false)
                      fetchJob()
                    }} style={{...inp, flex:1}}>
                      <option value="">— No client —</option>
                      {allClients.map(c => <option key={c.id} value={c.id}>{c.company_name || (c.first_name + ' ' + (c.last_name||'')).trim()}</option>)}
                    </select>
                    <button onClick={() => setEditingClient(false)} style={{ background:'none', border:'none', color:'#9CA3AF', cursor:'pointer', fontSize:18 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0' }}>
                    <span style={{ fontWeight:600, color:'#0093DB', cursor:'pointer' }}
                      onClick={() => job.client_id && navigate('/clients/' + job.client_id)}>
                      {job.clients?.company_name || (job.clients?.first_name + ' ' + (job.clients?.last_name||'')).trim() || '— No client —'}
                    </span>
                    <button onClick={() => setEditingClient(true)}
                      style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'2px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
                      Change
                    </button>
                  </div>
                )}
              </div>

              {/* Services */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Services</label>
                <input value={(job.service_types || []).join(', ')}
                  onChange={e => setJob(p=>({...p, service_types: e.target.value.split(',').map(s=>s.trim()).filter(Boolean)}))}
                  onBlur={e => saveField('service_types', e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}
                  placeholder="e.g. EICR, FRA, GSC"
                  style={inp} />
              </div>

              {/* Detail of Service */}
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Detail of Service</label>
                <input value={job.detail_of_service || ''}
                  onChange={e => setJob(p=>({...p, detail_of_service: e.target.value}))}
                  onBlur={e => saveField('detail_of_service', e.target.value)}
                  style={inp} />
              </div>

              {/* Scheduled Date */}
              <div>
                <label style={lbl}>Scheduled Date</label>
                <input type="date" value={job.scheduled_date || ''}
                  onChange={e => { setJob(p=>({...p, scheduled_date: e.target.value})); saveField('scheduled_date', e.target.value || null) }}
                  style={inp} />
              </div>

              {/* Time Slot */}
              <div>
                <label style={lbl}>Time Slot</label>
                <select value={job.scheduled_slot || ''}
                  onChange={e => { setJob(p=>({...p, scheduled_slot: e.target.value})); saveField('scheduled_slot', e.target.value) }}
                  style={inp}>
                  <option value="">—</option>
                  <option>Morning (8am–12pm)</option>
                  <option>Afternoon (12pm–6pm)</option>
                </select>
              </div>

              {/* Assigned BDL - SEPARATE from Engineer */}
              <div>
                <label style={lbl}>Assigned BDL</label>
                <select value={job.assigned_to || ''}
                  onChange={e => { saveField('assigned_to', e.target.value || null); fetchJob() }}
                  style={inp}>
                  <option value="">— Unassigned —</option>
                  {allProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>

              {/* Job Type */}
              <div>
                <label style={lbl}>Type</label>
                <select value={job.job_source_type || 'inbound'}
                  onChange={e => saveField('job_source_type', e.target.value)}
                  style={inp}>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </div>
            </div>
          </div>

          {/* Job Tracking */}
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Job Tracking</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Engineer Name</label>
                <input value={job.engineer_name || ''}
                  onChange={e => setJob(p=>({...p, engineer_name: e.target.value}))}
                  onBlur={e => saveField('engineer_name', e.target.value)}
                  placeholder="Name of the engineer who did the work"
                  style={inp} />
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

              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Certificate Link (external)</label>
                <input value={job.certificate_file_url || ''}
                  onChange={e => setJob(p=>({...p, certificate_file_url: e.target.value}))}
                  onBlur={e => saveField('certificate_file_url', e.target.value)}
                  placeholder="Paste Google Drive or external link…"
                  style={inp} />
                {job.certificate_file_url && (
                  <a href={job.certificate_file_url.startsWith('http') ? job.certificate_file_url : 'https://' + job.certificate_file_url}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize:12, color:'#0093DB', marginTop:4, display:'inline-block' }}>
                    Open link →
                  </a>
                )}
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

          {/* Files & Certificates */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20, marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                Files & Certificates ({files.length})
              </span>
              <div style={{ display:'flex', gap:6 }}>
                <label style={{ background:'#F0FAE0', color:'#3d7a00', border:'1px solid #80D10066', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                  📜 Certificate
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden
                    onChange={e => e.target.files[0] && uploadFile(e.target.files[0], 'certificate')} />
                </label>
                <label style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                  📷 Photo
                  <input type="file" accept="image/*" hidden multiple
                    onChange={e => Array.from(e.target.files).forEach(f => uploadFile(f, 'photo'))} />
                </label>
                <label style={{ background:'#EDE9FE', color:'#7C3AED', border:'1px solid #7C3AED44', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                  🎥 Video
                  <input type="file" accept="video/*" hidden
                    onChange={e => e.target.files[0] && uploadFile(e.target.files[0], 'video')} />
                </label>
              </div>
            </div>

            {files.length === 0 ? (
              <div style={{ color:'#9CA3AF', fontSize:13, padding:'20px 0', textAlign:'center', border:'2px dashed #E5E7EB', borderRadius:8 }}>
                No files attached yet. Upload certificates, photos or videos above.
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:10 }}>
                {files.map(f => {
                  const url = getFileUrl(f.storage_path)
                  return (
                    <div key={f.id} style={{ border:'1px solid #E5E7EB', borderRadius:8, overflow:'hidden', background:'#FAFBFC' }}>
                      {f.file_type === 'photo' ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt={f.file_name}
                            style={{ width:'100%', height:100, objectFit:'cover' }} />
                        </a>
                      ) : f.file_type === 'video' ? (
                        <video src={url} controls style={{ width:'100%', height:100 }} />
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer"
                          style={{ display:'flex', alignItems:'center', justifyContent:'center', height:80, color:'#0093DB', fontSize:28 }}>
                          📄
                        </a>
                      )}
                      <div style={{ padding:'6px 8px' }}>
                        <div style={{ fontSize:11, color:'#1F2937', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.file_name}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
                          <span style={{ fontSize:10, color:'#9CA3AF' }}>
                            {f.file_type === 'certificate' ? '📜' : f.file_type === 'photo' ? '📷' : '🎥'} {f.file_type}
                          </span>
                          <button onClick={() => deleteFile(f)}
                            style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontSize:12 }}>✕</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Line items */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20, marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.06em' }}>Line Items</span>
              <button onClick={() => setLineItems(p => [...p, { id: 'new_' + Date.now(), description:'', quantity:1, unit:'ea', unit_price:0, item_type:'certificate' }])}
                style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                + Add Item
              </button>
            </div>

            {lineItems.length === 0 ? (
              <div style={{ color:'#9CA3AF', fontSize:13, padding:'16px 0', textAlign:'center' }}>No line items. Click + Add Item to start.</div>
            ) : (
              <>
                {lineItems.map((item, idx) => (
                  <div key={item.id} style={{ display:'grid', gridTemplateColumns:'2fr 60px 80px 28px', gap:6, marginBottom:8, alignItems:'center' }}>
                    <input value={item.description || ''}
                      onChange={e => setLineItems(p => p.map((li,i) => i===idx ? {...li, description:e.target.value} : li))}
                      placeholder="Description"
                      style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'6px 10px', fontSize:12 }} />
                    <input type="number" value={item.quantity || 1}
                      onChange={e => setLineItems(p => p.map((li,i) => i===idx ? {...li, quantity:parseInt(e.target.value)||1} : li))}
                      style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'6px 8px', fontSize:12, textAlign:'center' }} />
                    <input type="number" step="0.01" value={item.unit_price || ''}
                      onChange={e => setLineItems(p => p.map((li,i) => i===idx ? {...li, unit_price:parseFloat(e.target.value)||0} : li))}
                      placeholder="£"
                      style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'6px 8px', fontSize:12 }} />
                    <button onClick={() => setLineItems(p => p.filter((_,i) => i!==idx))}
                      style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontSize:16 }}>✕</button>
                  </div>
                ))}

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:12, paddingTop:12, borderTop:'1px solid #E5E7EB' }}>
                  <span style={{ fontSize:15, fontWeight:800, color:'#0093DB' }}>
                    Total: £{lineItems.reduce((s,l) => s + (l.quantity||1) * (l.unit_price||0), 0).toFixed(2)}
                  </span>
                  <button onClick={async () => {
                    setSavingItems(true)
                    // Delete existing items for this job
                    await supabase.from('job_line_items').delete().eq('job_id', id)
                    // Insert all current items
                    const validItems = lineItems.filter(l => l.description?.trim())
                    if (validItems.length > 0) {
                      await supabase.from('job_line_items').insert(
                        validItems.map(l => ({
                          job_id: id,
                          description: l.description,
                          item_type: l.item_type || 'certificate',
                          quantity: l.quantity || 1,
                          unit: l.unit || 'ea',
                          unit_price: l.unit_price || 0,
                        }))
                      )
                    }
                    // Update job totals
                    const total = validItems.reduce((s,l) => s + (l.quantity||1) * (l.unit_price||0), 0)
                    await saveField('invoice_amount', total)
                    setSavingItems(false)
                    showToast('Line items saved ✓')
                    fetchJob()
                  }} disabled={savingItems}
                    style={{ background:'#0093DB', color:'#fff', border:'none', borderRadius:8, padding:'8px 20px', fontWeight:700, fontSize:13, cursor:'pointer', opacity:savingItems?0.7:1 }}>
                    {savingItems ? 'Saving…' : '💾 Save Items'}
                  </button>
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
