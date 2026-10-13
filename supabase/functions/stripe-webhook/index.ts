// stripe-webhook v15
// - Payment/booking confirmation restored to the full original wording, sent as a branded HTML email
//   with a calendar invite for the booked slot.
// - Subject/body UTF-8 encoded properly (no more garbled dashes / £).
// - Unchanged: signature verification, lead matching, idempotency, From info@ via Ali's inbox.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { buildMessage, buildIcs, renderBrandedHtml, formatAddress, toBase64Url } from './mime.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const SEND_FROM_ADDR = 'info@mylandlordcertificate.co.uk'
const SEND_FROM_NAME = 'My Landlord Certificate'
const SENDER_INBOX_ID = 'a81b71a9-afe1-4537-a27a-3408e7766f3a' // Ali's inbox
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || 'sk_placeholder', { apiVersion: '2024-06-20' })

function parseName(raw: string) {
  const prefixes = ['mr', 'mrs', 'ms', 'miss', 'dr', 'prof']
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
  await supabase.from('user_email_accounts').update({ access_token: d.access_token, token_expiry: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString() }).eq('id', accountId)
  return d.access_token
}

async function sendConf(token: string, to: string, toName: string, lead: any) {
  const full = (toName || '').trim() || 'Customer'
  const dateIso = lead.appointment_date ? String(lead.appointment_date).slice(0, 10) : ''
  const appt = dateIso
    ? new Date(dateIso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
    : 'to be confirmed'
  const ts = lead.time_slot || 'to be confirmed'
  const addr = [lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ') || 'your property'
  const svc = lead.services_requested || 'compliance certificate'
  const svcShort = svc.split('—')[0].split('(')[0].trim() || 'Booking'
  const price = lead.total_price ? `£${parseFloat(lead.total_price).toFixed(2)}` : ''
  const phone = lead.inbound_phone || ''
  const subject = `Booking Confirmed — ${svcShort}${dateIso ? ` on ${appt}` : ''} | My Landlord Certificate`

  const text = `Dear ${full},

Thank you — we have received your payment${price ? ` of ${price}` : ''} for ${svc} at ${addr}.

Service: ${svc}
Property: ${addr}
Date: ${appt}
Arrival window: ${ts}${price ? `\nAmount paid: ${price}` : ''}

To help us prepare for your visit, could you please confirm the following details by replying to this email?

1. NAME ON CERTIFICATE
Please confirm the full name you would like to appear on the compliance certificate.
Current name we have: ${full}

2. ACCESS TO THE PROPERTY
Will you be present at the property on the day, or will someone else be providing access?
a) I will be present — my contact number is: ${phone || '[please provide]'}
b) A tenant / keyholder will provide access — their name and phone number: _______________

3. YOUR CURRENT DETAILS
Please confirm or correct the following:

Name: ${full}
Email: ${to}
Phone: ${phone || '[not provided]'}
Property address: ${addr}

Our engineer will call approximately one hour before arrival. You or your keyholder do not need to be present for the full duration — just available to provide initial access.

If you have any questions ahead of the appointment, please do not hesitate to contact us on 020 3996 1070 or reply to this email.

Kind regards,
My Landlord Certificate
020 3996 1070
info@mylandlordcertificate.co.uk
www.mylandlordcertificate.co.uk`

  const ics = dateIso ? buildIcs({
    uid: `lead-${lead.id}@mylandlordcertificate.co.uk`, date: dateIso, slot: ts,
    summary: `${svcShort} inspection — My Landlord Certificate`, location: addr,
    description: `${svc}\nArrival window: ${ts}\nOur engineer will call approximately one hour before arrival.\nQuestions or changes: 020 3996 1070`,
    attendee_email: to, attendee_name: full,
  }, SEND_FROM_ADDR, SEND_FROM_NAME) : null

  const raw = buildMessage({
    from: formatAddress(SEND_FROM_NAME, SEND_FROM_ADDR),
    to: formatAddress(full, to),
    replyTo: SEND_FROM_ADDR,
    subject, text,
    html: renderBrandedHtml(text, { title: 'Booking Confirmed', calendarNote: !!ics }),
    ics,
  })
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  })
  const d = await res.json()
  if (d.error) throw new Error(`Gmail: ${d.error.message}`)
  return d.id
}

const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') || ''
  if (!WEBHOOK_SECRET) return new Response('not configured', { status: 500 })
  let event: any
  try { event = await stripe.webhooks.constructEventAsync(rawBody, sig, WEBHOOK_SECRET) }
  catch (err: any) { return new Response(`sig fail: ${err.message}`, { status: 400 }) }
  if (event.type !== 'checkout.session.completed' && event.type !== 'payment_intent.succeeded') return json({ received: true })

  const obj = event.data.object
  const email = (obj.customer_email || obj.customer_details?.email || '').toLowerCase().trim()
  const { first, last } = parseName(obj.customer_details?.name || '')
  const name = [first, last].filter(Boolean).join(' ') || email.split('@')[0]
  const amount = obj.amount_total ? (obj.amount_total / 100).toFixed(2) : '0.00'
  const sid = obj.client_reference_id || obj.metadata?.sessionId || ''
  const stId = obj.id

  let lead: any = null
  if (sid) { const { data } = await supabase.from('leads').select('*').eq('source', sid).eq('lead_type', 'inbound').limit(1).maybeSingle(); if (data) lead = data }
  if (!lead && email) { const { data } = await supabase.from('leads').select('*').eq('inbound_email', email).eq('lead_type', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle(); if (data) lead = data }
  if (lead) {
    await supabase.from('leads').update({ payment_status: 'Paid', status: 'Accepted', total_price: parseFloat(amount) }).eq('id', lead.id)
    const { data: u } = await supabase.from('leads').select('*').eq('id', lead.id).single(); if (u) lead = u
  } else if (email) {
    const { data: nl } = await supabase.from('leads').insert({ lead_type: 'inbound', inbound_name: name, inbound_email: email, total_price: parseFloat(amount), payment_status: 'Paid', status: 'Accepted', source: sid || `stripe_${stId}` }).select().single()
    if (nl) lead = nl
  }

  let sent = false, err = ''
  if (lead && email) {
    try {
      const { data: dup } = await supabase.from('activities').select('id').eq('lead_id', lead.id).eq('activity_type', 'email').ilike('title', '%payment confirmation%').limit(1).maybeSingle()
      if (!dup) {
        const tok = await getToken(SENDER_INBOX_ID)
        if (tok) {
          const mid = await sendConf(tok, email, lead.inbound_name || name, lead)
          await supabase.from('activities').insert({ lead_id: lead.id, rep_name: 'System', activity_type: 'email', title: 'Payment confirmation email sent', body: `Sent to ${email} · £${amount} · with calendar invite`, metadata: { gmail_message_id: mid, from: SEND_FROM_ADDR, to: email } })
          sent = true
        } else {
          err = "Ali's inbox not connected"
          await supabase.from('notifications').insert({ type: 'system', title: `⚠ Payment confirmation NOT sent — ${name}`, body: `Paid £${amount} but ${err}. Reply manually to ${email}`, link: lead ? `/leads/${lead.id}` : '/leads' })
        }
      } else sent = true
    } catch (e: any) {
      err = e.message
      await supabase.from('notifications').insert({ type: 'system', title: `⚠ Confirmation failed — ${name}`, body: `£${amount} · ${err}`, link: lead ? `/leads/${lead.id}` : '/leads' })
    }
  }
  if (lead) {
    try { await supabase.from('activities').insert({ lead_id: lead.id, rep_name: 'System', activity_type: 'system', title: `Stripe payment received: £${amount}`, body: `Payment ${stId}`, metadata: { stripe_id: stId, amount } }) } catch { /* non-critical */ }
  }
  return json({ received: true, email_sent: sent, error: err || null })
})
