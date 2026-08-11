import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import SendEmailModal from '../components/SendEmailModal'
import { buildQuotePdf } from '../lib/generatePdf'
import { getCompany } from '../lib/companies'

export default function QuoteDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [quote, setQuote] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activity, setActivity] = useState([])
  const [showSend, setShowSend] = useState(false)
  const [toast, setToast] = useState(null)

  function showToast(msg, type='success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { fetchQuote() }, [id])

  async function fetchQuote() {
    const { data, error } = await supabase.from('quotes')
      .select('*, quote_line_items(*), jobs(id, job_number, site_address, service_types), clients(id, first_name, last_name, company_name, email, street_address, city, postcode)')
      .eq('id', id).single()
    if (error || !data) { setLoading(false); return }
    setQuote(data)
    setLineItems(data.quote_line_items || [])
    setLoading(false)

    const { data: acts } = await supabase.from('activity_log')
      .select('*').eq('entity_type', 'quote').eq('entity_id', id)
      .order('created_at', { ascending: false }).limit(20)
    setActivity(acts || [])
  }

  async function saveQuote() {
    setSaving(true)
    const subtotal = lineItems.reduce((s,i) => s + (i.quantity||1)*(i.unit_price||0), 0)

    // Update quote
    const { error } = await supabase.from('quotes').update({
      status: quote.status,
      valid_until: quote.valid_until || null,
      site_address: quote.site_address,
      notes: quote.notes,
      subtotal,
      company: quote.company || 'standard',
    }).eq('id', id)

    if (error) { setSaving(false); showToast(error.message, 'error'); return }

    // Replace line items
    await supabase.from('quote_line_items').delete().eq('quote_id', id)
    const validItems = lineItems.filter(i => i.description?.trim())
    if (validItems.length > 0) {
      await supabase.from('quote_line_items').insert(
        validItems.map(i => ({
          quote_id: id,
          description: i.description,
          quantity: i.quantity || 1,
          unit: i.unit || 'ea',
          unit_price: i.unit_price || 0,
          item_type: i.item_type || 'service',
        }))
      )
    }

    // Log activity
    try {
      await supabase.from('activity_log').insert({
        entity_type: 'quote', entity_id: id,
        action: 'updated',
        description: 'Quote edited by ' + (profile?.full_name || 'user'),
        performed_by: profile?.id,
        performed_by_name: profile?.full_name,
      })
    } catch(e) {}

    setSaving(false)
    showToast('Quote saved')
    fetchQuote()
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:'#9CA3AF' }}>Loading...</div>
  if (!quote) return <div style={{ padding:40, textAlign:'center', color:'#DC2626' }}>Quote not found</div>

  const clientName = quote.clients?.company_name ||
    [quote.clients?.first_name, quote.clients?.last_name].filter(Boolean).join(' ') || ''
  const clientAddr = [quote.clients?.street_address, quote.clients?.city, quote.clients?.postcode].filter(Boolean).join(', ')
  const subtotal = lineItems.reduce((s,i) => s + (i.quantity||1)*(i.unit_price||0), 0)

  const lbl = { color:'#6B7280', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:4 }
  const inp = { width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'9px 12px', fontSize:14, color:'#1F2937' }

  const statusColors = { Draft:'#6B7280', Sent:'#0093DB', Accepted:'#3d7a00', Declined:'#DC2626', Expired:'#D97706' }
  const sc = statusColors[quote.status] || '#6B7280'

  return (
    <div style={{ maxWidth:900, margin:'0 auto' }}>
      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:999, background: toast.type==='error'?'#FEE2E2':'#F0FAE0', color: toast.type==='error'?'#DC2626':'#3d7a00', border:`1px solid ${toast.type==='error'?'#DC262644':'#80D10066'}`, borderRadius:10, padding:'12px 20px', fontWeight:600, fontSize:14, boxShadow:'0 4px 20px rgba(0,0,0,0.1)' }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <div>
          <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', color:'#0093DB', cursor:'pointer', fontSize:13, marginBottom:4, display:'block' }}>← Back</button>
          <h1 style={{ fontSize:22, fontWeight:700, margin:0 }}>Quote {quote.quote_number}</h1>
          <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ background:sc+'18', color:sc, borderRadius:6, padding:'3px 10px', fontSize:12, fontWeight:700 }}>{quote.status}</span>
            <span style={{ fontSize:12, color:'#9CA3AF' }}>Valid until: {quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : 'Not set'}</span>
            {[['standard','🏠 Standard'], ['remedials','🔨 Remedials']].map(([key, label]) => (
              <button key={key} onClick={() => setQuote(p => ({ ...p, company: key }))}
                style={{ padding:'3px 10px', borderRadius:6, border: (quote.company||'standard') === key ? '2px solid #0093DB' : '1px solid #E5E7EB',
                  background: (quote.company||'standard') === key ? '#E6F4FC' : '#fff',
                  color: (quote.company||'standard') === key ? '#0093DB' : '#6B7280',
                  fontSize:11, fontWeight:700, cursor:'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={saveQuote} disabled={saving}
            style={{ background:'#0093DB', color:'#fff', border:'none', borderRadius:8, padding:'9px 20px', fontWeight:700, fontSize:14, cursor:'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={() => {
            const { doc } = buildQuotePdf({
              quoteNumber: quote.quote_number,
              date: quote.created_at,
              validUntil: quote.valid_until,
              clientName: quote.clients?.company_name ||
                [quote.clients?.first_name, quote.clients?.last_name].filter(Boolean).join(' ') || 'Customer',
              clientAddress: [quote.clients?.street_address, quote.clients?.city, quote.clients?.postcode].filter(Boolean).join(', '),
              clientEmail: quote.clients?.email || '',
              siteAddress: quote.site_address || '',
              services: quote.jobs?.service_types || '',
              lineItems: lineItems,
              total: lineItems.reduce((s,i) => s + (i.quantity||1)*(i.unit_price||0), 0),
              notes: quote.notes,
              company: quote.company || 'standard',
            })
            // Open PDF in new tab
            const pdfUrl = doc.output('bloburl')
            window.open(pdfUrl, '_blank')
          }}
            style={{ background:'#F5F7FA', color:'#1F2937', border:'1px solid #E5E7EB', borderRadius:8, padding:'9px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            👁 View PDF
          </button>
          <button onClick={() => {
            const { doc, filename } = buildQuotePdf({
              quoteNumber: quote.quote_number,
              date: quote.created_at,
              validUntil: quote.valid_until,
              clientName: quote.clients?.company_name ||
                [quote.clients?.first_name, quote.clients?.last_name].filter(Boolean).join(' ') || 'Customer',
              clientAddress: [quote.clients?.street_address, quote.clients?.city, quote.clients?.postcode].filter(Boolean).join(', '),
              clientEmail: quote.clients?.email || '',
              siteAddress: quote.site_address || '',
              services: quote.jobs?.service_types || '',
              lineItems: lineItems,
              total: lineItems.reduce((s,i) => s + (i.quantity||1)*(i.unit_price||0), 0),
              notes: quote.notes,
              company: quote.company || 'standard',
            })
            doc.save(filename)
          }}
            style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:8, padding:'9px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            ⬇ Download PDF
          </button>
          <button onClick={() => setShowSend(true)}
            style={{ background:'#F0FAE0', color:'#3d7a00', border:'1px solid #80D10066', borderRadius:8, padding:'9px 16px', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            Send Quote
          </button>
          <button onClick={async () => {
            if (!window.confirm('Delete quote ' + quote.quote_number + '?')) return
            await supabase.from('quote_line_items').delete().eq('quote_id', id)
            await supabase.from('quotes').delete().eq('id', id)
            navigate('/invoices')
          }} style={{ background:'#FEE2E2', color:'#DC2626', border:'1px solid #DC262644', borderRadius:8, padding:'9px 14px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:20 }}>
        {/* LEFT */}
        <div>
          {/* Quote meta */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div><label style={lbl}>Quote Number</label>
                <div style={{ padding:'9px 12px', background:'#F5F7FA', borderRadius:8, fontSize:14, fontWeight:700 }}>{quote.quote_number}</div>
              </div>
              <div><label style={lbl}>Created</label>
                <div style={{ padding:'9px 12px', background:'#F5F7FA', borderRadius:8, fontSize:14 }}>{new Date(quote.created_at).toLocaleDateString('en-GB')}</div>
              </div>
              <div><label style={lbl}>Status</label>
                <select value={quote.status} onChange={e => setQuote(p=>({...p, status:e.target.value}))} style={inp}>
                  {['Draft','Sent','Accepted','Declined','Expired'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Valid Until</label>
                <input type="date" value={quote.valid_until||''} onChange={e => setQuote(p=>({...p, valid_until:e.target.value}))} style={inp} />
              </div>
              <div><label style={lbl}>Linked Job</label>
                <div style={{ padding:'9px 12px', background:'#F5F7FA', borderRadius:8, fontSize:13 }}>
                  {quote.jobs ? <a href={'/jobs/'+quote.jobs.id} style={{ color:'#0093DB' }}>{quote.jobs.job_number}</a> : '— Not linked —'}
                </div>
              </div>
              <div><label style={lbl}>Client</label>
                <div style={{ padding:'9px 12px', background:'#F5F7FA', borderRadius:8, fontSize:13 }}>
                  {quote.clients ? <a href={'/clients/'+quote.clients.id} style={{ color:'#0093DB' }}>{clientName}</a> : '—'}
                </div>
              </div>
              <div style={{ gridColumn:'span 2' }}><label style={lbl}>Site Address</label>
                <input value={quote.site_address||''} onChange={e => setQuote(p=>({...p, site_address:e.target.value}))} style={inp} />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24, marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', margin:0 }}>Line Items</h3>
              <button onClick={() => setLineItems(p => [...p, { description:'', quantity:1, unit_price:0, unit:'ea', item_type:'service' }])}
                style={{ background:'#E6F4FC', color:'#0093DB', border:'1px solid #0093DB44', borderRadius:6, padding:'4px 12px', fontSize:12, cursor:'pointer', fontWeight:600 }}>
                + Add Item
              </button>
            </div>

            {/* Header row */}
            {lineItems.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'2fr 60px 90px 28px', gap:8, marginBottom:6 }}>
                {['Description','Qty','Unit Price',''].map(h => (
                  <div key={h} style={{ fontSize:10, fontWeight:700, color:'#9CA3AF', textTransform:'uppercase', padding:'0 2px' }}>{h}</div>
                ))}
              </div>
            )}

            {lineItems.map((item, idx) => (
              <div key={idx} style={{ display:'grid', gridTemplateColumns:'2fr 60px 90px 28px', gap:8, marginBottom:8 }}>
                <textarea value={item.description||''} placeholder="Description of work..."
                  rows={2}
                  onChange={e => setLineItems(p => p.map((x,i)=>i===idx?{...x,description:e.target.value}:x))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px 10px', fontSize:12, fontFamily:'inherit', resize:'vertical' }} />
                <input type="number" value={item.quantity||1} min="1"
                  onChange={e => setLineItems(p => p.map((x,i)=>i===idx?{...x,quantity:parseInt(e.target.value)||1}:x))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px', fontSize:13, textAlign:'center' }} />
                <input type="number" step="0.01" value={item.unit_price||''} placeholder="0.00"
                  onChange={e => setLineItems(p => p.map((x,i)=>i===idx?{...x,unit_price:parseFloat(e.target.value)||0}:x))}
                  style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:6, padding:'7px', fontSize:13 }} />
                <button onClick={() => setLineItems(p => p.filter((_,i)=>i!==idx))}
                  style={{ background:'none', border:'none', color:'#DC2626', cursor:'pointer', fontSize:16 }}>✕</button>
              </div>
            ))}

            {lineItems.length === 0 && (
              <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', padding:'20px 0', border:'2px dashed #E5E7EB', borderRadius:8 }}>
                No items. Click + Add Item to begin.
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:24, marginTop:12, paddingTop:12, borderTop:'1px solid #E5E7EB' }}>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:4 }}>Subtotal</div>
                <div style={{ fontSize:14, fontWeight:600 }}>£{subtotal.toFixed(2)}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:12, color:'#9CA3AF', marginBottom:4 }}>Total</div>
                <div style={{ fontSize:18, fontWeight:800, color:'#0093DB' }}>£{subtotal.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:24 }}>
            <label style={lbl}>Notes</label>
            <textarea value={quote.notes||''} onChange={e => setQuote(p=>({...p, notes:e.target.value}))} rows={4}
              placeholder="Any additional notes for the client..."
              style={{ ...inp, fontFamily:'inherit', resize:'vertical' }} />
          </div>
        </div>

        {/* RIGHT — Activity */}
        <div>
          {/* Quick stats */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20, marginBottom:16 }}>
            <div style={{ textAlign:'center', marginBottom:12 }}>
              <div style={{ fontSize:28, fontWeight:800, color:'#0093DB' }}>£{subtotal.toFixed(2)}</div>
              <div style={{ fontSize:12, color:'#9CA3AF' }}>Quote Total</div>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#6B7280' }}>
              <span>{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</span>
              <span style={{ color:sc, fontWeight:600 }}>{quote.status}</span>
            </div>
            {quote.clients?.email && (
              <div style={{ marginTop:10, padding:'8px 10px', background:'#F5F7FA', borderRadius:8, fontSize:12 }}>
                <span style={{ color:'#9CA3AF' }}>Client: </span>
                <a href={'mailto:'+quote.clients.email} style={{ color:'#0093DB' }}>{quote.clients.email}</a>
              </div>
            )}
          </div>

          {/* Activity log */}
          <div style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:12, padding:20 }}>
            <h3 style={{ fontSize:13, fontWeight:700, color:'#6B7280', textTransform:'uppercase', marginBottom:14 }}>Activity</h3>

            {/* Manual note input */}
            <input placeholder="Add a note (press Enter)..."
              onKeyDown={async e => {
                if (e.key !== 'Enter' || !e.target.value.trim()) return
                const note = e.target.value.trim()
                try {
                  await supabase.from('activity_log').insert({
                    entity_type: 'quote', entity_id: id,
                    action: 'note', description: note,
                    performed_by: profile?.id, performed_by_name: profile?.full_name,
                  })
                } catch(err) {}
                e.target.value = ''
                fetchQuote()
              }}
              style={{ width:'100%', background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'8px 12px', fontSize:12, marginBottom:12 }} />

            {activity.length === 0 ? (
              <div style={{ color:'#9CA3AF', fontSize:13, textAlign:'center', padding:'16px 0' }}>No activity yet</div>
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
        <SendEmailModal
          title="Send Quote"
          to={quote.clients?.email || ''}
          subject={'Quote ' + quote.quote_number + ' -- My Landlord Certificate'}
          body={'Dear ' + clientName + ',\n\nPlease find attached your quote ' + quote.quote_number + ' for the services requested.\n\nQuote Details:\nQuote Number: ' + quote.quote_number + '\nDate: ' + new Date().toLocaleDateString('en-GB') + '\nValid Until: ' + (quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : 'N/A') + '\nSite: ' + (quote.site_address || '') + '\n\nTotal: GBP' + subtotal.toFixed(2) + '\n\nTo accept this quote, please reply to this email or call us on 020 3996 1070.\n\nKind Regards,\nMy Landlord Certificate\n020 3996 1070\ninfo@mylandlordcertificate.co.uk'}
          variables={{ name: clientName }}
          buildAttachment={() => {
            const { base64, filename } = buildQuotePdf({
              quoteNumber: quote.quote_number,
              date: quote.created_at,
              validUntil: quote.valid_until,
              clientName, clientAddress: clientAddr,
              clientEmail: quote.clients?.email || '',
              siteAddress: quote.site_address,
              services: quote.jobs?.service_types || '',
              lineItems,
              total: subtotal,
              notes: quote.notes,
              company: quote.company || 'standard',
            })
            return { base64, filename, mime: 'application/pdf' }
          }}
          onClose={() => setShowSend(false)}
          onSent={async () => {
            try { await supabase.from('quotes').update({ status:'Sent', sent_at: new Date().toISOString() }).eq('id', id) } catch(e) {}
            showToast('Quote sent')
            setShowSend(false)
            fetchQuote()
          }}
        />
      )}
    </div>
  )
}
