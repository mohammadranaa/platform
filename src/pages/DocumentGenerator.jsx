import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#111827', surface: '#1F2937', surface2: '#1a2433', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,      color: '#fff',   border: 'none' },
    ghost:   { background: 'transparent', color: C.muted,  border: `1px solid ${C.border}` },
    success: { background: C.greenSoft,   color: C.green,  border: `1px solid ${C.green}44` },
    amber:   { background: C.amberSoft,   color: C.amber,  border: `1px solid ${C.amber}44` },
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

// ── The actual invoice/quote document (white, printable) ──────
function Document({ type, settings, data, lineItems }) {
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const subtotal = lineItems.reduce((s, l) => s + (Number(l.qty || 1) * Number(l.unit_price || 0)), 0)
  const discount = Number(data.discount || 0)
  const total = subtotal - discount
  const paid = Number(data.paid || 0)
  const balance = total - paid

  const today = new Date()
  const dueDate = new Date(today.getTime() + (settings.payment_terms_days || 3) * 86400000)
  const formatDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const isInvoice = type === 'invoice'
  const docTitle = isInvoice ? 'Tax Invoice' : 'Quote'

  return (
    <div style={{
      background: '#fff',
      color: '#111',
      fontFamily: 'Arial, sans-serif',
      fontSize: 13,
      lineHeight: 1.5,
      padding: '48px 52px',
      minHeight: '297mm',
      width: '210mm',
      margin: '0 auto',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        {/* Logo / Company left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 64, height: 64, background: '#1a3a6b', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 900, fontSize: 10, textAlign: 'center', lineHeight: 1.3,
          }}>
            My<br/>Landlord<br/>Certificate
          </div>
        </div>

        {/* Company details right */}
        <div style={{ textAlign: 'right', fontSize: 12, color: '#444' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111', marginBottom: 2 }}>{settings.company_name}</div>
          <div>{settings.company_address}</div>
          <div>{settings.company_phone}</div>
          <div>{settings.company_email}</div>
          {settings.vat_number && <div style={{ marginTop: 4 }}>VAT: {settings.vat_number}</div>}
          <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>Co. Reg: {settings.company_reg}</div>
        </div>
      </div>

      {/* Client + Document info row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        {/* Bill to */}
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111', marginBottom: 4 }}>
            {data.client_name || 'Client Name'}
          </div>
          {data.client_address && <div style={{ color: '#555', fontSize: 12 }}>{data.client_address}</div>}
          {data.client_email && <div style={{ color: '#555', fontSize: 12 }}>{data.client_email}</div>}
        </div>

        {/* Doc details */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#111', marginBottom: 6 }}>{docTitle}</div>
          <div style={{ fontSize: 12, color: '#555' }}>
            {isInvoice ? 'Invoice' : 'Quote'} Number: <strong>{data.doc_number || '—'}</strong>
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>
            {isInvoice ? 'Invoice' : 'Quote'} Date: <strong>{formatDate(today)}</strong>
          </div>
          {isInvoice && (
            <div style={{ fontSize: 12, color: '#555' }}>
              Due Date: <strong>{formatDate(dueDate)}</strong>
            </div>
          )}
          {!isInvoice && (
            <div style={{ fontSize: 12, color: '#555' }}>
              Valid Until: <strong>{formatDate(new Date(today.getTime() + 14 * 86400000))}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Site address + work completed */}
      {(data.site_address || data.work_completed) && (
        <div style={{ marginBottom: 20, fontSize: 12 }}>
          {data.site_address && (
            <div style={{ marginBottom: 4 }}>
              <strong>SITE ADDRESS:</strong> {data.site_address}
            </div>
          )}
          {data.work_completed && (
            <div>
              <strong>WORK COMPLETED:</strong> {data.work_completed}
            </div>
          )}
        </div>
      )}

      {/* Line items table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151' }}>Description</th>
            <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151', width: 60 }}>QTY</th>
            <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151', width: 110 }}>Unit Price</th>
            <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#374151', width: 110 }}>Total Price</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.filter(l => l.description).map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '10px 12px', fontSize: 13 }}>{item.description}</td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 13 }}>{item.qty || 1}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13 }}>{fmt(item.unit_price)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 500 }}>{fmt((item.qty || 1) * (item.unit_price || 0))}</td>
            </tr>
          ))}
          {/* Empty rows to pad table */}
          {lineItems.filter(l => l.description).length === 0 && (
            <tr><td colSpan={4} style={{ padding: '20px 12px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No line items added</td></tr>
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
        <div style={{ width: 260 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #e5e7eb', fontSize: 13 }}>
            <span style={{ color: '#555' }}>SUBTOTAL:</span>
            <span style={{ fontWeight: 500 }}>{fmt(subtotal)}</span>
          </div>
          {discount > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #e5e7eb', fontSize: 13 }}>
              <span style={{ color: '#555' }}>DISCOUNT:</span>
              <span style={{ color: '#16a34a' }}>-{fmt(discount)}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #e5e7eb', fontSize: 13 }}>
              <span style={{ color: '#555' }}>NONE:</span>
              <span>£0.00</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #e5e7eb', fontSize: 13 }}>
            <span style={{ color: '#555' }}>TOTAL:</span>
            <span style={{ fontWeight: 600 }}>{fmt(total)}</span>
          </div>
          {isInvoice && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderTop: '1px solid #e5e7eb', fontSize: 13 }}>
              <span style={{ color: '#555' }}>PAID:</span>
              <span style={{ color: paid > 0 ? '#16a34a' : '#555' }}>{fmt(paid)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '2px solid #111', fontSize: 15, fontWeight: 900 }}>
            <span>BALANCE DUE:</span>
            <span>{fmt(isInvoice ? balance : total)}</span>
          </div>
        </div>
      </div>

      {/* How to Pay / Bank details */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 20, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>How to Pay</div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
            We accept payment by: {settings.payment_methods}
          </div>
          <div style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 3 }}><strong>Bank Details</strong></div>
            <div style={{ color: '#555' }}>Bank Name: {settings.bank_name}</div>
            <div style={{ color: '#555' }}>Sort Code: {settings.bank_sort_code}</div>
            <div style={{ color: '#555' }}>Account Number: {settings.bank_account}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#555' }}>
          {isInvoice && (
            <>
              <div style={{ fontWeight: 600, color: '#111', marginBottom: 4 }}>
                {isInvoice ? 'Invoice' : 'Quote'} Number {data.doc_number}
              </div>
              <div>{fmt(isInvoice ? balance : total)} due by {formatDate(dueDate)}</div>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e5e7eb', textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
        {isInvoice ? settings.invoice_footer : settings.quote_footer}
        <br />
        Company Registration Number {settings.company_reg}. Registered Office: {settings.company_name} {settings.company_address}, United Kingdom
      </div>
    </div>
  )
}

// ── Main DocumentGenerator page ───────────────────────────────
export default function DocumentGenerator() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [docType, setDocType]   = useState('invoice') // invoice | quote
  const [settings, setSettings] = useState(null)
  const [clients, setClients]   = useState([])
  const [jobs, setJobs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [showPreview, setShowPreview] = useState(false)

  const [data, setData] = useState({
    client_name: '', client_address: '', client_email: '',
    site_address: '', work_completed: '',
    doc_number: '', discount: '', paid: '',
    client_id: '', job_id: '',
  })

  const [lineItems, setLineItems] = useState([
    { description: '', qty: 1, unit_price: '' },
    { description: '', qty: 1, unit_price: '' },
    { description: '', qty: 1, unit_price: '' },
  ])

  const printRef = useRef()

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: s }, { data: c }, { data: j }] = await Promise.all([
      supabase.from('document_settings').select('*').single(),
      supabase.from('clients').select('id, first_name, last_name, company_name, email, street_address, city, postcode, billing_name, billing_email, billing_address').order('company_name'),
      supabase.from('jobs').select('id, job_number, title, service_types, site_address, job_line_items(description, quantity, unit_price)').order('created_at', { ascending: false }).limit(100),
    ])
    setSettings(s)
    setClients(c || [])
    setJobs(j || [])
    setLoading(false)
  }

  // Auto-fill from client
  function selectClient(clientId) {
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    const name = client.company_name || `${client.first_name || ''} ${client.last_name || ''}`.trim()
    const address = client.billing_address || [client.street_address, client.city, client.postcode].filter(Boolean).join(', ')
    setData(p => ({ ...p, client_id: clientId, client_name: name, client_address: address, client_email: client.billing_email || client.email || '' }))
  }

  // Auto-fill from job
  function selectJob(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return
    const services = job.service_types?.join(', ') || job.title
    setData(p => ({
      ...p,
      job_id: jobId,
      doc_number: docType === 'invoice' ? `INV-${job.job_number}` : `QUO-${job.job_number}`,
      site_address: job.site_address || '',
      work_completed: services,
    }))
    // Pre-fill line items from job
    if (job.job_line_items?.length > 0) {
      const items = job.job_line_items.map(l => ({
        description: l.description,
        qty: l.quantity,
        unit_price: l.unit_price,
      }))
      setLineItems([...items, { description: '', qty: 1, unit_price: '' }])
    }
  }

  function addLineItem() {
    setLineItems(p => [...p, { description: '', qty: 1, unit_price: '' }])
  }

  function removeLineItem(i) {
    setLineItems(p => p.filter((_, idx) => idx !== i))
  }

  function updateLineItem(i, key, value) {
    setLineItems(p => p.map((item, idx) => idx === i ? { ...item, [key]: value } : item))
  }

  function handlePrint() {
    window.print()
  }

  const set = (k, v) => setData(p => ({ ...p, [k]: v }))

  const subtotal = lineItems.reduce((s, l) => s + (Number(l.qty || 1) * Number(l.unit_price || 0)), 0)
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading…</div>

  return (
    <div>
      {/* Print styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #print-document { display: block !important; }
        }
        #print-document { display: none; }
      `}</style>

      {/* Printable document (hidden until print) */}
      <div id="print-document">
        {settings && <Document type={docType} settings={settings} data={data} lineItems={lineItems} />}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Documents</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>Generate invoices and quotes in MLC format</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => setShowPreview(true)}>Preview</Btn>
          <Btn variant="amber" onClick={handlePrint}>Print / Save PDF</Btn>
        </div>
      </div>

      {/* Doc type toggle */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, marginBottom: 24, width: 'fit-content' }}>
        {[['invoice', '🧾 Invoice'], ['quote', '📋 Quote']].map(([key, label]) => (
          <button key={key} onClick={() => {
            setDocType(key)
            setData(p => ({ ...p, doc_number: p.job_id ? (key === 'invoice' ? `INV-${jobs.find(j=>j.id===p.job_id)?.job_number}` : `QUO-${jobs.find(j=>j.id===p.job_id)?.job_number}`) : '' }))
          }}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: docType === key ? 700 : 400, background: docType === key ? C.bg : 'transparent', color: docType === key ? C.text : C.muted }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Left — form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Auto-fill from existing data */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Auto-fill from Platform</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>Load Client</label>
                <select value={data.client_id} onChange={e => selectClient(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
                  <option value="">— Select client to auto-fill —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>Load Job</label>
                <select value={data.job_id} onChange={e => selectJob(e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
                  <option value="">— Select job to auto-fill —</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.job_number} — {j.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Document details */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
              {docType === 'invoice' ? 'Invoice' : 'Quote'} Details
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: docType === 'invoice' ? 'Invoice Number' : 'Quote Number', key: 'doc_number', placeholder: docType === 'invoice' ? 'INV-J-01001' : 'QUO-J-01001' },
                { label: 'Client Name', key: 'client_name', placeholder: 'Dr Shailesh Vadodaria' },
                { label: 'Client Address', key: 'client_address', placeholder: 'Greenford UB6 7EF' },
                { label: 'Client Email', key: 'client_email', placeholder: 'client@email.com' },
                { label: 'Site Address', key: 'site_address', placeholder: 'Greenford, UB6 7EF' },
                { label: 'Work Completed', key: 'work_completed', placeholder: 'EICR, EPC, PAT Testing' },
              ].map(f => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>{f.label}</label>
                  <input value={data[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Financial adjustments */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Adjustments</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>Discount (£)</label>
                <input type="number" value={data.discount} onChange={e => set('discount', e.target.value)} placeholder="0.00"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14 }} />
              </div>
              {docType === 'invoice' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>Amount Paid (£)</label>
                  <input type="number" value={data.paid} onChange={e => set('paid', e.target.value)} placeholder="0.00"
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14 }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right — line items + running total */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Line Items</div>
              <button onClick={addLineItem} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ Add Line</button>
            </div>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 55px 90px 28px', gap: 8, marginBottom: 8 }}>
              {['Description', 'Qty', 'Unit Price', ''].map(h => (
                <div key={h} style={{ fontSize: 11, color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>

            {lineItems.map((item, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 55px 90px 28px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input value={item.description} onChange={e => updateLineItem(i, 'description', e.target.value)}
                  placeholder={i === 0 ? 'e.g. EPC 5 Bedrooms' : i === 1 ? 'e.g. EICR 5 Bedrooms' : 'e.g. 3 appliances'}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 10px', fontSize: 13 }} />
                <input type="number" value={item.qty} onChange={e => updateLineItem(i, 'qty', e.target.value)} min="1"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 8px', fontSize: 13, textAlign: 'center' }} />
                <input type="number" value={item.unit_price} onChange={e => updateLineItem(i, 'unit_price', e.target.value)}
                  placeholder="0.00"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 8px', fontSize: 13 }} />
                <button onClick={() => removeLineItem(i)}
                  style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 16, textAlign: 'center' }}>✕</button>
              </div>
            ))}

            {/* Running total */}
            <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              {[
                ['Subtotal', fmt(subtotal), C.text],
                ['Discount', data.discount ? `-${fmt(data.discount)}` : '—', C.green],
                ['Total', fmt(subtotal - Number(data.discount || 0)), C.text],
                ...(docType === 'invoice' ? [['Paid', data.paid ? fmt(data.paid) : '—', C.green]] : []),
                ['Balance Due', fmt(subtotal - Number(data.discount || 0) - Number(data.paid || 0)), C.accent],
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: label === 'Balance Due' ? 16 : 13, fontWeight: label === 'Balance Due' ? 700 : 400 }}>
                  <span style={{ color: C.muted }}>{label}</span>
                  <span style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Btn onClick={() => setShowPreview(true)}>Preview Document</Btn>
              <Btn variant="amber" onClick={handlePrint}>Print / Save as PDF</Btn>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginTop: 4 }}>
                To save as PDF: click Print, then select <strong style={{ color: C.muted }}>"Save as PDF"</strong> as the printer destination.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && settings && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000CC', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '40px 0' }}
          onClick={() => setShowPreview(false)}>
          <div onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '0 20px' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>Document Preview</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handlePrint}
                  style={{ background: C.amber, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>
                  Print / Save PDF
                </button>
                <button onClick={() => setShowPreview(false)}
                  style={{ background: 'transparent', border: '1px solid #ffffff44', color: '#fff', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)', borderRadius: 4 }}>
              <Document type={docType} settings={settings} data={data} lineItems={lineItems} />
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
