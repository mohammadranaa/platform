import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const WEBHOOK_SECRET  = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const CLIENT_ID       = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET   = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const SEND_FROM_ADDR  = 'info@mylandlordcertificate.co.uk'
const SEND_FROM_NAME  = 'My Landlord Certificate'
// Asad's personal inbox is used as the OAuth credential carrier.
// The From: header is set to info@ so customers see the public-facing address.
const SENDER_INBOX_ID = '7f17e37f-62b9-4667-8843-981d2ae46ef8'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || 'sk_placeholder', { apiVersion: '2024-06-20' })

function parseName(raw: string): { first: string; last: string } {
  const prefixes = ['mr','mrs','ms','miss','dr','prof']
  let parts = (raw || '').trim().split(/\s+/)
  if (parts.length > 1 && prefixes.includes(parts[0].toLowerCase().replace('.', ''))) parts = parts.slice(1)
  const meaningful = parts.filter(p => p.length > 1 || parts.length <= 2)
  return { first: meaningful[0] || parts[0] || '', last: meaningful.slice(1).join(' ') || '' }
}

async function getToken(accountId: string): Promise<string | null> {
  const { data: a } = await supabase.from('user_email_accounts').select('*').eq('id', accountId).single()
  if (!a || a.needs_reconnect || a.access_token === 'NOT_CONNECTED') return null
  if (a.token_expiry && new Date() < new Date(a.token_expiry)) return a.access_token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
  })
  const d = await res.json()
  if (!d.access_token) return null
  await supabase.from('user_email_accounts').update({ access_token: d.access_token, token_expiry: new Date(Date.now() + (d.expires_in||3600)*1000).toISOString() }).eq('id', accountId)
  return d.access_token
}

function b64url(s: string) {
  const bytes = new TextEncoder().encode(s); let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}

async function sendConfirmation(token: string, to: string, toName: string, lead: any) {
  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = toName.trim().split(/\s+/)[0] || toName
  const fullName  = toName.trim() || 'our customer'
  const apptDate  = lead.appointment_date
    ? new Date(lead.appointment_date).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : 'to be confirmed'
  const timeSlot  = lead.time_slot || 'to be confirmed'
  const address   = [lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ') || 'your property'
  const services  = lead.services_requested || 'compliance certificate'
  const price     = lead.total_price ? `£${parseFloat(lead.total_price).toFixed(2)}` : ''
  const phone     = lead.inbound_phone || ''

  const subject = `Booking Confirmed — ${services.split('—')[0].trim()} | My Landlord Certificate`

  const body = `${greeting}, ${firstName},

Thank you — we have received your payment${price ? ` of ${price}` : ''} for ${services} at ${address}.

Your appointment is confirmed for ${apptDate} between ${timeSlot}.

To help us prepare for your visit, could you please confirm the following details by replying to this email?

1. NAME ON CERTIFICATE
   Please confirm the full name you would like to appear on the compliance certificate.
   Current name we have: ${fullName}

2. ACCESS TO THE PROPERTY
   Will you be present at the property on the day, or will someone else be providing access?

   a) I will be present — my contact number is: ${phone || '[please provide]'}
   b) A tenant / keyholder will provide access — their details are:
      Name: _______________
      Phone: _______________

3. YOUR CURRENT DETAILS
   Please confirm or correct the following:
   Name: ${fullName}
   Email: ${to}
   Phone: ${phone || '[not provided]'}
   Property Address: ${address}

Our engineer will call approximately one hour before arrival. You or your keyholder do not need to be present for the full duration — just available to provide initial access.

If you have any questions ahead of the appointment, please do not hesitate to contact us on 020 3996 1070 or reply to this email.

Kind regards,
My Landlord Certificate
020 3996 1070`

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#1F2937;line-height:1.6;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#1F2937;padding:20px 24px;border-radius:8px 8px 0 0">
  <div style="font-size:18px;font-weight:700;color:#fff">My Landlord Certificate</div>
  <div style="font-size:12px;color:#80D100;margin-top:2px">Booking Confirmation</div>
</div>
<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:24px;border-radius:0 0 8px 8px">
  <p style="margin-top:0">${greeting.charAt(0).toUpperCase()+greeting.slice(1)}, ${firstName},</p>
  <p>Thank you — we have received your payment${price ? ` of <strong>${price}</strong>` : ''} for <strong>${services}</strong> at ${address}.</p>
  <div style="background:#F0FAE0;border:1px solid #80D10055;border-radius:8px;padding:14px 18px;margin:16px 0">
    <div style="font-size:12px;color:#5a9400;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Appointment Confirmed</div>
    <div style="font-size:16px;font-weight:700;color:#1F2937;margin-top:4px">${apptDate}</div>
    <div style="color:#4B5563">${timeSlot}</div>
  </div>
  <p>To help us prepare for your visit, could you please confirm the following details by replying to this email?</p>
  <div style="background:#F5F7FA;border-radius:8px;padding:16px 20px;margin:16px 0">
    <p style="margin-top:0;font-weight:700">1. NAME ON CERTIFICATE</p>
    <p style="margin:0 0 4px 0">Please confirm the full name you would like to appear on the compliance certificate.</p>
    <p style="margin:0;color:#6B7280">Current name we have: <strong>${fullName}</strong></p>
  </div>
  <div style="background:#F5F7FA;border-radius:8px;padding:16px 20px;margin:16px 0">
    <p style="margin-top:0;font-weight:700">2. ACCESS TO THE PROPERTY</p>
    <p style="margin:0 0 8px 0">Will you be present at the property on the day, or will someone else be providing access?</p>
    <p style="margin:0 0 4px 0">a) I will be present — my contact number is: ${phone || '[please provide]'}</p>
    <p style="margin:0">b) A tenant / keyholder will provide access — Name: ___________ Phone: ___________</p>
  </div>
  <div style="background:#F5F7FA;border-radius:8px;padding:16px 20px;margin:16px 0">
    <p style="margin-top:0;font-weight:700">3. YOUR CURRENT DETAILS</p>
    <table style="font-size:13px;color:#4B5563"><tr><td style="padding:2px 12px 2px 0;font-weight:600">Name</td><td>${fullName}</td></tr><tr><td style="padding:2px 12px 2px 0;font-weight:600">Email</td><td>${to}</td></tr><tr><td style="padding:2px 12px 2px 0;font-weight:600">Phone</td><td>${phone || 'not provided'}</td></tr><tr><td style="padding:2px 12px 2px 0;font-weight:600">Address</td><td>${address}</td></tr></table>
  </div>
  <p>Our engineer will call approximately one hour before arrival. You or your keyholder do not need to be present for the full duration — just available to provide initial access.</p>
  <p>If you have any questions, please call us on <strong>020 3996 1070</strong> or reply to this email.</p>
  <p style="margin-bottom:0">Kind regards,<br><strong>My Landlord Certificate</strong><br>020 3996 1070</p>
</div></body></html>`

  const boundary = 'mlc_conf_' + Date.now()
  const raw = [
    `From: ${SEND_FROM_NAME} <${SEND_FROM_ADDR}>`,
    `To: ${toName} <${to}>`,
    `Reply-To: ${SEND_FROM_ADDR}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n')

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) }),
  })
  const d = await res.json()
  if (d.error) throw new Error(`Gmail send failed: ${d.error.message}`)
  return d.id
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') || ''

  if (!WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured')
    return new Response('Webhook not configured', { status: 500 })
  }

  let event: any
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message)
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') {
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const obj = event.data.object
  const customerEmail = (obj.customer_email || obj.customer_details?.email || '').toLowerCase().trim()
  const customerNameRaw = obj.customer_details?.name || ''
  const { first, last } = parseName(customerNameRaw)
  const customerName = [first, last].filter(Boolean).join(' ') || customerEmail.split('@')[0]
  const amount = obj.amount_total ? (obj.amount_total / 100).toFixed(2) : '0.00'
  const sessionId = obj.client_reference_id || obj.metadata?.sessionId || ''
  const stripeId = obj.id

  console.log(`Stripe payment: ${customerEmail} £${amount} session=${sessionId} name=${customerName}`)

  // ── Find or create lead ──────────────────────────────────
  let lead: any = null
  if (sessionId) {
    const { data } = await supabase.from('leads').select('*').eq('source', sessionId).eq('lead_type', 'inbound').limit(1).maybeSingle()
    if (data) lead = data
  }
  if (!lead && customerEmail) {
    const { data } = await supabase.from('leads').select('*').eq('inbound_email', customerEmail).eq('lead_type', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) lead = data
  }

  if (lead) {
    console.log(`Found lead ${lead.id} (${lead.inbound_name}), updating to Paid`)
    await supabase.from('leads').update({
      payment_status: 'Paid',
      status: 'Accepted',
      total_price: parseFloat(amount),
      notes: (lead.notes || '') + `\nStripe payment: £${amount} (${stripeId})`,
    }).eq('id', lead.id)
    // Re-fetch to get all fields (appointment_date etc.) for the confirmation email
    const { data: updated } = await supabase.from('leads').select('*').eq('id', lead.id).single()
    if (updated) lead = updated
  } else if (customerEmail) {
    console.log(`No lead found, creating new for ${customerEmail}`)
    const { data: newLead } = await supabase.from('leads').insert({
      lead_type: 'inbound',
      inbound_name: customerName || customerEmail.split('@')[0],
      inbound_email: customerEmail,
      total_price: parseFloat(amount),
      payment_status: 'Paid',
      status: 'Accepted',
      source: sessionId || `stripe_${stripeId}`,
      notes: `Created from Stripe payment. Amount: £${amount}. Stripe ID: ${stripeId}`,
    }).select().single()
    if (newLead) lead = newLead
  }

  // ── Send payment confirmation email ─────────────────────
  let emailSent = false
  let emailError = ''
  if (lead && customerEmail) {
    try {
      // Check not already sent (idempotent — Stripe can fire the event twice)
      const { data: alreadySent } = await supabase.from('activities').select('id')
        .eq('lead_id', lead.id).eq('activity_type', 'email').ilike('title', '%payment confirmation%').limit(1).maybeSingle()
      
      if (!alreadySent) {
        const token = await getToken(SENDER_INBOX_ID)
        if (token) {
          const msgId = await sendConfirmation(token, customerEmail, customerName || lead.inbound_name, lead)
          // Log so we never send twice
          await supabase.from('activities').insert({
            lead_id: lead.id,
            rep_name: 'System',
            activity_type: 'email',
            title: `Payment confirmation email sent`,
            body: `Sent to ${customerEmail} for ${lead.services_requested || 'booking'} · £${amount}`,
            metadata: { gmail_message_id: msgId, from: SEND_FROM_ADDR, to: customerEmail },
          })
          emailSent = true
          console.log(`Payment confirmation sent to ${customerEmail}, msg=${msgId}`)
        } else {
          emailError = 'Sender inbox not connected or needs reconnecting'
          console.error(emailError)
          // Create a platform notification so admin can see it
          await supabase.from('notifications').insert({
            type: 'system',
            title: `⚠️ Payment confirmation NOT sent — ${customerName}`,
            body: `Paid £${amount} but confirmation email failed: ${emailError}. Reply manually to ${customerEmail}`,
            link: lead ? `/leads/${lead.id}` : '/leads',
          })
        }
      } else {
        console.log(`Confirmation already sent for lead ${lead.id}, skipping`)
        emailSent = true // idempotent
      }
    } catch (e: any) {
      emailError = e.message
      console.error(`Confirmation email failed for ${customerEmail}:`, e.message)
      await supabase.from('notifications').insert({
        type: 'system',
        title: `⚠️ Payment confirmation failed — ${customerName}`,
        body: `Paid £${amount} · Error: ${emailError} · Email: ${customerEmail}`,
        link: lead ? `/leads/${lead.id}` : '/leads',
      })
    }
  }

  // Log activity
  if (lead) {
    try {
      await supabase.from('activities').insert({
        lead_id: lead.id,
        rep_name: 'System',
        activity_type: 'system',
        title: `Stripe payment received: £${amount}`,
        body: `Payment ${stripeId}`,
        metadata: { stripe_id: stripeId, amount },
      })
    } catch { /* non-fatal */ }
  }

  return new Response(JSON.stringify({ received: true, email_sent: emailSent, email_error: emailError || null }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
