// Inbound Booking Webhook — receives bookings from MLC website form
// Creates a lead in the platform, triggers notifications,
// and auto-converts paid bookings to clients+jobs (see convertLeadToClient below)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Mirrors convertToClient/autoCreateJobs in src/pages/Leads.jsx — keep in sync
// if that logic changes. Runs server-side so paid website bookings convert
// immediately, without needing anyone to click "Accepted" in the Leads UI.
async function convertLeadToClient(lead: any, servicesData: { name: string; price: number }[]) {
  const { data: client, error } = await supabase.from('clients').insert({
    client_type: 'Landlord',
    company_name: null,
    first_name: lead.inbound_name ? lead.inbound_name.split(' ')[0] : null,
    last_name: lead.inbound_name ? lead.inbound_name.split(' ').slice(1).join(' ') : null,
    email: lead.inbound_email,
    phone: lead.inbound_phone,
    street_address: lead.street_address,
    city: lead.city,
    postcode: lead.postcode,
    source: 'converted-lead',
    lead_id: lead.id,
    assigned_to: lead.assigned_to || null,
    status: 'Active',
  }).select().single()

  if (error || !client) {
    console.error('Auto-convert client error:', error)
    return null
  }

  if (!servicesData.length) return { client, job: null }

  const siteAddress = [lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ')
  const { data: job } = await supabase.from('jobs').insert({
    client_id: client.id,
    lead_id: lead.id,
    title: servicesData.map(s => s.name.split('—')[0].trim()).join(' + '),
    service_types: servicesData.map(s => s.name),
    site_address: siteAddress,
    site_postcode: lead.postcode,
    scheduled_date: lead.appointment_date,
    scheduled_slot: lead.time_slot,
    status: 'Scheduled',
    payment_status: 'Paid',
    payment_amount: lead.total_price,
    invoice_amount: lead.total_price,
    quoted_amount: lead.total_price,
    source: 'inbound-form',
    assigned_to: lead.assigned_to || null,
  }).select().single()

  if (job) {
    await supabase.from('job_line_items').insert(
      servicesData.map(s => ({
        job_id: job.id,
        description: s.name,
        item_type: 'certificate',
        quantity: 1,
        unit: 'ea',
        unit_price: s.price,
      }))
    )
  }

  return { client, job }
}

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let data: any
  try {
    data = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Inbound booking received:', JSON.stringify(data))

  // ── Extract fields (same structure as the Apps Script) ────
  const customerName = data.customer?.name || data.name || ''
  const customerEmail = data.customer?.email || data.email || ''
  const customerPhone = data.customer?.phone || data.phone || ''
  const tenantPhone = data.customer?.tenantPhone || data.tenantPhone || ''
  const streetAddress = data.property?.streetAddress || data.addressLine1 || ''
  const city = data.property?.city || data.city || ''
  const postcode = data.property?.postcode || data.postcode || ''
  const appointmentDate = data.appointment?.date || data.preferredDate || null
  const timeSlot = data.appointment?.timeSlot || data.timePreference || ''
  const propertyType = data.propertyType || data.propertyCategory || ''
  const propertySubType = data.propertySubType || data.propertySize || ''
  const paymentStatus = data.paymentStatus || 'Unpaid'
  const formStatus = data.status || 'New'
  const totalPrice = data.totalPrice ? parseFloat(data.totalPrice) : null
  const sessionId = data.sessionId || ''

  // ── Build services readable string ────────────────────────
  const SERVICE_NAMES: Record<string, string> = {
    'eicr': 'EICR', 'commercial-eicr': 'Commercial EICR',
    'gas-safety-cp12': 'Gas Safety Certificate (CP12)', 'gas-safety': 'Gas Safety Certificate (CP12)',
    'gas-safety-cp42': 'Commercial Gas Safety (CP42)',
    'epc': 'EPC', 'commercial-epc': 'Commercial EPC',
    'fra-residential': 'Fire Risk Assessment', 'fra-commercial': 'Fire Risk Assessment (Commercial)',
    'fire-safety-cert': 'Fire Safety Certificate', 'fire-alarm': 'Fire Alarm Installation',
    'fire-alarm-installation': 'Fire Alarm Installation',
    'fire-door': 'Fire Door Certificate', 'fire-door-cert': 'Fire Door Certificate',
    'fire-extinguisher': 'Fire Extinguisher Testing',
    'pat': 'PAT Testing', 'elc': 'Emergency Lights Certificate',
    'asbestos': 'Asbestos Survey', 'asbestos-survey': 'Asbestos Survey',
    'fuse-box': 'Fuse Box Installation', 'electrical-diagnostic': 'Electrical Diagnostic',
    'boiler-installation': 'Boiler Installation',
  }

  // servicesData keeps structured {name, price} for job/line-item creation;
  // servicesReadable is the human-readable string stored on the lead.
  const servicesData = (data.services || []).map((s: any) => {
    const price = s.price ? parseFloat(s.price) : 0
    if (s.label && s.label.includes(' — ')) {
      return { name: s.label, price }
    }
    const name = SERVICE_NAMES[s.type] || SERVICE_NAMES[s.id] || s.type || ''
    const variant = s.variant || ''
    const fullLabel = variant && variant !== name ? `${name} — ${variant}` : name
    return { name: fullLabel, price }
  })

  const servicesReadable = servicesData
    .map(s => s.name + (s.price ? ` (£${s.price.toFixed(2)})` : ''))
    .join(', ')

  // ── Additional charges ────────────────────────────────────
  const charges: string[] = []
  if (data.additionalCharges?.congestionCharge) charges.push('Congestion Zone (£20.00)')
  if (data.additionalCharges?.parkingCharge) charges.push('No Free Parking (£10.00)')
  const additionalCharges = charges.length > 0 ? charges.join(', ') : 'None'

  // ── Skip partial form fills — only create lead for meaningful statuses ──
  const isPartial = formStatus.includes('Partial')
  if (isPartial) {
    // Don't create a lead for partial fills — just acknowledge
    return new Response(JSON.stringify({ ok: true, action: 'skipped_partial' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // ── Determine platform lead status ────────────────────────
  // Map website status → platform status
  let leadStatus = 'New'
  if (paymentStatus.toLowerCase() === 'paid') {
    leadStatus = 'Accepted'  // triggers convertLeadToClient below
  } else if (formStatus === 'Pending Payment' || formStatus === 'Abandoned — Reached Review') {
    leadStatus = 'Contacted'  // They've engaged but not paid
  } else if (formStatus === 'Saved Quote — Follow Up') {
    leadStatus = 'In Discussion'
  }

  // ── Check for existing lead with same sessionId to avoid duplicates ──
  let existingLead = null
  if (sessionId) {
    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('source', sessionId)
      .limit(1)
    if (existing?.length) {
      existingLead = existing[0]
    }
  }

  const leadPayload = {
    lead_type: 'inbound',
    inbound_name: customerName,
    inbound_email: customerEmail,
    inbound_phone: customerPhone,
    tenant_phone: tenantPhone,
    street_address: streetAddress,
    city,
    postcode,
    property_type: propertyType,
    property_subtype: propertySubType,
    services_requested: servicesReadable,
    additional_charges: additionalCharges,
    appointment_date: appointmentDate || null,
    time_slot: timeSlot,
    total_price: totalPrice,
    payment_status: paymentStatus,
    status: leadStatus,
    source: sessionId || 'website-form',
    notes: `Website booking · Status: ${formStatus} · Session: ${sessionId}`,
  }

  let leadId: string

  if (existingLead) {
    // Update existing lead (e.g. they went from Pending → Paid)
    const { error } = await supabase
      .from('leads')
      .update(leadPayload)
      .eq('id', existingLead.id)
    if (error) {
      console.error('Update lead error:', error)
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }
    leadId = existingLead.id
  } else {
    // Create new lead
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert(leadPayload)
      .select('id')
      .single()
    if (error) {
      console.error('Insert lead error:', error)
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }
    leadId = newLead.id
  }

  // ── Auto-convert paid bookings to client + job ─────────────
  // Only on the transition into 'Accepted' — a resent webhook for an
  // already-accepted lead must not create duplicate clients/jobs.
  if (leadStatus === 'Accepted' && existingLead?.status !== 'Accepted') {
    await convertLeadToClient({ ...leadPayload, id: leadId }, servicesData)
  }

  // ── Create notification ───────────────────────────────────
  const notifTitle = paymentStatus.toLowerCase() === 'paid'
    ? `✅ New PAID booking — ${customerName}`
    : formStatus === 'Pending Payment'
    ? `⏳ Checkout started — ${customerName}`
    : formStatus.includes('Abandoned')
    ? `👀 Abandoned at review — ${customerName}`
    : formStatus.includes('Saved Quote')
    ? `💾 Saved quote — ${customerName}`
    : `📋 New inbound lead — ${customerName}`

  await supabase.from('notifications').insert({
    type: 'system',
    title: notifTitle,
    body: `${servicesReadable || 'No services'} · £${totalPrice || 0} · ${streetAddress}, ${postcode}`,
    link: `/leads/${leadId}`,
  })

  // ── Log activity ──────────────────────────────────────────
  await supabase.from('activities').insert({
    lead_id: leadId,
    rep_name: 'System',
    activity_type: 'system',
    title: `Website booking received — ${formStatus}`,
    body: `${customerName} · ${servicesReadable} · £${totalPrice || 0} · Payment: ${paymentStatus}`,
    metadata: {
      session_id: sessionId,
      form_status: formStatus,
      payment_status: paymentStatus,
      source: 'website-form',
    },
  })

  return new Response(JSON.stringify({
    ok: true,
    lead_id: leadId,
    status: leadStatus,
    action: existingLead ? 'updated' : 'created',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
