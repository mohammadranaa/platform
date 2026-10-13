// daily-report v4: subject/body UTF-8 encoded properly (no more garbled dashes)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMessage, formatAddress, toBase64Url } from './mime.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const INBOX_ID      = '7f17e37f-62b9-4667-8843-981d2ae46ef8'

const TO  = 'ali@mylandlordcertificate.co.uk'
const CC  = 'info@mylandlordcertificate.co.uk'

// Extension number → rep name (Nuacom doesn't include names in the payload)
const EXT_NAMES: Record<string, string> = { '10': 'Asad', '11': 'Moiz', '12': 'Mehwish' }
const extName = (ext: string) => EXT_NAMES[ext] || `Ext. ${ext}`

// v3: report on TODAY (runs ~9pm UK). v2 reported "yesterday" — Mondays showed Sunday, Fridays never reported —
// and its midnight ignored British Summer Time.
function ukYesterday() {
  const now = new Date(), tz = 'Europe/London'
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const mm = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offMin = mm ? (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3])) : 0
  const start = new Date(Date.UTC(y, m - 1, d) - offMin * 60000)
  const end = new Date(start.getTime() + 86400000)
  const label = start.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return { start: start.toISOString(), end: end.toISOString(), label }
}

function fmt(n: number) { return n.toLocaleString() }
function mins(sec: number) {
  if (!sec) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

async function getToken(account: any): Promise<string> {
  if (new Date() < new Date(account.token_expiry)) return account.access_token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error}`)
  await supabase.from('user_email_accounts').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  }).eq('id', account.id)
  return data.access_token
}

async function sendReport(token: string, subject: string, html: string) {
  const mime = buildMessage({
    from: formatAddress('My Landlord Certificate', 'asad@mylandlordcertificate.co.uk'),
    to: TO, cc: CC, subject,
    text: 'Your daily performance report is attached as HTML. Open this email in an HTML-capable mail client to view it.',
    html,
  })
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: toBase64Url(mime) }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Gmail send failed: ${data.error.message}`)
  return data.id
}

const DARK='#1F2937', BORDER='#E5E7EB', GREY='#6B7280'
const BLUE='#0093DB', GREEN='#16A34A', AMBER='#D97706', RED='#DC2626', TEAL='#0D9488'

function stat(label: string, value: string|number, color=DARK, sub='') {
  return `<td style="padding:14px 16px;text-align:center;border-right:1px solid ${BORDER}">
    <div style="font-size:28px;font-weight:800;color:${color}">${value}</div>
    <div style="font-size:12px;color:${GREY};margin-top:3px">${label}</div>
    ${sub?`<div style="font-size:11px;color:${GREY};margin-top:1px">${sub}</div>`:''}
  </td>`
}

function section(title: string, content: string) {
  return `<div style="margin-bottom:24px;background:#fff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden">
    <div style="background:${DARK};padding:12px 20px;font-size:13px;font-weight:700;color:#fff;letter-spacing:0.04em">${title}</div>
    ${content}
  </div>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })

  const { start, end, label } = ukYesterday()
  console.log(`Building daily report for ${label}`)

  const [{ data: calls }, { data: acts }, { data: scActs }, { data: emailSends }, { count: newOpens }, { data: reps }, { data: pipeline }] = await Promise.all([
    supabase.from('nuacom_calls').select('call_direction,call_answered,duration_seconds,call_answered_by,call_initiated_by').gte('call_at', start).lt('call_at', end),
    supabase.from('activities').select('activity_type,rep_name,lead_id').gte('created_at', start).lt('created_at', end).not('rep_name','in','("System","NUACOM")'),
    supabase.from('activities').select('title,rep_name,lead_id').gte('created_at', start).lt('created_at', end).eq('activity_type','status_change'),
    supabase.from('email_sends').select('id,open_count,replied_at').gte('sent_at', start).lt('sent_at', end),
    supabase.from('leads').select('id',{count:'exact',head:true}).gte('last_email_opened_at',start).lt('last_email_opened_at',end),
    supabase.from('profiles').select('id,full_name').in('role',['rep','admin']).not('full_name','ilike','%@%'),
    supabase.from('leads').select('status,lead_type').is('deleted_at',null),
  ])

  const callsData = calls || []
  const actsData  = acts  || []
  const scData    = scActs || []
  const sendsData = emailSends || []
  const pipeData  = pipeline || []
  const repsData  = reps || []

  const totalCalls    = callsData.length
  const answeredCalls = callsData.filter((c:any)=>c.call_answered).length
  const outbound      = callsData.filter((c:any)=>c.call_direction==='outbound').length
  const inbound       = callsData.filter((c:any)=>c.call_direction==='inbound').length
  const answeredSecs  = callsData.filter((c:any)=>c.call_answered).reduce((s:number,c:any)=>s+(c.duration_seconds||0),0)

  const extBreak: Record<string,{calls:number,answered:number,secs:number}> = {}
  for (const c of callsData as any[]) {
    const ext = c.call_initiated_by || c.call_answered_by || 'unknown'
    if (!extBreak[ext]) extBreak[ext] = { calls:0, answered:0, secs:0 }
    extBreak[ext].calls++
    if (c.call_answered) { extBreak[ext].answered++; extBreak[ext].secs += (c.duration_seconds||0) }
  }

  const emailsSent    = sendsData.length
  const emailsOpened  = sendsData.filter((e:any)=>e.open_count>0).length
  const emailsReplied = sendsData.filter((e:any)=>e.replied_at).length
  const openRate      = emailsSent>0 ? Math.round(emailsOpened/emailsSent*100) : 0
  const replyRate     = emailsSent>0 ? Math.round(emailsReplied/emailsSent*100) : 0

  const toDiscussion = scData.filter((a:any)=>a.title?.includes('"In Discussion"')).length
  const toDeclined   = scData.filter((a:any)=>a.title?.includes('"Declined"')).length
  const toAccepted   = scData.filter((a:any)=>a.title?.includes('"Accepted"')).length

  const pipeStats = {
    total:      pipeData.length,
    cold:       pipeData.filter((l:any)=>l.lead_type==='cold_agent').length,
    inbound:    pipeData.filter((l:any)=>l.lead_type==='inbound').length,
    discussion: pipeData.filter((l:any)=>l.status==='In Discussion').length,
    accepted:   pipeData.filter((l:any)=>l.status==='Accepted').length,
    declined:   pipeData.filter((l:any)=>l.status==='Declined').length,
  }

  const repStats: Record<string,any> = {}
  for (const rep of repsData as any[]) {
    const ra = actsData.filter((a:any)=>a.rep_name===rep.full_name)
    const rs = scData.filter((a:any)=>a.rep_name===rep.full_name)
    repStats[rep.full_name] = {
      leads_engaged: new Set(ra.filter((a:any)=>a.lead_id).map((a:any)=>a.lead_id)).size,
      to_discussion: rs.filter((a:any)=>a.title?.includes('"In Discussion"')).length,
      declined:      rs.filter((a:any)=>a.title?.includes('"Declined"')).length,
      activities:    ra.length,
      calls: 0, callTime: 0,
    }
  }
  for (const [ext, data] of Object.entries(extBreak)) {
    const name = EXT_NAMES[ext]
    if (name && repStats[name]) {
      repStats[name].calls    = data.calls
      repStats[name].callTime = data.secs
    }
  }

  const th = (t: string, a='center') => `<th style="padding:8px 16px;text-align:${a};font-size:11px;color:${GREY};font-weight:700;text-transform:uppercase">${t}</th>`
  const callsBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr style="border-bottom:1px solid ${BORDER}">
      ${stat('Total Calls',totalCalls,BLUE)}
      ${stat('Answered',answeredCalls,GREEN,totalCalls>0?Math.round(answeredCalls/totalCalls*100)+'% answer rate':'')}
      ${stat('Outbound',outbound,DARK)}
      ${stat('Inbound',inbound,DARK)}
      ${stat('Total Talk Time',mins(answeredSecs),TEAL)}
    </tr>
  </table>
  ${Object.keys(extBreak).length ? `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <thead><tr style="background:#F9FAFB">${th('Rep','left')}${th('Calls')}${th('Answered')}${th('Talk Time')}</tr></thead>
    <tbody>
      ${Object.entries(extBreak).sort((a,b)=>b[1].calls-a[1].calls).map(([ext,d])=>`
      <tr style="border-bottom:1px solid ${BORDER}">
        <td style="padding:9px 16px;font-weight:600;font-size:13px;color:${DARK}">${extName(ext)}</td>
        <td style="padding:9px 16px;text-align:center;font-size:13px;color:${BLUE}">${d.calls}</td>
        <td style="padding:9px 16px;text-align:center;font-size:13px;color:${GREEN}">${d.answered}</td>
        <td style="padding:9px 16px;text-align:center;font-size:13px;color:${TEAL};font-weight:600">${mins(d.secs)}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}`

  const emailBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${stat('Emails Sent',emailsSent,BLUE)}${stat('Opened',emailsOpened,AMBER,openRate+'% open rate')}${stat('New Unique Opens',newOpens||0,TEAL,'first time today')}${stat('Replies',emailsReplied,GREEN,replyRate+'% reply rate')}</tr>
  </table>`

  const actBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${stat('\u2192 In Discussion',toDiscussion,TEAL)}${stat('Declined',toDeclined,RED)}${stat('Accepted',toAccepted,GREEN)}${stat('Activities Logged',actsData.length,DARK)}</tr>
  </table>`

  const pipeBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>
      ${stat('All Leads',fmt(pipeStats.total),DARK)}
      ${stat('Estate Agents',fmt(pipeStats.cold),GREY)}
      ${stat('Inbound',fmt(pipeStats.inbound),BLUE)}
      ${stat('In Discussion',fmt(pipeStats.discussion),TEAL)}
      ${stat('Accepted',fmt(pipeStats.accepted),GREEN)}
      ${stat('Declined',fmt(pipeStats.declined),RED)}
    </tr>
  </table>`

  const activeReps   = Object.entries(repStats).filter(([,d]:any)=>d.calls+d.callTime+d.activities+d.leads_engaged>0)
  const inactiveReps = Object.entries(repStats).filter(([,d]:any)=>!(d.calls+d.callTime+d.activities+d.leads_engaged>0))

  const repTable = `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <thead><tr style="background:#F9FAFB;border-bottom:2px solid ${BORDER}">${th('Rep','left')}${th('Calls')}${th('Talk Time')}${th('Leads Engaged')}${th('\u2192 Discussion')}${th('Declined')}${th('Activities')}</tr></thead><tbody>
    ${activeReps.map(([name,d]:any)=>`
    <tr style="border-bottom:1px solid ${BORDER}">
      <td style="padding:10px 16px;font-weight:600;color:${DARK};font-size:13px">${name}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${BLUE}">${d.calls||0}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${d.callTime>0?GREEN:GREY};font-weight:${d.callTime>0?700:400}">${d.callTime>0?mins(d.callTime):'\u2014'}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${DARK}">${d.leads_engaged}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${TEAL}">${d.to_discussion}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${RED}">${d.declined}</td>
      <td style="padding:10px 16px;text-align:center;font-size:13px;color:${GREY}">${d.activities}</td>
    </tr>`).join('')}
    ${inactiveReps.map(([name])=>`
    <tr style="border-bottom:1px solid ${BORDER}">
      <td style="padding:10px 16px;font-size:13px;color:${GREY}">${name}</td>
      <td colspan="6" style="padding:10px 16px;font-size:12px;color:${GREY};font-style:italic">No activity recorded today</td>
    </tr>`).join('')}
  </tbody></table>`

  const dateStr = new Date(start).toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'})
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">
  <div style="background:${DARK};border-radius:12px 12px 0 0;padding:24px 28px">
    <div style="font-size:20px;font-weight:800;color:#fff">&#x1F4CA; Daily Performance Report</div>
    <div style="font-size:13px;color:#9CA3AF;margin-top:4px">${label}</div>
    <div style="font-size:12px;color:#6B7280;margin-top:2px">My Landlord Certificate</div>
  </div>
  <div style="background:${BORDER};height:1px"></div>
  <div style="padding:24px 0">
    ${section('&#x1F4DE; CALL ACTIVITY', callsBlock)}
    ${section('&#x1F4E7; EMAIL CAMPAIGN PERFORMANCE', emailBlock)}
    ${section('&#x1F4C8; LEAD MOVEMENT TODAY', actBlock)}
    ${section('&#x1F3C6; REP PERFORMANCE', repTable)}
    ${section('&#x1F5C2; FULL PIPELINE (ALL LEADS)', pipeBlock)}
  </div>
  <div style="text-align:center;padding:16px;font-size:11px;color:${GREY}">
    Generated automatically &middot; <a href="https://platform-pearl-eta.vercel.app" style="color:${BLUE}">Open platform</a>
  </div>
</div></body></html>`

  const { data: inbox } = await supabase.from('user_email_accounts').select('*').eq('id', INBOX_ID).single()
  if (!inbox) return new Response(JSON.stringify({error:'Inbox not found'}),{status:500})
  if (inbox.needs_reconnect) return new Response(JSON.stringify({error:'Inbox disconnected'}),{status:500})

  const token = await getToken(inbox)
  const msgId = await sendReport(token, `MLC Daily Report \u2014 ${dateStr}`, html)
  console.log(`Report sent. ID: ${msgId}`)

  return new Response(JSON.stringify({ok:true, message_id:msgId, date:label, stats:{totalCalls,emailsSent,emailsOpened,emailsReplied,toDiscussion,toDeclined,totalLeads:pipeStats.total}}),{
    status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
  })
})
