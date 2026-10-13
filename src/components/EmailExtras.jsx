import { useRef } from 'react'
import { supabase } from '../lib/supabase'

// CC + file attachments for emails sent from the platform (SendEmailModal and EmailCompose).
// Files are uploaded to storage first and gmail-reply attaches them server-side, so large
// PDFs don't have to travel through the browser request.

export const MAX_TOTAL_MB = 15          // Gmail caps a message at 25 MB once encoded
const MAX_FILE_MB = 15
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** "a@x.com; b@y.com , c@z.com" -> { list: [...], invalid: [...] } */
export function parseCc(value) {
  const parts = String(value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
  return { list: parts.filter(p => EMAIL_RE.test(p)), invalid: parts.filter(p => !EMAIL_RE.test(p)) }
}

const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

/** Upload picked files; returns [{ path, name, mime }] for gmail-reply's storage_paths */
export async function uploadEmailFiles(files) {
  const folder = `email-attachments/${crypto.randomUUID()}`
  const out = []
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\- ()]+/g, '_')
    const path = `${folder}/${safe}`
    const { error } = await supabase.storage.from('job-files').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
    if (error) throw new Error(`Could not upload ${f.name}: ${error.message}`)
    out.push({ path, name: f.name, mime: f.type || 'application/octet-stream' })
  }
  return out
}

/** Check picked files against size limits; returns an error string or '' */
export function checkFiles(files) {
  const big = files.find(f => f.size > MAX_FILE_MB * 1048576)
  if (big) return `${big.name} is ${fmtSize(big.size)} — files must be under ${MAX_FILE_MB} MB.`
  const total = files.reduce((t, f) => t + f.size, 0)
  if (total > MAX_TOTAL_MB * 1048576) return `Attachments total ${fmtSize(total)} — keep them under ${MAX_TOTAL_MB} MB per email.`
  return ''
}

export function CcField({ value, onChange, inputStyle, labelStyle }) {
  const { invalid } = parseCc(value)
  return (
    <div>
      <label style={labelStyle}>CC <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>(optional — separate with commas)</span></label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="landlord@example.com, agent@example.com" style={inputStyle} />
      {invalid.length > 0 && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 4 }}>Not a valid email: {invalid.join(', ')}</div>}
    </div>
  )
}

export function AttachFiles({ files, onChange, labelStyle }) {
  const ref = useRef(null)
  const total = files.reduce((t, f) => t + f.size, 0)
  const problem = checkFiles(files)
  return (
    <div>
      <label style={labelStyle}>Attachments</label>
      <div style={{ border: '1px dashed #CBD5E1', borderRadius: 8, padding: '10px 12px', background: '#FAFBFC' }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#1F2937', padding: '4px 0', borderBottom: '1px solid #EEF1F5' }}>
            <span>{/pdf/i.test(f.type) ? '📄' : /image/i.test(f.type) ? '🖼' : '📎'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            <span style={{ color: '#6B7280' }}>{fmtSize(f.size)}</span>
            <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 14 }} title="Remove">✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: files.length ? 8 : 0 }}>
          <button type="button" onClick={() => ref.current?.click()}
            style={{ background: '#fff', color: '#0093DB', border: '1px solid #0093DB55', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            + Attach files
          </button>
          <span style={{ fontSize: 11, color: '#6B7280' }}>
            {files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(total)}` : `PDF, images, Word or Excel · up to ${MAX_TOTAL_MB} MB`}
          </span>
        </div>
        <input ref={ref} type="file" multiple hidden
          accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          onChange={e => { onChange([...files, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
      </div>
      {problem && <div style={{ color: '#DC2626', fontSize: 11, marginTop: 4 }}>{problem}</div>}
    </div>
  )
}
