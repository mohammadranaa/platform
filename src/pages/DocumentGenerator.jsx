import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import { MLC_LOGO } from '../lib/logo.js'
import SendEmailModal from '../components/SendEmailModal'
import { buildInvoicePdf } from '../lib/generatePdf'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const COMPANIES = {
  standard: {
    name: 'My Landlord Certificate LTD', reg: '17265132',
    sort: '60-83-71', account: '83356126',
    address: '134 Merton High Street, London, SW19 1BA',
    email: 'info@mylandlordcertificate.co.uk', phone: '+44 020 3996 1070',
  },
  remedials: {
    name: 'My Landlord Certificate Remedials LTD', reg: '17289041',
    sort: '04-06-05', account: '32356220',
    address: '134 Merton High Street, London, SW19 1BA',
    email: 'info@mylandlordcertificate.co.uk', phone: '+44 020 3996 1070',
  },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    amber:   { background: C.amberSoft,  color: C.amber,     border: `1px solid ${C.amber}66` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
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

function Document({ type, company, data, lineItems }) {
  const co = COMPANIES[company] || COMPANIES.standard
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const subtotal  = lineItems.reduce((s, l) => s + (Number(l.qty || 1) * Number(l.unit_price || 0)), 0)
  const discount  = Number(data.discount || 0)
  const total     = subtotal - discount
  const paid      = Number(data.paid || 0)
  const balance   = total - paid
  const today     = new Date()
  const dueDate   = new Date(today.getTime() + 3 * 86400000)
  const fmtDate   = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const isInvoice = type === 'invoice'

  return (
    <div style={{ background: '#fff', color: '#111', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.6, padding: '48px 52px', width: '100%', boxSizing: 'border-box' }}>

      {/* Header with real logo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid #0093DB' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={MLC_LOGO} alt="My Landlord Certificate" style={{ width: 90, height: 90, objectFit: 'contain' }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0093DB', marginBottom: 3 }}>{co.name}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{co.address}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{co.phone}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{co.email}</div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Co. Reg: {co.reg}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#1F2937', marginBottom: 8 }}>{isInvoice ? 'TAX INVOICE' : 'QUOTE'}</div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>{isInvoice ? 'Invoice' : 'Quote'} #: <strong style={{ color: '#1F2937' }}>{data.doc_number || '—'}</strong></div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>Date: <strong style={{ color: '#1F2937' }}>{fmtDate(today)}</strong></div>
          <div style={{ fontSize: 12, color: isInvoice ? '#DC2626' : '#6B7280', fontWeight: isInvoice ? 600 : 400 }}>
            {isInvoice ? 'Due' : 'Valid Until'}: <strong>{fmtDate(isInvoice ? dueDate : new Date(today.getTime() + 14 * 86400000))}</strong>
          </div>
        </div>
      </div>

      {/* Bill to + site */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#0093DB', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Billed To</div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{data.client_name || '—'}</div>
          {data.client_address && <div style={{ fontSize: 12, color: '#6B7280' }}>{data.client_address}</div>}
          {data.client_email   && <div style={{ fontSize: 12, color: '#6B7280' }}>{data.client_email}</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#0093DB', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Job Details</div>
          {data.site_address   && <div style={{ fontSize: 12 }}><strong>Site:</strong> {data.site_address}</div>}
          {data.work_completed && <div style={{ fontSize: 12 }}><strong>Services:</strong> {data.work_completed}</div>}
        </div>
      </div>

      {/* Line items */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr style={{ background: '#0093DB' }}>
            {['Description', 'QTY', 'Unit Price', 'Total Price'].map((h, i) => (
              <th key={h} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lineItems.filter(l => l.description).map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F5F7FA' }}>
              <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{item.description}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{item.qty || 1}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{fmt(item.unit_price)}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #E5E7EB' }}>{fmt((item.qty || 1) * (item.unit_price || 0))}</td>
            </tr>
          ))}
          {lineItems.filter(l => l.description).length === 0 && (
            <tr><td colSpan={4} style={{ padding: '20px 14px', textAlign: 'center', color: '#9CA3AF' }}>No line items added</td></tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
        <div style={{ width: 280 }}>
          {[
            ['SUBTOTAL', fmt(subtotal)],
            [discount > 0 ? 'DISCOUNT' : 'NONE', discount > 0 ? `-${fmt(discount)}` : '£0.00'],
            ['TOTAL', fmt(total)],
            ...(isInvoice ? [['PAID', fmt(paid)]] : []),
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 14px', borderBottom: '1px solid #E5E7EB', fontSize: 13 }}>
              <span style={{ color: '#6B7280' }}>{label}:</span><span>{value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#0093DB', borderRadius: '0 0 6px 6px', fontSize: 15, fontWeight: 900, color: '#fff' }}>
            <span>BALANCE DUE:</span><span>{fmt(isInvoice ? balance : total)}</span>
          </div>
        </div>
      </div>

      {/* How to Pay */}
      <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 20, display: 'flex', justifyContent: 'space-between', gap: 32 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#0093DB' }}>How to Pay</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>We accept payment by: Bank Transfer or Pay Online</div>
          <div style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>Bank Details</div>
            <div style={{ color: '#6B7280' }}>Account Name: {co.name}</div>
            <div style={{ color: '#6B7280' }}>Sort Code: {co.sort}</div>
            <div style={{ color: '#6B7280' }}>Account Number: {co.account}</div>
            <div style={{ color: '#DC2626', fontWeight: 600, marginTop: 6 }}>Note: Please Put Invoice Number As Reference</div>
          </div>
        </div>
        {isInvoice && (
          <div style={{ textAlign: 'right', fontSize: 12, color: '#6B7280' }}>
            <div style={{ fontWeight: 600, color: '#1F2937', marginBottom: 2 }}>Invoice #{data.doc_number}</div>
            <div>{fmt(balance)} due by {fmtDate(dueDate)}</div>
            <div style={{ marginTop: 6, color: '#9CA3AF' }}>Payment Upfront Unless Credit Terms Agreed</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB', textAlign: 'center', fontSize: 10, color: '#9CA3AF' }}>
        Company Registration Number {co.reg} · Registered Office: {co.name}, {co.address}, United Kingdom
      </div>
    </div>
  )
}

export default function DocumentGenerator() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast, showToast } = useToast()

  const [docType, setDocType]     = useState('invoice')
  const [company, setCompany]     = useState('standard')
  const [clients, setClients]     = useState([])
  const [jobs, setJobs]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showSend, setShowSend]       = useState(false)

  const [data, setData] = useState({
    client_name: '', client_address: '', client_email: '',
    site_address: '', work_completed: '', doc_number: '',
    discount: '', paid: '', client_id: '', job_id: '',
  })

  const [lineItems, setLineItems] = useState([
    { description: '', qty: 1, unit_price: '' },
    { description: '', qty: 1, unit_price: '' },
    { description: '', qty: 1, unit_price: '' },
  ])

  useEffect(() => { fetchAll() }, [])

  // Pre-fill from a job passed via navigation state (e.g. JobDetail's "Send Invoice")
  useEffect(() => {
    if (location.state?.job) {
      const j = location.state.job
      const jClientName = j.clients?.company_name || `${j.clients?.first_name || ''} ${j.clients?.last_name || ''}`.trim()
      setDocType('invoice')
      setData(prev => ({
        ...prev,
        client_id:       j.client_id || '',
        client_name:     jClientName,
        client_email:    j.clients?.email || '',
        client_address:  j.clients?.street_address || '',
        site_address:    j.site_address || '',
        work_completed:  (j.service_types || []).join(', ') || j.title || '',
        doc_number:      j.job_number ? `INV-${j.job_number}` : prev.doc_number,
        job_id:          j.id || '',
      }))
      const items = (j.line_items || []).map(l => ({
        description: l.description || '',
        qty:         l.quantity || 1,
        unit_price:  l.unit_price || 0,
      }))
      if (items.length > 0) setLineItems([...items, { description: '', qty: 1, unit_price: '' }])
      const isRemedial = (j.line_items || []).some(l => (l.description || '').toLowerCase().includes('remedial'))
      if (isRemedial) setCompany('remedials')
    }
    if (location.state?.autoSend) {
      setTimeout(() => setShowSend(true), 500)
    }
  }, [location.state])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: j }] = await Promise.all([
      supabase.from('clients').select('id, first_name, last_name, company_name, email, street_address, city, postcode, billing_name, billing_email, billing_address').order('company_name'),
      supabase.from('jobs').select('id, job_number, title, service_types, site_address, job_line_items(description, quantity, unit_price)').order('created_at', { ascending: false }).limit(100),
    ])
    setClients(c || [])
    setJobs(j || [])
    setLoading(false)
  }

  function selectClient(clientId) {
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    const name = client.company_name || `${client.first_name || ''} ${client.last_name || ''}`.trim()
    const address = client.billing_address || [client.street_address, client.city, client.postcode].filter(Boolean).join(', ')
    setData(p => ({ ...p, client_id: clientId, client_name: name, client_address: address, client_email: client.billing_email || client.email || '' }))
  }

  function selectJob(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    setData(p => ({
      ...p, job_id: jobId,
      doc_number: docType === 'invoice' ? `INV-${job.job_number}` : `QUO-${job.job_number}`,
      site_address: job.site_address || '',
      work_completed: job.service_types?.join(', ') || job.title,
    }))
    if (job.job_line_items?.length > 0) {
      setLineItems([...job.job_line_items.map(l => ({ description: l.description, qty: l.quantity, unit_price: l.unit_price })), { description: '', qty: 1, unit_price: '' }])
    }
  }

  function handlePrint() {
    const el = document.getElementById('doc-preview-content')
    if (!el) { showToast('Click Preview first, then print', 'error'); return }
    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head><title>${docType === 'invoice' ? 'Invoice' : 'Quote'} ${data.doc_number || ''}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif}@page{margin:0;size:A4}</style></head><body>${el.innerHTML}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 600)
  }

  function generateInvoiceNumber() {
    return 'INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4)
  }

  async function saveInvoice() {
    setSaving(true)
    const docNumber = data.doc_number || generateInvoiceNumber()
    const subtotalVal = lineItems.reduce((s, l) => s + (Number(l.qty || 1) * Number(l.unit_price || 0)), 0)
    const discountVal = Number(data.discount || 0)
    const totalVal    = subtotalVal - discountVal
    const paidVal     = Number(data.paid || 0)
    const balanceVal  = totalVal - paidVal

    try {
      const { error } = await supabase.from('invoices').insert({
        invoice_number:  docNumber,
        doc_type:        docType,
        company,
        client_id:       data.client_id || null,
        client_name:     data.client_name,
        client_address:  data.client_address,
        client_email:    data.client_email,
        job_id:          data.job_id || null,
        site_address:    data.site_address,
        work_completed:  data.work_completed,
        line_items:      lineItems.filter(l => l.description),
        subtotal:        subtotalVal,
        discount:        discountVal,
        total:           totalVal,
        amount_paid:     paidVal,
        balance_due:     balanceVal,
        status:          balanceVal <= 0 ? 'paid' : 'draft',
        created_by:      profile.id,
        created_by_name: profile.full_name,
        date:            new Date().toISOString().slice(0, 10),
      })

      if (error) {
        console.error('Invoice save error:', error)
        showToast('Failed to save invoice: ' + error.message, 'error')
        return
      }
      if (!data.doc_number) set('doc_number', docNumber)
      showToast(`${docType === 'invoice' ? 'Invoice' : 'Quote'} ${docNumber} saved ✓`)
    } catch (err) {
      console.error('Invoice save exception:', err)
      showToast('Failed to save invoice: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setData(p => ({ ...p, [k]: v }))
  const subtotal = lineItems.reduce((s, l) => s + (Number(l.qty || 1) * Number(l.unit_price || 0)), 0)
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const clientName = c => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()
  const inputStyle = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
  const labelStyle = { color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

  // Builds the Send Invoice email body — keeps the Standard/Remedials bank-details
  // toggle correct (COMPANIES[company]) rather than always using Standard details.
  function buildEmailBody(d) {
    const name = d.client_name || 'Customer'
    const invoiceNum = d.doc_number || ''
    const total = (subtotal - Number(d.discount || 0)).toFixed(2)
    const date = new Date().toLocaleDateString('en-GB')
    const co = COMPANIES[company] || COMPANIES.standard
    return `Dear ${name},\n\nPlease find attached your invoice ${invoiceNum} for the services provided.\n\nInvoice Details:\nInvoice Number: ${invoiceNum}\nDate: ${date}\nAmount Due: GBP${total}\n\nPayment can be made by bank transfer to:\nBank: ${co.name}\nSort Code: ${co.sort}\nAccount: ${co.account}\nReference: ${invoiceNum}\n\nKind Regards,\nMy Landlord Certificate\n020 3996 1070\ninfo@mylandlordcertificate.co.uk`
  }

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading…</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Documents</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>Generate invoices and quotes in MLC format</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/invoices')}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: '9px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            📄 All Invoices
          </button>
          <Btn variant="success" onClick={saveInvoice} disabled={saving}>{saving ? 'Saving…' : '💾 Save'}</Btn>
          <button onClick={() => setShowSend(true)}
            style={{ background:'#0093DB', color:'#fff', border:'none', borderRadius:8,
              padding:'10px 20px', fontWeight:700, fontSize:14, cursor:'pointer',
              display:'flex', alignItems:'center', gap:6 }}>
            📧 Send Invoice
          </button>
          <Btn variant="ghost" onClick={() => setShowPreview(true)}>👁 Preview</Btn>
          <Btn variant="amber" onClick={handlePrint}>🖨 Print / PDF</Btn>
        </div>
      </div>

      {/* Toggles */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
          {[['invoice','🧾 Invoice'], ['quote','📋 Quote']].map(([key, label]) => (
            <button key={key} onClick={() => setDocType(key)}
              style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: docType === key ? 700 : 400, background: docType === key ? C.accent : 'transparent', color: docType === key ? '#fff' : C.muted }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
          {[['standard','🏠 Standard'], ['remedials','🔨 Remedials']].map(([key, label]) => (
            <button key={key} onClick={() => setCompany(key)}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: company === key ? 700 : 400, background: company === key ? (key === 'remedials' ? C.amber : C.accent) : 'transparent', color: company === key ? '#fff' : C.muted }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.muted, padding: '6px 12px', background: company === 'remedials' ? C.amberSoft : C.accentSoft, borderRadius: 8 }}>
          {COMPANIES[company].name} · Sort: {COMPANIES[company].sort} · Acc: {COMPANIES[company].account}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Auto-fill from Platform</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={labelStyle}>Load Client</label>
                <select value={data.client_id} onChange={e => selectClient(e.target.value)} style={inputStyle}>
                  <option value="">— Select client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Load Job</label>
                <select value={data.job_id} onChange={e => selectJob(e.target.value)} style={inputStyle}>
                  <option value="">— Select job —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.title}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
              {docType === 'invoice' ? 'Invoice' : 'Quote'} Details
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: docType === 'invoice' ? 'Invoice Number' : 'Quote Number', key: 'doc_number', placeholder: 'INV-J-01001' },
                { label: 'Client Name',    key: 'client_name',    placeholder: 'Client or Company Name' },
                { label: 'Client Address', key: 'client_address', placeholder: 'Address' },
                { label: 'Client Email',   key: 'client_email',   placeholder: 'email@example.com', type: 'email' },
                { label: 'Site Address',   key: 'site_address',   placeholder: 'Property address' },
                { label: 'Services',       key: 'work_completed', placeholder: 'EICR, EPC, PAT Testing' },
              ].map(f => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type={f.type || 'text'} value={data[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} style={inputStyle} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Adjustments</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>Discount (£)</label><input type="number" value={data.discount} onChange={e => set('discount', e.target.value)} placeholder="0.00" style={inputStyle} /></div>
              {docType === 'invoice' && <div><label style={labelStyle}>Amount Paid (£)</label><input type="number" value={data.paid} onChange={e => set('paid', e.target.value)} placeholder="0.00" style={inputStyle} /></div>}
            </div>
          </div>
        </div>

        {/* Right - line items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Line Items</div>
              <button onClick={() => setLineItems(p => [...p, { description: '', qty: 1, unit_price: '' }])}
                style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Line</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 55px 90px 28px', gap: 6, marginBottom: 8 }}>
              {['Description','Qty','Price',''].map(h => <div key={h} style={{ fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase' }}>{h}</div>)}
            </div>
            {lineItems.map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 55px 90px 28px', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                <input value={item.description} onChange={e => setLineItems(p => p.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))}
                  placeholder={i === 0 ? 'EPC 5 Bedrooms' : i === 1 ? 'EICR 5 Bedrooms' : 'Description'}
                  style={{ ...inputStyle, padding: '7px 10px', fontSize: 13 }} />
                <input type="number" value={item.qty} onChange={e => setLineItems(p => p.map((l, idx) => idx === i ? { ...l, qty: e.target.value } : l))} min="1"
                  style={{ ...inputStyle, padding: '7px 8px', fontSize: 13, textAlign: 'center' }} />
                <input type="number" value={item.unit_price} onChange={e => setLineItems(p => p.map((l, idx) => idx === i ? { ...l, unit_price: e.target.value } : l))} placeholder="0.00"
                  style={{ ...inputStyle, padding: '7px 8px', fontSize: 13 }} />
                <button onClick={() => setLineItems(p => p.filter((_, idx) => idx !== i))}
                  style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 16 }}>✕</button>
              </div>
            ))}
            <div style={{ marginTop: 16, borderTop: `2px solid ${C.border}`, paddingTop: 14 }}>
              {[
                ['Subtotal', fmt(subtotal)],
                ['Discount', data.discount ? `-${fmt(data.discount)}` : '£0.00'],
                ['Total', fmt(subtotal - Number(data.discount || 0))],
                ...(docType === 'invoice' ? [['Paid', data.paid ? fmt(data.paid) : '£0.00']] : []),
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: C.muted }}>{label}</span><span style={{ color: C.text }}>{value}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: C.accent, borderRadius: 8, marginTop: 8, fontSize: 16, fontWeight: 900, color: '#fff' }}>
                <span>Balance Due</span>
                <span>{fmt(subtotal - Number(data.discount || 0) - Number(data.paid || 0))}</span>
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Btn onClick={() => setShowPreview(true)}>👁 Preview Document</Btn>
              <Btn variant="amber" onClick={handlePrint}>🖨 Print / Save as PDF</Btn>
              <div style={{ fontSize: 12, color: C.muted, padding: '8px 12px', background: C.surface, borderRadius: 8 }}>
                To save as PDF: click Print → select <strong>"Save as PDF"</strong> as destination.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000BB', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '32px 20px' }}
          onClick={() => setShowPreview(false)}>
          <div style={{ width: '100%', maxWidth: 760 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
                {docType === 'invoice' ? 'Invoice' : 'Quote'} Preview
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handlePrint} style={{ background: C.amber, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>🖨 Print / Save PDF</button>
                <button onClick={() => setShowPreview(false)} style={{ background: 'transparent', border: '1px solid #ffffff66', color: '#fff', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>Close</button>
              </div>
            </div>
            <div id="doc-preview-content" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.4)', borderRadius: 4, overflow: 'hidden' }}>
              <Document type={docType} company={company} data={data} lineItems={lineItems} />
            </div>
          </div>
        </div>
      )}

      {showSend && (
        <SendEmailModal
          title="Send Invoice"
          to={data.client_email || ''}
          subject={`Invoice ${data.doc_number || ''} -- My Landlord Certificate`}
          body={buildEmailBody(data)}
          buildAttachment={() => {
            const co = COMPANIES[company] || COMPANIES.standard
            const { base64, filename } = buildInvoicePdf({
              invoiceNumber: data.doc_number,
              // Raw date value, not pre-formatted -- the PDF builder's own
              // date parser handles formatting safely.
              date: new Date(),
              clientName: data.client_name,
              clientAddress: data.client_address,
              clientEmail: data.client_email || '',
              siteAddress: data.site_address,
              services: data.work_completed || '',
              lineItems: lineItems.filter(l => l.description).map(l => ({ description: l.description, quantity: l.qty, unit_price: l.unit_price })),
              total: subtotal - Number(data.discount || 0),
              bankName: co.name,
              sortCode: co.sort,
              accountNumber: co.account,
            })
            return { base64, filename, mime: 'application/pdf' }
          }}
          onClose={() => setShowSend(false)}
          onSent={() => { showToast('Invoice sent'); setShowSend(false) }}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
