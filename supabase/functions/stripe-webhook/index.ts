import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// IMPORTANT: this must be the *webhook signing secret* from Stripe Dashboard
// -> Developers -> Webhooks -> (this endpoint) -> "Signing secret", NOT your
// API key. Set it with:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// Until this secret is set, every request is rejected (fail closed, not
// open) -- better a payment briefly doesn't get processed than the endpoint
// silently accepting forged events again.
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || 'sk_placeholder', { apiVersion: '2024-06-20' })

// Parse "Mr James Spender" into { first: "James", last: "Spender" }
function parseName(raw: string): { first: string; last: string } {
  const prefixes = ['mr', 'mrs', 'ms', 'miss', 'dr', 'prof']
  let parts = (raw || '').trim().split(/\s+/)
  // Strip title prefix
  if (parts.length > 1 && prefixes.includes(parts[0].toLowerCase().replace('.', ''))) {
    parts = parts.slice(1)
  }
  // Strip middle initials (single letters like "L" or "A C")
  const meaningful = parts.filter(p => p.length > 1 || parts.length <= 2)
  return {
    first: meaningful[0] || parts[0] || '',
    last: meaningful.slice(1).join(' ') || '',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') || ''

  if (!WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured -- rejecting all webhook events until it is set')
    return new Response('Webhook not configured', { status: 500 })
  }

  let event: any
  try {
    // constructEventAsync (not constructEvent) is required in Deno/edge
    // runtimes since it uses Web Crypto instead of Node's crypto module.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message)
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })
  }

  const obj = event.data.object
  const customerEmail = (obj.customer_email || obj.customer_details?.email || '').toLowerCase().trim()
  const customerNameRaw = obj.customer_details?.name || ''
  const { first, last } = parseName(customerNameRaw)
  const amount = obj.amount_total ? (obj.amount_total / 100).toFixed(2) : '0.00'
  const sessionId = obj.client_reference_id || obj.metadata?.sessionId || ''
  const stripeId = obj.id

  console.log(`Stripe payment: ${customerEmail} £${amount} session=${sessionId} name=${first} ${last}`)

  // ── Find existing lead ──
  // Priority 1: match by session/source ID (most reliable)
  // Priority 2: match by email (fallback)
  let lead: any = null

  if (sessionId) {
    const { data } = await supabase.from('leads').select('*')
      .eq('source', sessionId).eq('lead_type', 'inbound').limit(1).single()
    if (data) lead = data
  }

  if (!lead && customerEmail) {
    const { data } = await supabase.from('leads').select('*')
      .eq('inbound_email', customerEmail).eq('lead_type', 'inbound')
      .order('created_at', { ascending: false }).limit(1).single()
    if (data) lead = data
  }

  if (lead) {
    // UPDATE existing lead — never create a duplicate.
    // Setting status to 'Accepted' fires trg_lead_accepted_update, which calls
    // convert_accepted_lead() to create/update the client + job from the lead's
    // own data (site address, services, appointment date, etc). Stripe must NOT
    // insert its own client/job rows here — inbound-booking already populated
    // the lead with the real booking details; a second, separate insert here
    // would create a duplicate, near-empty job card that bypasses all of that.
    console.log(`Found lead ${lead.id} (${lead.inbound_name}), updating to Paid`)
    await supabase.from('leads').update({
      payment_status: 'Paid',
      status: 'Accepted',
      total_price: parseFloat(amount),
      notes: (lead.notes || '') + `\nStripe payment: £${amount} (${stripeId})`,
    }).eq('id', lead.id)

  } else if (customerEmail) {
    // No matching lead found — create one. This is a genuine fallback (e.g. a
    // standalone Stripe payment link with no prior website booking), so the
    // lead will only have the payment info Stripe gives us. Same as above:
    // do NOT manually insert client/job rows — status: 'Accepted' fires
    // trg_lead_accepted_insert -> convert_accepted_lead(), which creates them
    // exactly once (keyed off lead_id, so it can never duplicate).
    console.log(`No lead found, creating new for ${customerEmail}`)
    const { data: newLead } = await supabase.from('leads').insert({
      lead_type: 'inbound',
      inbound_name: [first, last].filter(Boolean).join(' ') || customerEmail.split('@')[0],
      inbound_email: customerEmail,
      total_price: parseFloat(amount),
      payment_status: 'Paid',
      status: 'Accepted',
      source: sessionId || `stripe_${stripeId}`,
      notes: `Created from Stripe payment. Amount: £${amount}. Stripe ID: ${stripeId}`,
    }).select().single()

    if (newLead) lead = newLead
  }

  // Log activity
  if (lead) {
    try {
      await supabase.from('activity_log').insert({
        entity_type: 'lead', entity_id: lead.id,
        action: 'payment_received',
        description: `Stripe payment received: £${amount}`,
      })
    } catch(e) {}
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  })
})
