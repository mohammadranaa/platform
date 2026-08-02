import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  let event: any
  try {
    const body = await req.text()
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Stripe event:', event.type)

  // Handle payment completion events
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object
    const customerEmail = obj.customer_email || obj.customer_details?.email || ''
    const customerName  = obj.customer_details?.name || ''
    const amount        = obj.amount_total ? (obj.amount_total / 100).toFixed(2) : obj.amount ? (obj.amount / 100).toFixed(2) : '0.00'
    const sessionId     = obj.client_reference_id || obj.metadata?.sessionId || ''
    const stripeId      = obj.id

    console.log(`Payment: ${customerEmail} £${amount} session=${sessionId}`)

    // Find the lead — try session ID first, then email
    let lead: any = null

    if (sessionId) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('source', sessionId)
        .eq('lead_type', 'inbound')
        .single()
      if (data) lead = data
    }

    if (!lead && customerEmail) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('inbound_email', customerEmail.toLowerCase())
        .eq('lead_type', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) lead = data
    }

    if (lead) {
      // Update payment status
      await supabase
        .from('leads')
        .update({
          payment_status: 'Paid',
          status: 'Accepted',
          total_price: parseFloat(amount),
          notes: (lead.notes || '') + `\nStripe payment confirmed: £${amount} (${stripeId})`
        })
        .eq('id', lead.id)

      console.log(`Updated lead ${lead.id} (${lead.inbound_name}) to Paid/Accepted`)

      // Log activity
      await supabase.from('activities').insert({
        lead_id: lead.id,
        rep_name: 'Stripe',
        activity_type: 'payment_received',
        title: `Payment received: £${amount}`,
        body: `Stripe payment confirmed. Amount: £${amount}. Reference: ${stripeId}`,
        metadata: { stripe_id: stripeId, amount, email: customerEmail }
      })
    } else {
      // No matching lead — create one if we have enough data
      console.log(`No lead found for session=${sessionId} email=${customerEmail}`)
      if (customerEmail && customerEmail.includes('@')) {
        await supabase.from('leads').insert({
          lead_type: 'inbound',
          inbound_name: customerName || customerEmail.split('@')[0],
          inbound_email: customerEmail.toLowerCase(),
          total_price: parseFloat(amount),
          payment_status: 'Paid',
          status: 'Accepted',
          source: sessionId || `stripe_${stripeId}`,
          notes: `Created from Stripe payment. Amount: £${amount}. Stripe ID: ${stripeId}`
        })
        console.log(`Created new lead for ${customerEmail}`)
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
