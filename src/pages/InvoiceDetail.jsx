import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import SendEmailModal from '../components/SendEmailModal'
import { buildInvoicePdf } from '../lib/generatePdf'
import { getCompany } from '../lib/companies'

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [inv, setInv] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activity, setActivity] = useState([])
  const [showSend, setShowSend] = useState(false)
  const [sendSubject, setSendSubject] = useState('')
  const [sendBody, setSendBody] = useState('')

  async function getTemplate(name) {
    const { data } = await supabase.from('email_templates')
      .select('subject, body').eq('name', name).single()
    return data
  }

  useEffect(() => { fetchInvoice() }, [id])

  async function fetchInvoice() {
    const { data } = await supabase.from('invoices')
      .select('*, jobs(id, job_number, site_address, service_types, clients(*))')
      .eq('id', id).single()
    setInv(data)
    setLoading(false)
    // Fetch activity
    const { data: acts } = await supabase.from('activity_log')
      .select('*').eq('entity_type', 'invoice').eq('entity_id', id)
      .order('created_at', { ascending: false }).limit(20)
    setActivity(acts || [])
  }

  async function saveInvoice() {
    setSaving(true)
    const { error } = await supabase.from('invoices').update({
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      client_email: inv.client_email,
      client_address: inv.client_address,
      site_address: inv.site_address,
      work_completed: inv.work_completed,
      line_items: inv.line_items,
      subtotal: inv.subtotal,
      total: inv.total,
      balance_due: inv.balance_due,
      amount_paid: inv.amount_paid || 0,
      payment_notes: inv.payment_notes,
      status: inv.status,
      date: inv.date,
      notes: inv.notes,
      company: inv.company || 'standard',
    }).eq('id', id)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    // Log manual save as activity
    try {
      await supabase.from('activity_log').insert({
        entity_type: 'invoice', entity_id: id,
        action: 'updated', description: 'Invoice edited by ' + (profile?.full_name || 'user'),
        performed_by: profile?.id, performed_by_name: profile?.full_name,
      })
    } catch (e) {}
    showToast('Invoice saved')
    fetchInvoice()
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'#9CA3AF' }}>Loading...</div>
  if (!inv) return <div style={{ padding:40, textAlign:'center', color:'#DC2626' }}>Invoice not found</div>

  const lbl = { color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:4 }
  const inp = { width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'9px 12px', fontSize:14, color:'#1F2937' }

  return (
    <div style={{ maxWidth:900, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <div>
          <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', color:'#0093DB', cursor:'pointer', fontSize:13, marginBottom:4 }}>← Back</button>
          <h1 style={{ fontSize:22, fontWeight:700, margin:0 }}>Invoice {inv.invoice_number}</h1>
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            {[['standard','🏠 Standard'], ['remedials','🔨 Remedials']].map(([key, label]) => (
              <button key={key} onClick={() => setInv(p => ({ ...p, company: key }))}
                style={{ padding:'4px 10px', borderRadius:6, border: (inv.company||'standard') === key ? '2px solid #0093DB' : '1px solid #E5E7EB',
                  background: (inv.company||'standard') === key ? '#E6F4FC' : '#fff',
                  color: (inv.company||'standard') === key ? '#0093DB' : '#6B7280',
                  fontSize:11, fontWeight:700, cursor:'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={saveInvoice} disabled={saving}
            style={{ background:'#0093DB', color:'#fff', border:'none', borderRadius:8, padding:'9px 20px', fontWeight:700, fontSize:14, cursor:'pointer' }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => {
            const { doc } = buildInvoicePdf({
              invoiceNumber: inv.invoice_number,
              date: inv.date || inv.created_at,
              clientName: inv.client_name,
              clientAddress: inv.client_address,
              clientEmail: inv.client_email,
              siteAddress: inv.site_address,
              services: inv.work_completed,
              lineItems: inv.line_items || [],
              total: inv.total,
              paid: inv.amount_paid || 0,
              company: inv.company || 'standard',
            })
            window.open(doc.output('bloburl'), '_blank')
          }}
            style={{ background:'#F5F7FA', color:'#1F2937', border:'1px solid #E5E7EB', borderRadius:8, padding:'9px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            👁 View PDF
          </button>
          <button onClick={() => {
            const { doc, filename } = buildInvoicePdf({
              invoiceNumber: inv.invoice_number,
              date: inv.date || inv.created_at,
              clientName: inv.client_name,
              clientAddress: inv.client_address,
              clientEmail: inv.client_email,
              siteAddress: inv.site_address,
              services: inv.work_completed,
              lineItems: inv.line_items || [],
              total: inv.total,
              paid: inv.amount_paid || 0,
              company: inv.company || 'standard',
            })
            doc.save(filename)
          }}
            style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:8, padding:'9px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            ⬇ Download PDF
          </button>
          <button onClick={async () => {
            const tpl = await getTemplate('Invoice Email')
            const greeting = new Date().getHours() < 12 ? 'Good Morning' : 'Good Afternoon'
            const vars = {
              name: inv.client_name || 'Customer',
              inspection_name: inv.work_completed || '',
              property_address: inv.site_address || '',
              rep_name: profile?.full_name || 'My Landlord Certificate',
            }
            let subject = tpl?.subject || 'Your Invoice'
            let body = tpl?.body || ''
            for (const [k,v] of Object.entries(vars)) {
              subject = subject.replace(new RegExp('{{'+k+'}}','gi'), v)
              body = body.replace(new RegExp('{{'+k+'}}','gi'), v)
            }
            body = body.replace(/Good Morning\/Afternoon/g, greeting)
            subject = subject.replace(/Good Morning\/Afternoon/g, greeting)
            setSendSubject(subject)
            setSendBody(body)
            setShowSend(true)
          }}
            style={{ background:'#F0FAE0', color:'#3d7a00', border:'1px solid #80D10066', borderRadius:8, padding:'9px 16px', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            Send Invoice
          </button>
          <button onClick={async () => {
            if (!window.confirm('Delete this invoice?')) return
            await supabase.from('invoices').delete().eq('id', id)
            navigate('/invoices')
            showToast('Deleted')
          }} style={{ background:'#FEE2E2', color:'#DC2626', border:'1px solid #DC262644', borderRadius:8, padding:'9px 14px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:20 }}>
        {/* LEFT — Invoice form */}
        <div>
          {/* Invoice details card */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div><label style={lbl}>Invoice Number</label>
                <input value={inv.invoice_number||''} onChange={e => setInv(p=>({...p, invoice_number:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Date</label>
                <input type="date" value={inv.date||''} onChange={e => setInv(p=>({...p, date:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Status</label>
                <select value={inv.status} onChange={e => setInv(p=>({...p, status:e.target.value}))} style={inp}>
                  <option>Draft</option><option>Sent</option><option>Paid</option>
                  <option>Partial Paid</option><option>Overdue</option><option>Cancelled</option>
                </select></div>
              <div><label style={lbl}>Linked Job</label>
                <div style={{ padding:'9px 12px', background:'#F5F7FA', borderRadius:8, fontSize:13 }}>
                  {inv.jobs ? <a href={'/jobs/'+inv.jobs.id} style={{ color:'#0093DB' }}>{inv.jobs.job_number}</a> : '— Not linked —'}
                </div></div>
            </div>
          </div>

          {/* Client details card */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', marginBottom:14 }}>Client Details</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div style={{ gridColumn:'span 2' }}><label style={lbl}>Client Name</label>
                <input value={inv.client_name||''} onChange={e => setInv(p=>({...p, client_name:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Client Email</label>
                <input value={inv.client_email||''} onChange={e => setInv(p=>({...p, client_email:e.target.value}))} style={inp} /></div>
              <div><label style={lbl}>Site Address</label>
                <input value={inv.site_address||''} onChange={e => setInv(p=>({...p, site_address:e.target.value}))} style={inp} /></div>
              <div style={{ gridColumn:'span 2' }}><label style={lbl}>Client Address</label>
                <input value={inv.client_address||''} onChange={e => setInv(p=>({...p, client_address:e.target.value}))} style={inp} /></div>
              <div style={{ gridColumn:'span 2' }}><label style={lbl}>Services</label>
                <input value={inv.work_completed||''} onChange={e => setInv(p=>({...p, work_completed:e.target.value}))} style={inp} /></div>
            </div>
          </div>

          {/* Line items card */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14 }}>
              <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', margin:0 }}>Line Items</h3>
              <button onClick={() => setInv(p => ({...p, line_items:[...(p.line_items||[]), {description:'',qty:1,unit_price:0}]}))}
                style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>+ Add Item</button>
            </div>
            {(inv.line_items||[]).map((item, idx) => (
              <div key={idx} style={{ display:'grid', gridTemplateColumns:'2fr 60px 90px 28px', gap:8, marginBottom:8 }}>
                <input value={item.description||''} placeholder="Description"
                  onChange={e => setInv(p => ({...p, line_items:p.line_items.map((x,i)=>i===idx?{...x,description:e.target.value}:x)}))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px 10px', fontSize:13 }} />
                <input type="number" value={item.qty||1} min="1"
                  onChange={e => setInv(p => ({...p, line_items:p.line_items.map((x,i)=>i===idx?{...x,qty:parseInt(e.target.value)||1}:x)}))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px', fontSize:13, textAlign:'center' }} />
                <input type="number" step="0.01" value={item.unit_price||''} placeholder="Price"
                  onChange={e => setInv(p => ({...p, line_items:p.line_items.map((x,i)=>i===idx?{...x,unit_price:parseFloat(e.target.value)||0}:x)}))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px', fontSize:13 }} />
                <button onClick={() => setInv(p => ({...p, line_items:p.line_items.filter((_,i)=>i!==idx)}))}
                  style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontSize:16 }}>x</button>
              </div>
            ))}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:20, marginTop:12, paddingTop:12, borderTop:'1px solid #E5E7EB' }}>
              <span style={{ fontSize:13, color:'#6B7280' }}>Subtotal: £{(inv.line_items||[]).reduce((s,i)=>(s+(i.qty||1)*(i.unit_price||0)),0).toFixed(2)}</span>
              <span style={{ fontSize:15, fontWeight:800, color:'#0093DB' }}>Total: £{Number(inv.total||0).toFixed(2)}</span>
            </div>
          </div>

          {/* Payment tracking */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', marginBottom:14 }}>Payment</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
              <div><label style={lbl}>Total (GBP)</label>
                <input type="number" step="0.01" value={inv.total||''} onChange={e => setInv(p=>({...p, total:parseFloat(e.target.value)||0, balance_due:(parseFloat(e.target.value)||0)-(p.amount_paid||0)}))} style={inp} /></div>
              <div><label style={lbl}>Amount Paid (GBP)</label>
                <input type="number" step="0.01" value={inv.amount_paid||''} onChange={e => setInv(p=>({...p, amount_paid:parseFloat(e.target.value)||0, balance_due:(p.total||0)-(parseFloat(e.target.value)||0)}))} style={inp} /></div>
              <div><label style={lbl}>Balance Due (GBP)</label>
                <div style={{ padding:'9px 12px', background:'#FEF3C7', borderRadius:8, fontSize:15, fontWeight:800, color: (inv.total||0)-(inv.amount_paid||0) > 0 ? '#DC2626' : '#3d7a00' }}>
                  £{((inv.total||0)-(inv.amount_paid||0)).toFixed(2)}
                </div></div>
            </div>
            <div style={{ marginTop:10 }}><label style={lbl}>Payment Notes</label>
              <textarea value={inv.payment_notes||''} onChange={e => setInv(p=>({...p, payment_notes:e.target.value}))} rows={2}
                placeholder="e.g. Paid via bank transfer on 05/08/2026, Ref: INV-001"
                style={{ ...inp, fontFamily:'inherit', resize:'vertical' }} /></div>
          </div>

          {/* Notes */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24 }}>
            <label style={lbl}>Notes</label>
            <textarea value={inv.notes||''} onChange={e => setInv(p=>({...p, notes:e.target.value}))} rows={3}
              style={{ ...inp, fontFamily:'inherit', resize:'vertical' }} />
          </div>
        </div>

        {/* RIGHT — Activity log */}
        <div>
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20 }}>
            <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', marginBottom:14 }}>Activity Log</h3>
            {activity.length === 0 ? (
              <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', padding:'20px 0' }}>No activity yet</div>
            ) : activity.map(a => (
              <div key={a.id} style={{ padding:'8px 0', borderBottom:'1px solid #F5F7FA', fontSize:12 }}>
                <div style={{ color:'#1F2937', fontWeight:500 }}>{a.description || a.action}</div>
                <div style={{ color:'#9CA3AF', fontSize:11, marginTop:2 }}>
                  {a.performed_by_name ? a.performed_by_name + ' · ' : ''}{new Date(a.created_at).toLocaleString('en-GB')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Send modal */}
      {showSend && (
        <SendEmailModal title="Send Invoice" to={inv.client_email||''}
          subject={sendSubject || ('Invoice ' + (inv.invoice_number||'') + ' -- My Landlord Certificate')}
          body={sendBody || (() => {
            const co = getCompany(inv.company)
            return 'Dear ' + (inv.client_name||'Customer') + ',\n\nPlease find attached invoice ' + (inv.invoice_number||'') + '.\n\nAmount Due: GBP' + Number(inv.total||0).toFixed(2) + '\n\nPayment by bank transfer to:\nBank: ' + co.bankAccountName + '\nSort Code: ' + co.sortCode + '\nAccount: ' + co.accountNumber + '\nReference: ' + (inv.invoice_number||'') + '\n\nKind Regards,\nMy Landlord Certificate\n020 3996 1070\ninfo@mylandlordcertificate.co.uk'
          })()}
          variables={{ name: inv.client_name || 'Customer' }}
          buildAttachment={() => {
            const { base64, filename } = buildInvoicePdf({
              invoiceNumber: inv.invoice_number, date: inv.date,
              clientName: inv.client_name, clientAddress: inv.client_address,
              clientEmail: inv.client_email, siteAddress: inv.site_address,
              services: inv.work_completed, lineItems: inv.line_items || [],
              total: inv.total, paid: inv.amount_paid || 0,
              company: inv.company || 'standard',
            })
            return { base64, filename, mime: 'application/pdf' }
          }}
          onClose={() => setShowSend(false)}
          onSent={async () => {
            await supabase.from('invoices').update({ status:'Sent', sent_at: new Date().toISOString() }).eq('id', id)
            showToast('Invoice sent'); setShowSend(false); fetchInvoice()
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
