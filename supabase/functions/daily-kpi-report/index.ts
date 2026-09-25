// daily-kpi-report v2
// - Sends from Ali's real inbox (looked up by address); v1 sent from Asad's inbox by mistake
// - Reports on TODAY (it runs at ~9pm UK); v1 reported yesterday, so Mondays graded Sunday and Fridays were never reported
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const EXT_NAMES: Record<string, string> = { '10': 'Asad', '11': 'Moiz', '12': 'Mehwish' }
const SENDER_ADDRESS = 'ali@mylandlordcertificate.co.uk'

function ukToday() {
  const now = new Date(), tz = 'Europe/London'
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const mm = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offMin = mm ? (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3])) : 0
  const start = new Date(Date.UTC(y, m - 1, d) - offMin * 60000)
  const end = new Date(start.getTime() + 86400000)
  const label = start.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
  const dateStr = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
  return { start: start.toISOString(), end: end.toISOString(), label, dateStr }
}
const mins = (sec: number) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}h ${m}m` : `${m}m ${s}s` }
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`

async function getToken(a: any): Promise<string> {
  if (a.token_expiry && new Date() < new Date(a.token_expiry)) return a.access_token
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: a.refresh_token, grant_type: 'refresh_token' }) })
  const d = await res.json()
  if (!d.access_token) throw new Error(`Token refresh failed: ${d.error}`)
  await supabase.from('user_email_accounts').update({ access_token: d.access_token, token_expiry: new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString() }).eq('id', a.id)
  return d.access_token
}
async function sendEmail(token: string, from: string, fromName: string, to: string, subject: string, html: string) {
  const b = 'kpi_' + Date.now()
  const mime = [`From: ${fromName} <${from}>`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${b}"`,
    '', `--${b}`, 'Content-Type: text/html; charset=UTF-8', '', html, '', `--${b}--`].join('\r\n')
  const bytes = new TextEncoder().encode(mime); let bin = ''; for (const x of bytes) bin += String.fromCharCode(x)
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }) })
  const d = await res.json()
  if (d.error) throw new Error(`Send failed: ${d.error.message}`)
  return d.id
}

function html(rep: any, s: any, k: any, day: string) {
  const leadsMin = s.connected >= k.daily_minimum_leads, timeMin = s.talkSec >= k.daily_minimum_minutes * 60
  const leadsTgt = s.connected >= k.daily_target_leads, timeTgt = s.talkSec >= k.daily_target_minutes * 60
  // SOP: target is hit when EITHER target is reached, but only once BOTH minimums are also satisfied
  const target = (leadsTgt || timeTgt) && leadsMin && timeMin, minimum = leadsMin && timeMin
  const [status, col, bg, note] = target ? ['🏆 TARGET HIT', '#15803D', '#DCFCE7', 'Excellent work — target reached and both minimums met.']
    : minimum ? ['✅ MINIMUM MET', '#D97706', '#FEF3C7', 'Both minimums met. Push for the full target tomorrow.']
    : ['⚠️ MINIMUM MISSED', '#DC2626', '#FEE2E2', `Still needed: ${[!leadsMin && `${k.daily_minimum_leads - s.connected} more connected leads`, !timeMin && `${Math.ceil((k.daily_minimum_minutes * 60 - s.talkSec) / 60)} more minutes of talk time`].filter(Boolean).join(' and ')}.`]
  const row = (label: string, actual: string, min: string, tgt: string, okMin: boolean, okTgt: boolean) => `<tr style="border-bottom:1px solid #E5E7EB"><td style="padding:10px 14px;font-size:13px;font-weight:600;color:#1F2937">${label}</td><td style="padding:10px 14px;text-align:center;font-size:14px;font-weight:800;color:${okMin ? '#1F2937' : '#DC2626'}">${actual}</td><td style="padding:10px 14px;text-align:center;font-size:13px;color:#6B7280">${min}</td><td style="padding:10px 14px;text-align:center;font-size:13px;color:#6B7280">${tgt}</td><td style="padding:10px 14px;text-align:center;font-size:13px;font-weight:700;color:${okTgt ? '#15803D' : okMin ? '#D97706' : '#DC2626'}">${okTgt ? '🏆 Target' : okMin ? '✅ Minimum' : '❌ Below'}</td></tr>`
  const th = (t: string, a = 'center') => `<th style="padding:9px 14px;text-align:${a};font-size:11px;color:#6B7280;font-weight:700;text-transform:uppercase">${t}</th>`
  return `<!DOCTYPE html><html><body style="margin:0;background:#F9FAFB;font-family:Arial,Helvetica,sans-serif"><div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#1F2937;border-radius:12px 12px 0 0;padding:20px 24px"><div style="font-size:18px;font-weight:800;color:#fff">My Landlord Certificate</div><div style="font-size:12px;color:#9CA3AF;margin-top:2px">Daily KPI Report — ${day}</div></div>
<div style="background:#fff;padding:20px 24px;border:1px solid #E5E7EB;border-top:none">
<div style="font-size:16px;font-weight:700;color:#1F2937;margin-bottom:4px">Hi ${rep.full_name},</div><div style="font-size:13px;color:#6B7280;margin-bottom:18px">Here's how today looked against your KPI targets.</div>
<div style="background:${bg};border:1px solid ${col}44;border-radius:10px;padding:14px 18px;margin-bottom:20px;text-align:center"><div style="font-size:22px;font-weight:900;color:${col}">${status}</div><div style="font-size:12px;color:${col};margin-top:3px">${note}</div></div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E5E7EB;margin-bottom:20px"><thead><tr style="background:#F9FAFB">${th('Metric', 'left')}${th('Today')}${th('Minimum')}${th('Target')}${th('Status')}</tr></thead><tbody>
${row('Connected Leads', String(s.connected), String(k.daily_minimum_leads), String(k.daily_target_leads), leadsMin, leadsTgt)}
${row('Talk Time', mins(s.talkSec), hm(k.daily_minimum_minutes), hm(k.daily_target_minutes), timeMin, timeTgt)}
</tbody></table>
<div style="font-size:12px;color:#6B7280;margin-bottom:12px">Total calls dialled: <strong>${s.total}</strong> · Jobs created: <strong>${s.jobs}</strong></div>
<div style="font-size:11px;color:#9CA3AF;text-align:center">Calling continues until <strong>both</strong> minimums are met, even if one target is already reached.</div>
</div><div style="text-align:center;padding:12px;font-size:11px;color:#9CA3AF">My Landlord Certificate · Sent by Ali</div></div></body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  let body: any = {}; try { body = await req.json() } catch { /* cron */ }
  const { start, end, label, dateStr } = ukToday()

  const { data: sender } = await supabase.from('user_email_accounts').select('*').ilike('gmail_address', SENDER_ADDRESS)
    .eq('is_active', true).neq('access_token', 'NOT_CONNECTED').eq('needs_reconnect', false).maybeSingle()
  if (!sender) {
    await supabase.from('notifications').insert({ type: 'system', title: '⚠ KPI emails not sent',
      body: `${SENDER_ADDRESS} isn't connected to the platform. Ali needs to connect it on the Email Inbox page.`, link: '/email' }).then(() => {}, () => {})
    return new Response(JSON.stringify({ ok: false, error: `${SENDER_ADDRESS} not connected — nothing sent` }), { status: 200 })
  }

  const { data: kpis } = await supabase.from('rep_kpi_targets').select('*, profiles(id, full_name, email)')
  const { data: calls } = await supabase.from('nuacom_calls').select('call_initiated_by, call_answered_by, call_answered, duration_seconds').gte('call_at', start).lt('call_at', end)
  const token = await getToken(sender)
  const results: any[] = []
  for (const k of kpis || []) {
    const rep = k.profiles as any
    if (!rep?.email) { results.push({ rep: rep?.full_name, error: 'no email on profile' }); continue }
    const ext = Object.entries(EXT_NAMES).find(([, n]) => n === rep.full_name)?.[0]
    const mine = (calls || []).filter((c: any) => c.call_initiated_by === ext || c.call_answered_by === ext)
    const ans = mine.filter((c: any) => c.call_answered)
    const { count: jobs } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('assigned_to', rep.id).gte('created_at', start).lt('created_at', end)
    const s = { total: mine.length, connected: ans.length, talkSec: ans.reduce((t: number, c: any) => t + (c.duration_seconds || 0), 0), jobs: jobs || 0 }
    if (body.dry_run) { results.push({ rep: rep.full_name, to: rep.email, ...s }); continue }
    try {
      const id = await sendEmail(token, sender.gmail_address, 'Ali', rep.email, `Your KPI Report — ${dateStr}`, html(rep, s, k, label))
      results.push({ rep: rep.full_name, to: rep.email, ...s, message_id: id })
    } catch (e: any) { results.push({ rep: rep.full_name, error: e.message }) }
  }
  console.log(JSON.stringify({ date: label, results }))
  return new Response(JSON.stringify({ ok: true, date: label, from: sender.gmail_address, results }), { headers: { 'Content-Type': 'application/json' } })
})
