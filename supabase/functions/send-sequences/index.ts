// send-sequences v14 (v13 + fair campaign ordering)
// Fixes: follow-ups always go from the SAME inbox as the earlier email (Gmail threads are
// per-mailbox — the old round-robin caused "Requested entity was not found" on ~5/6 follow-ups);
// 50/day cap is per INBOX across all campaigns; failures retry instead of dying; stuck "sending"
// rows are recovered; runs stay inside the edge-function time limit.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const RUN_INTERVAL_MIN = 10          // cron cadence
const TIME_BUDGET_MS = 110_000       // stay well under the edge wall-clock limit
const DEFAULT_DAILY_CAP = 50
const MAX_FAILS = 3
const CLOSED = ['In Discussion', 'Accepted', 'Declined']

class InboxAuthError extends Error {}

async function getValidToken(a: any): Promise<string> {
  if (a.token_expiry && new Date() < new Date(a.token_expiry) && a.access_token !== 'NOT_CONNECTED') return a.access_token
  if (!a.refresh_token || a.refresh_token === 'NOT_CONNECTED') throw new InboxAuthError('no refresh token')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
  })
  const d = await res.json()
  if (!d.access_token) throw new InboxAuthError(`token refresh failed: ${d.error}`)
  const expiry = new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString()
  await supabase.from('user_email_accounts').update({ access_token: d.access_token, token_expiry: expiry }).eq('id', a.id)
  a.access_token = d.access_token; a.token_expiry = expiry
  return d.access_token
}

function b64url(s: string) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sendGmail(token: string, from: string, fromName: string, to: string, subject: string, body: string,
  trackingId: string, reply: { threadId: string; messageIdHeader: string } | null) {
  const base = Deno.env.get('SUPABASE_URL')
  const pixel = `<img src="${base}/functions/v1/track-open?t=${trackingId}" width="1" height="1" style="display:none" alt="" />`
  const html = body.replace(/\n/g, '<br>') + pixel
  const domain = from.split('@')[1] || 'mylandlordcertificate.co.uk'
  const messageIdHeader = `<${crypto.randomUUID()}@${domain}>`
  const boundary = 'mlc_' + Date.now()
  const headers = [
    `From: ${fromName} <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${messageIdHeader}`,
    ...(reply?.messageIdHeader ? [`In-Reply-To: ${reply.messageIdHeader}`, `References: ${reply.messageIdHeader}`] : []),
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const raw = [...headers, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', body, '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '',
    `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${html}</body></html>`,
    '', `--${boundary}--`].join('\r\n')
  const payload: any = { raw: b64url(raw) }
  if (reply?.threadId) payload.threadId = reply.threadId
  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const d = await res.json()
  if (res.status === 401 || res.status === 403) throw new InboxAuthError(d.error?.message || `HTTP ${res.status}`)
  if (d.error) throw new Error(d.error.message || 'Gmail send failed')
  return { id: d.id, threadId: d.threadId, messageIdHeader }
}

const personalise = (t: string, v: Record<string, string>) => t
  .replace(/\{\{first_name\}\}/gi, v.first_name || '').replace(/\{\{last_name\}\}/gi, v.last_name || '')
  .replace(/\{\{company\}\}/gi, v.company || '').replace(/\{\{email\}\}/gi, v.email || '')
  .replace(/\{\{full_name\}\}/gi, [v.first_name, v.last_name].filter(Boolean).join(' ') || v.company || '')
  .replace(/\{\{sender_name\}\}/gi, v.sender_name || '')

function londonParts(now: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dow: WD[p.find(x => x.type === 'weekday')!.value] ?? 1, mins: Number(p.find(x => x.type === 'hour')!.value) * 60 + Number(p.find(x => x.type === 'minute')!.value) }
}
function windowFor(c: any, now: Date) {
  const tz = c.timezone || 'Europe/London'
  const days: number[] = c.send_days?.length ? c.send_days : [1, 2, 3, 4, 5]
  const [sh, sm] = (c.send_time_start || '09:00').slice(0, 5).split(':').map(Number)
  const [eh, em] = (c.send_time_end || '17:30').slice(0, 5).split(':').map(Number)
  const { dow, mins } = londonParts(now, tz)
  const start = sh * 60 + sm, end = eh * 60 + em
  return { open: days.includes(dow) && mins >= start && mins <= end, minutesLeft: Math.max(1, end - mins) }
}
function todayStart(now: Date, tz = 'Europe/London') {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
  const [y, mo, da] = d.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, da) - offMin * 60000)
}
function warmupCap(a: any, cap: number) {
  const days = Math.floor((Date.now() - new Date(a.warmup_started_at || Date.now()).getTime()) / 86400000)
  return Math.min(cap, days < 3 ? 8 : days < 7 ? 15 : days < 14 ? 25 : days < 21 ? 40 : Infinity)
}
const pick = (vs: any[]) => { if (!vs?.length) return null; let r = Math.random() * vs.reduce((s, v) => s + (v.weight || 1), 0); for (const v of vs) { r -= (v.weight || 1); if (r <= 0) return v } return vs[vs.length - 1] }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
  const started = Date.now()
  let body: any = {}; try { body = await req.json() } catch { /* cron sends none */ }
  const nowDate = new Date(), now = nowDate.toISOString()
  const log: any = { recovered: 0, results: [] }

  // 1. Recover contacts stuck in "sending" (process killed mid-run)
  const staleBefore = new Date(Date.now() - 15 * 60000).toISOString()
  const { data: stuck } = await supabase.from('campaign_contacts').select('id, current_step, claimed_at')
    .eq('status', 'sending').or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`).limit(500)
  for (const s of stuck || []) {
    const { data: last } = await supabase.from('email_sends').select('step_number').eq('contact_id', s.id).eq('status', 'sent')
      .order('sent_at', { ascending: false }).limit(1).maybeSingle()
    const patch: any = { status: 'active', claimed_at: null, next_send_at: now }
    if (last && last.step_number > (s.current_step || 0)) patch.current_step = last.step_number // it did send — don't resend
    await supabase.from('campaign_contacts').update(patch).eq('id', s.id)
    log.recovered++
  }

  // 2. Campaigns + inbox capacity (cap is per inbox per day across ALL campaigns)
  let cq = supabase.from('campaigns').select('*').in('status', ['active', 'running'])
  if (body.campaign_id) cq = cq.eq('id', body.campaign_id)
  const { data: campaignRows } = await cq
  if (!campaignRows?.length) return json({ ok: true, message: 'No active campaigns', ...log })
  // Fair share: campaigns go first in proportion to how many active contacts they hold
  // (weighted random order), so a big campaign isn't starved by a small one that runs earlier.
  const weighted = await Promise.all(campaignRows.map(async (c: any) => {
    const { count } = await supabase.from('campaign_contacts').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'active')
    return { c, key: Math.pow(Math.random(), 1 / Math.max(1, count || 0)) }
  }))
  const campaigns = weighted.sort((a, b) => b.key - a.key).map(w => w.c)

  const inboxIds = [...new Set(campaigns.flatMap((c: any) => c.inbox_ids?.length ? c.inbox_ids : (c.from_inbox_id ? [c.from_inbox_id] : [])))]
  const { data: inboxRows } = await supabase.from('user_email_accounts').select('*').in('id', inboxIds)
    .eq('is_active', true).eq('is_paused', false).eq('needs_reconnect', false)
  const dayStart = todayStart(nowDate).toISOString()
  const inbox = new Map<string, any>()
  for (const a of inboxRows || []) {
    const limits = campaigns.filter((c: any) => (c.inbox_ids || []).includes(a.id)).map((c: any) => c.per_inbox_daily_limit || DEFAULT_DAILY_CAP)
    const cap = warmupCap(a, Math.min(DEFAULT_DAILY_CAP, ...limits))
    const { count } = await supabase.from('email_sends').select('id', { count: 'exact', head: true })
      .eq('inbox_id', a.id).eq('status', 'sent').gte('sent_at', dayStart)
    inbox.set(a.id, { a, dayRemaining: Math.max(0, cap - (count || 0)), runQuota: 0, dead: false })
  }

  for (const campaign of campaigns) {
    const r: any = { campaign: campaign.name, sent: 0, failed: 0, retried: 0, skipped: 0, completed: 0 }
    log.results.push(r)
    const w = windowFor(campaign, nowDate)
    if (!body.force && !w.open) { r.note = 'outside schedule'; continue }

    const myInboxes = (campaign.inbox_ids || []).filter((id: string) => inbox.has(id))
    // Spread today's remaining sends evenly across the rest of the window
    for (const id of myInboxes) {
      const s = inbox.get(id)
      if (s.quotaSet) continue
      s.quotaSet = true
      const share = body.force ? s.dayRemaining : Math.ceil(s.dayRemaining * Math.min(1, RUN_INTERVAL_MIN / w.minutesLeft) * (0.8 + Math.random() * 0.4))
      s.runQuota = Math.min(s.dayRemaining, share)
    }
    if (!myInboxes.some((id: string) => inbox.get(id).runQuota > 0)) { r.note = 'no inbox capacity this run'; continue }

    const { data: steps } = await supabase.from('sequence_steps').select('*').eq('campaign_id', campaign.id).order('step_number')
    const stepBy = new Map((steps || []).map((s: any) => [s.step_number, s]))
    const { data: variants } = await supabase.from('email_variants').select('*').eq('campaign_id', campaign.id)
    const varBy = new Map<string, any[]>()
    for (const v of variants || []) { const k = v.step_id || 'legacy'; if (!varBy.has(k)) varBy.set(k, []); varBy.get(k)!.push(v) }

    // Follow-ups first so sequences finish; then oldest-waiting first
    const { data: due } = await supabase.from('campaign_contacts').select('*, leads(status, deleted_at)')
      .eq('campaign_id', campaign.id).eq('status', 'active').or(`next_send_at.is.null,next_send_at.lte.${now}`)
      .order('current_step', { ascending: false }).order('next_send_at', { ascending: true, nullsFirst: true }).limit(400)
    if (!due?.length) { r.note = 'no contacts due'; continue }

    // Previous send per contact -> which inbox + thread to continue in
    const prev = new Map<string, any>()
    for (let i = 0; i < due.length; i += 200) {
      const ids = due.slice(i, i + 200).map((c: any) => c.id)
      const { data: ps } = await supabase.from('email_sends').select('contact_id, inbox_id, subject, gmail_thread_id, message_id_header, sent_at')
        .in('contact_id', ids).eq('status', 'sent').order('sent_at', { ascending: false })
      for (const p of ps || []) if (!prev.has(p.contact_id)) prev.set(p.contact_id, p)
    }

    let rr = 0
    for (const c of due) {
      if (Date.now() - started > TIME_BUDGET_MS) { r.note = 'time budget reached — continues next run'; break }
      if (CLOSED.includes(c.leads?.status)) { await supabase.from('campaign_contacts').update({ status: 'completed', next_send_at: null }).eq('id', c.id); r.skipped++; continue }
      if (c.leads?.deleted_at) { await supabase.from('campaign_contacts').update({ status: 'skipped', next_send_at: null }).eq('id', c.id); r.skipped++; continue }

      const nextStep = (c.current_step || 0) + 1
      const step: any = stepBy.get(nextStep)
      if (!step) { await supabase.from('campaign_contacts').update({ status: 'completed', next_send_at: null }).eq('id', c.id); r.completed++; continue }

      // Inbox: sticky for follow-ups, round-robin for first touch
      const p = prev.get(c.id)
      let slot: any = null
      if (p) {
        slot = inbox.get(p.inbox_id)
        if (!slot || slot.dead || slot.runQuota <= 0) continue // wait for its own inbox; never switch mid-thread
      } else {
        for (let i = 0; i < myInboxes.length; i++) {
          const s = inbox.get(myInboxes[(rr + i) % myInboxes.length])
          if (!s.dead && s.runQuota > 0) { slot = s; rr = (rr + i + 1) % myInboxes.length; break }
        }
        if (!slot) break
      }

      const { data: claimed } = await supabase.from('campaign_contacts').update({ status: 'sending', claimed_at: new Date().toISOString() })
        .eq('id', c.id).eq('status', 'active').select('id')
      if (!claimed?.length) continue

      const a = slot.a
      const fromName = a.display_name || a.gmail_address.split('@')[0]
      const v = pick(varBy.get(step.id) || [])
      const vars = { first_name: c.first_name || c.company?.split(' ')[0] || c.email.split('@')[0], last_name: c.last_name || '', company: c.company || '', email: c.email, sender_name: fromName }
      const subject = p ? (/^re:/i.test(p.subject) ? p.subject : `Re: ${p.subject}`) : personalise(v?.subject || step.subject, vars)
      const text = personalise(v?.body_html || step.body_html, vars)
      const trackingId = crypto.randomUUID()

      try {
        const token = await getValidToken(a)
        let sent
        try {
          sent = await sendGmail(token, a.gmail_address, fromName, c.email, subject, text, trackingId,
            p?.gmail_thread_id ? { threadId: p.gmail_thread_id, messageIdHeader: p.message_id_header } : null)
        } catch (e: any) {
          if (/not found/i.test(e.message) && p?.gmail_thread_id) {
            sent = await sendGmail(token, a.gmail_address, fromName, c.email, subject, text, trackingId, null) // thread gone: send standalone
          } else throw e
        }
        await supabase.from('email_sends').insert({
          campaign_id: campaign.id, contact_id: c.id, inbox_id: a.id, step_number: nextStep, variant_id: v?.id || null,
          subject, body: text, from_email: a.gmail_address, to_email: c.email, status: 'sent', sent_at: new Date().toISOString(),
          gmail_message_id: sent.id, gmail_thread_id: sent.threadId, message_id_header: sent.messageIdHeader, tracking_id: trackingId,
        })
        const follow: any = stepBy.get(nextStep + 1)
        await supabase.from('campaign_contacts').update({
          current_step: nextStep, status: follow ? 'active' : 'completed', claimed_at: null, fail_count: 0, last_error: null,
          next_send_at: follow ? new Date(Date.now() + (follow.delay_days || 0) * 86400000).toISOString() : null,
        }).eq('id', c.id)
        if (c.lead_id) {
          const { data: lead } = await supabase.from('leads').select('email_send_count, status').eq('id', c.lead_id).single()
          if (lead) await supabase.from('leads').update({
            last_contacted_at: new Date().toISOString(), last_email_sent_at: new Date().toISOString(),
            email_send_count: (lead.email_send_count || 0) + 1, in_campaign: true,
            status: lead.status === 'New' ? 'Contacted' : lead.status,
          }).eq('id', c.lead_id)
          await supabase.from('activities').insert({ lead_id: c.lead_id, rep_name: fromName, activity_type: 'email',
            title: `Cold email sent (step ${nextStep}): ${subject}`, body: text.slice(0, 300),
            metadata: { campaign_id: campaign.id, from: a.gmail_address, gmail_message_id: sent.id } })
        }
        slot.runQuota--; slot.dayRemaining--; r.sent++
        await sleep(1500 + Math.random() * 2500)
      } catch (e: any) {
        const msg = String(e.message || e)
        if (e instanceof InboxAuthError) {
          slot.dead = true
          await supabase.from('user_email_accounts').update({ needs_reconnect: true, reconnect_reason: msg }).eq('id', a.id)
          await supabase.from('campaign_contacts').update({ status: 'active', claimed_at: null }).eq('id', c.id)
          r.retried++
        } else if (/invalid to header|invalid address|invalid recipient/i.test(msg)) {
          await supabase.from('campaign_contacts').update({ status: 'bounced', claimed_at: null, next_send_at: null, last_error: msg }).eq('id', c.id)
          r.failed++
        } else {
          const fails = (c.fail_count || 0) + 1
          await supabase.from('campaign_contacts').update({
            status: fails >= MAX_FAILS ? 'failed' : 'active', fail_count: fails, last_error: msg, claimed_at: null,
            next_send_at: new Date(Date.now() + 2 * 3600000).toISOString(),
          }).eq('id', c.id)
          fails >= MAX_FAILS ? r.failed++ : r.retried++
        }
        console.error(`Send failed ${c.email}: ${msg}`)
      }
    }

    // Keep headline stats exact
    const [{ count: sentCount }, { count: openCount }, { count: repCount }] = await Promise.all([
      supabase.from('email_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).eq('status', 'sent'),
      supabase.from('email_sends').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).eq('status', 'sent').gt('open_count', 0),
      supabase.from('campaign_contacts').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).eq('status', 'replied'),
    ])
    await supabase.from('campaigns').update({ total_sent: sentCount || 0, total_opened: openCount || 0, total_replied: repCount || 0,
      started_at: campaign.started_at || new Date().toISOString() }).eq('id', campaign.id)
  }

  console.log(JSON.stringify(log))
  return json({ ok: true, ms: Date.now() - started, ...log })
})

function json(o: any) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }) }
