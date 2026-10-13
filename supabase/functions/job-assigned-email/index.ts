// job-assigned-email v2 — sends from ali@mylandlordcertificate.co.uk when a job is assigned to a rep.
// v2: subject/body properly UTF-8 encoded (fixes "New Job Assigned Ã¢Â€Â” ..." garbling).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMessage, formatAddress, toBase64Url } from './mime.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const SENDER_INBOX_ID = 'a81b71a9-afe1-4537-a27a-3408e7766f3a'
const PLATFORM_URL  = 'https://platform-pearl-eta.vercel.app'

async function getToken(a: any): Promise<string | null> {
  if (!a || a.needs_reconnect || a.access_token === 'NOT_CONNECTED') return null
  if (a.token_expiry && new Date() < new Date(a.token_expiry)) return a.access_token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
  })
  const d = await res.json()
  if (!d.access_token) return null
  await supabase.from('user_email_accounts').update({ access_token: d.access_token, token_expiry: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString() }).eq('id', a.id)
  return d.access_token
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  let body: any = {}
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const { job_id } = body
  if (!job_id) return new Response(JSON.stringify({ ok: false, error: 'job_id required' }), { status: 400 })

  const { data: job } = await supabase.from('jobs')
    .select('id, job_number, title, service_types, site_address, site_postcode, scheduled_date, scheduled_slot, status, quoted_amount, assigned_to, client_id')
    .eq('id', job_id).single()
  if (!job) return new Response(JSON.stringify({ ok: false, error: 'job not found' }), { status: 404 })
  if (!job.assigned_to) return new Response(JSON.stringify({ ok: false, skipped: 'no rep assigned' }), { status: 200 })

  const { data: rep } = await supabase.from('profiles').select('id, full_name, email').eq('id', job.assigned_to).single()
  if (!rep?.email) return new Response(JSON.stringify({ ok: false, error: 'rep has no email' }), { status: 200 })

  const { data: client } = job.client_id
    ? await supabase.from('clients').select('first_name, last_name, company_name, billing_name').eq('id', job.client_id).single()
    : { data: null }

  const clientName = client
    ? [client.first_name, client.last_name].filter(Boolean).join(' ') || client.company_name || client.billing_name || ''
    : ''
  const services  = (job.service_types?.length ? job.service_types : [job.title]).join(', ')
  const address   = [job.site_address, job.site_postcode].filter(Boolean).join(', ') || 'Address not set'
  const apptDate  = job.scheduled_date
    ? new Date(String(job.scheduled_date).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
    : 'To be scheduled'
  const slot      = job.scheduled_slot || ''
  const amount    = job.quoted_amount ? `£${parseFloat(job.quoted_amount).toFixed(2)}` : ''
  const jobRef    = job.job_number || job.id.slice(0, 8).toUpperCase()
  const jobUrl    = `${PLATFORM_URL}/jobs/${job.id}`
  const repFirst  = (rep.full_name || '').split(' ')[0] || rep.full_name
  const subject   = `New job assigned: ${jobRef} · ${services}`

  const rows: [string, string][] = [
    ['Job reference', jobRef], ['Service', services], ...(clientName ? [['Client', clientName] as [string, string]] : []),
    ['Address', address], ['Appointment', `${apptDate}${slot ? ` · ${slot}` : ''}`],
    ...(amount ? [['Amount', amount] as [string, string]] : []), ['Status', job.status || 'Confirmed'],
  ]

  const text = `Hi ${repFirst},\n\nA job has been assigned to you on the MLC platform.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nView the job: ${jobUrl}\n\nIf you have any questions, reply to this email or speak to Ali.\n\nMy Landlord Certificate\n020 3996 1070`

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#EEF1F5;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="background:#0F1B2D;padding:20px 28px"><div style="font-size:18px;font-weight:800;color:#fff">My Landlord Certificate</div><div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#80D100;margin-top:3px">Job Assignment</div></td></tr>
<tr><td style="height:3px;background:#0093DB"></td></tr>
<tr><td style="padding:26px 28px 8px">
<div style="font-size:20px;font-weight:800;color:#0F1B2D;margin:0 0 14px">New job assigned to you</div>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1F2937">Hi ${esc(repFirst)}, a job has been assigned to you on the MLC platform.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid #E5E9F0;border-left:4px solid #0093DB;border-radius:8px;padding:6px 18px;margin:8px 0 20px;border-collapse:separate">
${rows.map(([k, v]) => `<tr><td style="padding:9px 0;width:38%;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #EEF1F5">${esc(k)}</td><td style="padding:9px 0;font-size:14px;font-weight:600;color:${k === 'Job reference' ? '#0093DB' : '#111827'};border-bottom:1px solid #EEF1F5">${esc(v)}</td></tr>`).join('')}
</table>
<div style="text-align:center;margin:4px 0 22px"><a href="${jobUrl}" style="display:inline-block;background:#0093DB;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px">View job</a></div>
<p style="margin:0 0 18px;font-size:13px;color:#6B7280">Questions? Reply to this email or speak to Ali.</p>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #EEF1F5;font-size:12px;color:#6B7280"><strong style="color:#374151">My Landlord Certificate</strong> · 020 3996 1070</td></tr>
</table></td></tr></table></body></html>`

  const { data: inbox } = await supabase.from('user_email_accounts').select('*').eq('id', SENDER_INBOX_ID).single()
  const token = await getToken(inbox)
  if (!token) return new Response(JSON.stringify({ ok: false, error: "Ali's inbox not connected" }), { status: 200 })

  const raw = buildMessage({
    from: formatAddress('Ali · My Landlord Certificate', 'ali@mylandlordcertificate.co.uk'),
    to: formatAddress(rep.full_name || '', rep.email),
    subject, text, html,
  })

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  })
  const d = await res.json()
  if (d.error) return new Response(JSON.stringify({ ok: false, error: d.error.message }), { status: 200 })

  console.log(`Job assignment email sent to ${rep.email} for job ${jobRef}`)
  return new Response(JSON.stringify({ ok: true, to: rep.email, job: jobRef, message_id: d.id }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
