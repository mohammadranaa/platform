import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import { MLC_LOGO } from '../lib/logo.js'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
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

const STATUS_COLORS = {
  draft:  { color: C.amber,    bg: C.amberSoft  },
  sent:   { color: C.accent,   bg: C.accentSoft },
  paid:   { color: C.greenDark, bg: C.greenSoft  },
  void:   { color: C.muted,    bg: C.surface    },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,    color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',      color: C.muted,     border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,   color: C.red,       border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.green}66` },
    amber:   { background: C.amberSoft, color: C.amber,     border: `1px solid ${C.amber}66` },
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

// ── Print invoice from saved data ──────────────────────────────
function printInvoice(inv) {
  const co = COMPANIES[inv.company] || COMPANIES.standard
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const isInvoice = inv.doc_type === 'invoice'
  const lineItems = Array.isArray(inv.line_items) ? inv.line_items : []

  const html = `<!DOCTYPE html>
<html><head><title>${isInvoice ? 'Invoice' : 'Quote'} ${inv.invoice_number}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:13px;line-height:1.6;padding:48px 52px;color:#111}@page{margin:0;size:A4}table{width:100%;border-collapse:collapse}</style></head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #0093DB">
    <div style="display:flex;align-items:center;gap:16px">
      <img src="${MLC_LOGO}" style="width:80px;height:80px;object-fit:contain" />
      <div>
        <div style="font-weight:800;font-size:15px;color:#0093DB;margin-bottom:3px">${co.name}</div>
        <div style="font-size:11px;color:#6B7280">${co.address}</div>
        <div style="font-size:11px;color:#6B7280">${co.phone} · ${co.email}</div>
        <div style="font-size:10px;color:#9CA3AF;margin-top:2px">Co. Reg: ${co.reg}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:28px;font-weight:900;color:#1F2937;margin-bottom:8px">${isInvoice ? 'TAX INVOICE' : 'QUOTE'}</div>
      <div style="font-size:12px;color:#6B7280">${isInvoice ? 'Invoice' : 'Quote'} #: <strong style="color:#1F2937">${inv.invoice_number}</strong></div>
      <div style="font-size:12px;color:#6B7280">Date: <strong style="color:#1F2937">${fmtDate(inv.created_at)}</strong></div>
    </div>
  </div>

  <!-- Bill to + job details -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px">
    <div>
      <div style="font-size:10px;font-weight:700;color:#0093DB;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Billed To</div>
      <div style="font-weight:700;font-size:14px;margin-bottom:3px">${inv.client_name || '—'}</div>
      ${inv.client_address ? `<div style="font-size:12px;color:#6B7280">${inv.client_address}</div>` : ''}
      ${inv.client_email   ? `<div style="font-size:12px;color:#6B7280">${inv.client_email}</div>` : ''}
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:#0093DB;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Job Details</div>
      ${inv.site_address   ? `<div style="font-size:12px"><strong>Site:</strong> ${inv.site_address}</div>` : ''}
      ${inv.work_completed ? `<div style="font-size:12px"><strong>Services:</strong> ${inv.work_completed}</div>` : ''}
    </div>
  </div>

  <!-- Line items -->
  <table style="margin-bottom:24px">
    <thead>
      <tr style="background:#0093DB">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase">Description</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase">QTY</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase">Unit Price</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map((l, i) => `
        <tr style="background:${i % 2 === 0 ? '#fff' : '#F5F7FA'}">
          <td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #E5E7EB">${l.description}</td>
          <td style="padding:10px 14px;text-align:right;font-size:13px;border-bottom:1px solid #E5E7EB">${l.qty || 1}</td>
          <td style="padding:10px 14px;text-align:right;font-size:13px;border-bottom:1px solid #E5E7EB">${fmt(l.unit_price)}</td>
          <td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:600;border-bottom:1px solid #E5E7EB">${fmt((l.qty || 1) * (l.unit_price || 0))}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:32px">
    <div style="width:280px">
      <div style="display:flex;justify-content:space-between;padding:6px 14px;border-bottom:1px solid #E5E7EB;font-size:13px"><span style="color:#6B7280">SUBTOTAL:</span><span>${fmt(inv.subtotal)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 14px;border-bottom:1px solid #E5E7EB;font-size:13px"><span style="color:#6B7280">DISCOUNT:</span><span>${inv.discount > 0 ? `-${fmt(inv.discount)}` : '£0.00'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 14px;border-bottom:1px solid #E5E7EB;font-size:13px"><span style="color:#6B7280">TOTAL:</span><span>${fmt(inv.total)}</span></div>
      ${isInvoice ? `<div style="display:flex;justify-content:space-between;padding:6px 14px;border-bottom:1px solid #E5E7EB;font-size:13px"><span style="color:#6B7280">PAID:</span><span>${fmt(inv.amount_paid)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#0093DB;border-radius:0 0 6px 6px;font-size:15px;font-weight:900;color:#fff">
        <span>BALANCE DUE:</span><span>${fmt(isInvoice ? inv.balance_due : inv.total)}</span>
      </div>
    </div>
  </div>

  <!-- Bank details -->
  <div style="border-top:1px solid #E5E7EB;padding-top:20px">
    <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#0093DB">How to Pay</div>
    <div style="font-size:12px;color:#6B7280;margin-bottom:8px">We accept payment by: Bank Transfer or Pay Online</div>
    <div style="font-size:12px">
      <div style="font-weight:600;margin-bottom:3px">Bank Details</div>
      <div style="color:#6B7280">Account Name: ${co.name}</div>
      <div style="color:#6B7280">Sort Code: ${co.sort}</div>
      <div style="color:#6B7280">Account Number: ${co.account}</div>
      <div style="color:#DC2626;font-weight:600;margin-top:6px">Note: Please Put Invoice Number As Reference</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E5E7EB;text-align:center;font-size:10px;color:#9CA3AF">
    Company Registration Number ${co.reg} · Registered Office: ${co.name}, ${co.address}, United Kingdom
  </div>
</body></html>`

  const w = window.open('', '_blank')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 600)
}

export default function Invoices() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType]     = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterCompany, setFilterCompany] = useState('all')
  const [preview, setPreview]     = useState(null)

  useEffect(() => { fetchInvoices() }, [])

  async function fetchInvoices() {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  async function updateStatus(id, status) {
    await supabase.from('invoices').update({ status }).eq('id', id)
    setInvoices(p => p.map(inv => inv.id === id ? { ...inv, status } : inv))
    showToast(`Status updated to ${status}`)
  }

  async function deleteInvoice(inv) {
    if (!window.confirm(`Delete ${inv.doc_type === 'invoice' ? 'invoice' : 'quote'} ${inv.invoice_number}? This cannot be undone.`)) return
    await supabase.from('invoices').delete().eq('id', inv.id)
    setInvoices(p => p.filter(i => i.id !== inv.id))
    showToast('Deleted')
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })

  const filtered = useMemo(() => invoices
    .filter(inv => filterType === 'all' || inv.doc_type === filterType)
    .filter(inv => filterStatus === 'all' || inv.status === filterStatus)
    .filter(inv => filterCompany === 'all' || inv.company === filterCompany)
    .filter(inv => {
      if (!search) return true
      const q = search.toLowerCase()
      return inv.invoice_number?.toLowerCase().includes(q) ||
             inv.client_name?.toLowerCase().includes(q) ||
             inv.site_address?.toLowerCase().includes(q)
    })
  , [invoices, filterType, filterStatus, filterCompany, search])

  // Summary stats
  const stats = useMemo(() => ({
    totalInvoiced: invoices.filter(i => i.doc_type === 'invoice').reduce((s, i) => s + (i.total || 0), 0),
    totalPaid:     invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0),
    totalOutstanding: invoices.filter(i => i.status !== 'paid' && i.status !== 'void' && i.doc_type === 'invoice').reduce((s, i) => s + (i.balance_due || 0), 0),
    countInvoices: invoices.filter(i => i.doc_type === 'invoice').length,
    countQuotes:   invoices.filter(i => i.doc_type === 'quote').length,
  }), [invoices])

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }
  const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14, width: '100%' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Invoices & Quotes</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{invoices.length} total · {filtered.length} shown</div>
        </div>
        <Btn onClick={() => navigate('/documents')}>+ New Invoice / Quote</Btn>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Invoiced',  value: fmt(stats.totalInvoiced),    color: C.accent  },
          { label: 'Total Paid',      value: fmt(stats.totalPaid),         color: C.greenDark },
          { label: 'Outstanding',     value: fmt(stats.totalOutstanding),  color: C.amber   },
          { label: 'Invoices',        value: stats.countInvoices,          color: C.purple  },
          { label: 'Quotes',          value: stats.countQuotes,            color: C.muted   },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 120, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: 22, fontWeight: 800 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by invoice #, client, address…"
          style={{ ...inp, flex: 1, minWidth: 200, width: 'auto' }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="all">All Types</option>
          <option value="invoice">Invoices</option>
          <option value="quote">Quotes</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="void">Void</option>
        </select>
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="all">All Companies</option>
          <option value="standard">Standard</option>
          <option value="remedials">Remedials</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No invoices yet.{' '}
            <button onClick={() => navigate('/documents')} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Create one →
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Type', 'Company', 'Client', 'Site', 'Total', 'Balance', 'Status', 'Created', 'Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const sc = STATUS_COLORS[inv.status] || { color: C.muted, bg: C.surface }
                return (
                  <tr key={inv.id}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}>
                      <span style={{ color: C.accent, fontWeight: 700, fontSize: 13 }}>{inv.invoice_number}</span>
                    </td>
                    <td style={td}>
                      <span style={{ background: inv.doc_type === 'invoice' ? C.purpleSoft : C.accentSoft, color: inv.doc_type === 'invoice' ? C.purple : C.accent, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>
                        {inv.doc_type}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 12, color: C.muted }}>
                        {inv.company === 'remedials' ? '🔨 Remedials' : '🏠 Standard'}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{inv.client_name || '—'}</div>
                      {inv.client_email && <div style={{ fontSize: 11, color: C.muted }}>{inv.client_email}</div>}
                    </td>
                    <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{inv.site_address || '—'}</span></td>
                    <td style={td}><span style={{ color: C.text, fontWeight: 600 }}>{fmt(inv.total)}</span></td>
                    <td style={td}>
                      <span style={{ color: inv.balance_due > 0 ? C.amber : C.greenDark, fontWeight: 600 }}>
                        {fmt(inv.doc_type === 'invoice' ? inv.balance_due : inv.total)}
                      </span>
                    </td>
                    <td style={td}>
                      <select value={inv.status} onChange={e => updateStatus(inv.id, e.target.value)}
                        style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.color}44`, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="paid">Paid</option>
                        <option value="void">Void</option>
                      </select>
                    </td>
                    <td style={td}>
                      <div style={{ fontSize: 12, color: C.dim }}>
                        {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </div>
                      <div style={{ fontSize: 11, color: C.dim }}>{inv.created_by_name}</div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={() => setPreview(inv)}
                          style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                          👁
                        </button>
                        <button onClick={() => printInvoice(inv)}
                          style={{ background: C.amberSoft, color: C.amber, border: `1px solid ${C.amber}44`, borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                          🖨
                        </button>
                        {isAdmin && (
                          <button onClick={() => deleteInvoice(inv)}
                            style={{ background: C.redSoft, color: C.red, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview Modal */}
      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000BB', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '32px 20px' }}
          onClick={() => setPreview(null)}>
          <div style={{ width: '100%', maxWidth: 760 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
                {preview.doc_type === 'invoice' ? 'Invoice' : 'Quote'} {preview.invoice_number}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => printInvoice(preview)} style={{ background: C.amber, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>🖨 Print / PDF</button>
                <button onClick={() => setPreview(null)} style={{ background: 'transparent', border: '1px solid #ffffff66', color: '#fff', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>Close</button>
              </div>
            </div>

            {/* Rendered preview */}
            <div style={{ background: '#fff', borderRadius: 4, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.4)', padding: '48px 52px', fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.6, color: '#111' }}>
              {(() => {
                const co = COMPANIES[preview.company] || COMPANIES.standard
                const fmt2 = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
                const lineItems = Array.isArray(preview.line_items) ? preview.line_items : []
                const isInvoice = preview.doc_type === 'invoice'
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, paddingBottom: 24, borderBottom: '2px solid #0093DB' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <img src={MLC_LOGO} alt="MLC" style={{ width: 80, height: 80, objectFit: 'contain' }} />
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: '#0093DB', marginBottom: 3 }}>{co.name}</div>
                          <div style={{ fontSize: 11, color: '#6B7280' }}>{co.address}</div>
                          <div style={{ fontSize: 11, color: '#6B7280' }}>{co.phone} · {co.email}</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Co. Reg: {co.reg}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: '#1F2937', marginBottom: 8 }}>{isInvoice ? 'TAX INVOICE' : 'QUOTE'}</div>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>#{preview.invoice_number}</div>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>{new Date(preview.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 28 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#0093DB', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Billed To</div>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{preview.client_name || '—'}</div>
                        {preview.client_address && <div style={{ fontSize: 12, color: '#6B7280' }}>{preview.client_address}</div>}
                        {preview.client_email   && <div style={{ fontSize: 12, color: '#6B7280' }}>{preview.client_email}</div>}
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#0093DB', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Job Details</div>
                        {preview.site_address   && <div style={{ fontSize: 12 }}><strong>Site:</strong> {preview.site_address}</div>}
                        {preview.work_completed && <div style={{ fontSize: 12 }}><strong>Services:</strong> {preview.work_completed}</div>}
                      </div>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
                      <thead>
                        <tr style={{ background: '#0093DB' }}>
                          {['Description','QTY','Unit Price','Total'].map((h, i) => (
                            <th key={h} style={{ padding: '10px 14px', textAlign: i === 0 ? 'left' : 'right', fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((l, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F5F7FA' }}>
                            <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{l.description}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{l.qty || 1}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, borderBottom: '1px solid #E5E7EB' }}>{fmt2(l.unit_price)}</td>
                            <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #E5E7EB' }}>{fmt2((l.qty || 1) * (l.unit_price || 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
                      <div style={{ width: 280 }}>
                        {[['SUBTOTAL', fmt2(preview.subtotal)], ['DISCOUNT', preview.discount > 0 ? `-${fmt2(preview.discount)}` : '£0.00'], ['TOTAL', fmt2(preview.total)], ...(isInvoice ? [['PAID', fmt2(preview.amount_paid)]] : [])].map(([l, v]) => (
                          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 14px', borderBottom: '1px solid #E5E7EB', fontSize: 13 }}>
                            <span style={{ color: '#6B7280' }}>{l}:</span><span>{v}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#0093DB', borderRadius: '0 0 6px 6px', fontSize: 15, fontWeight: 900, color: '#fff' }}>
                          <span>BALANCE DUE:</span><span>{fmt2(isInvoice ? preview.balance_due : preview.total)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16, fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: '#0093DB', marginBottom: 6 }}>Bank Details</div>
                      <div style={{ color: '#6B7280' }}>Account Name: {co.name} · Sort Code: {co.sort} · Account Number: {co.account}</div>
                      <div style={{ color: '#DC2626', fontWeight: 600, marginTop: 4 }}>Note: Please Put Invoice Number As Reference</div>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
