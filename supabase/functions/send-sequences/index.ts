import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

async function getValidToken(account: any): Promise<string> {
  const expiry = new Date(account.token_expiry)
  if (new Date() < expiry) return account.access_token
  if (!account.refresh_token) throw new Error(`No refresh token for ${account.gmail_address}`)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  await supabase.from('user_email_accounts').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  }).eq('id', account.id)
  return data.access_token
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Sends via Gmail. When `replyTo` is provided (step 2+ to a contact we've
// already emailed), the send is threaded: Gmail's threadId links it into
// the same conversation, and In-Reply-To/References headers make it thread
// correctly in non-Gmail clients too. Every send gets its own Message-ID,
// generated up front, referenced by the *next* step to this same contact.
async function sendGmail(
  token: string, from: string, fromName: string, to: string, subject: string, body: string,
  trackingId: string, supabaseUrl: string,
  replyTo?: { threadId: string; messageIdHeader: string } | null
): Promise<{ id: string; threadId: string; messageIdHeader: string }> {
  const trackingPixel = `\n\n<img src="${supabaseUrl}/functions/v1/track-open?t=${trackingId}" width="1" height="1" style="display:none" />`
  const htmlBody = body.replace(/\n/g, '<br>') + trackingPixel

  const domain = from.split('@')[1] || 'mylandlordcertificate.co.uk'
  const messageIdHeader = `<${crypto.randomUUID()}@${domain}>`

  const boundary = 'mlc_' + Date.now()
  const headers = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageIdHeader}`,
    ...(replyTo ? [`In-Reply-To: ${replyTo.messageIdHeader}`, `References: ${replyTo.messageIdHeader}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]

  const raw = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${htmlBody}</body></html>`,
    '',
    `--${boundary}--`,
  ].join('\r\n')

  const payload: any = { raw: encodeBase64Url(raw) }
  if (replyTo?.threadId) payload.threadId = replyTo.threadId

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Gmail send failed: ${data.error.message}`)
  return { id: data.id, threadId: data.threadId, messageIdHeader }
}

function personalise(text: string, vars: Record<string, string>): string {
  return text
    .replace(/\{\{first_name\}\}/gi, vars.first_name || '')
    .replace(/\{\{last_name\}\}/gi, vars.last_name || '')
    .replace(/\{\{company\}\}/gi, vars.company || '')
    .replace(/\{\{email\}\}/gi, vars.email || '')
    .replace(/\{\{full_name\}\}/gi, [vars.first_name, vars.last_name].filter(Boolean).join(' ') || vars.company || '')
    .replace(/\{\{sender_name\}\}/gi, vars.sender_name || '')
}

// Checks whether "now" falls inside the campaign's allowed sending window,
// and reports how far into today's window we are -- used to pace sends
// across the day rather than releasing the whole daily quota in one burst.
function checkSendWindow(campaign: any, now: Date): { ok: boolean; minutesIntoWindow: number; windowMinutes: number } {
  const tz = campaign.timezone || 'Europe/London'
  const days: number[] = campaign.send_days?.length ? campaign.send_days : [1, 2, 3, 4, 5]
  const startStr: string = (campaign.send_time_start || '09:00').slice(0, 5)
  const endStr: string = (campaign.send_time_end || '17:30').slice(0, 5)

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const weekdayShort = parts.find(p => p.type === 'weekday')?.value || 'Mon'
  const hour = Number(parts.find(p => p.type === 'hour')?.value || '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value || '0')

  const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const todayIdx = WEEKDAY_MAP[weekdayShort] ?? 1

  const [startH, startM] = startStr.split(':').map(Number)
  const [endH, endM] = endStr.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const nowMinutes = hour * 60 + minute

  const ok = days.includes(todayIdx) && nowMinutes >= startMinutes && nowMinutes <= endMinutes
  return { ok, minutesIntoWindow: Math.max(0, nowMinutes - startMinutes), windowMinutes: Math.max(1, endMinutes - startMinutes) }
}

// Midnight *in the campaign's own timezone*, expressed as a UTC Date. Used
// to reset the per-inbox daily send count at local midnight, not UTC.
function todayStartInTimezone(now: Date, tz: string): Date {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const y = Number(dateParts.find(p => p.type === 'year')?.value)
  const m = Number(dateParts.find(p => p.type === 'month')?.value)
  const d = Number(dateParts.find(p => p.type === 'day')?.value)

  const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now)
  const offsetStr = offsetParts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const offsetMatch = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offsetMinutes = offsetMatch ? (offsetMatch[1] === '-' ? -1 : 1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) : 0

  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes * 60000)
}

// Inbox warmup ramp: brand-new (or freshly-recovered-from-pause) inboxes
// send very little at first and build up over ~3 weeks. Once fully warmed,
// the inbox's own configured per_inbox_daily_limit applies.
function warmupCappedLimit(account: any, configuredLimit: number): number {
  const startedAt = account.warmup_started_at ? new Date(account.warmup_started_at) : new Date()
  const daysWarming = Math.floor((Date.now() - startedAt.getTime()) / 86400000)
  let rampCap: number
  if (daysWarming < 3) rampCap = 8
  else if (daysWarming < 7) rampCap = 15
  else if (daysWarming < 14) rampCap = 25
  else if (daysWarming < 21) rampCap = 40
  else rampCap = Infinity
  return Math.min(configuredLimit, rampCap)
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pickVariant(variants: any[]): any | null {
  if (!variants?.length) return null
  const totalWeight = variants.reduce((s, v) => s + (v.weight || 1), 0)
  let r = Math.random() * totalWeight
  for (const v of variants) {
    r -= (v.weight || 1)
    if (r <= 0) return v
  }
  return variants[variants.length - 1]
}

function jitterMs(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }

  const targetCampaignId = body.campaign_id || null
  const dryRun = body.dry_run || false
  const nowDate = new Date()
  const now = nowDate.toISOString()

  let campaignsQuery = supabase.from('campaigns').select('*').in('status', ['active', 'running'])
  if (targetCampaignId) campaignsQuery = campaignsQuery.eq('id', targetCampaignId)
  const { data: campaigns, error: cErr } = await campaignsQuery
  if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500 })
  if (!campaigns?.length) return new Response(JSON.stringify({ ok: true, message: 'No active campaigns', sent: 0 }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })

  let totalSent = 0, totalFailed = 0
  const results: any[] = []

  for (const campaign of campaigns) {
    const window = checkSendWindow(campaign, nowDate)
    if (!body.force && !window.ok) {
      results.push({ campaign: campaign.name, skipped: true, reason: 'outside allowed sending schedule (days/hours)' })
      continue
    }

    const inboxIds: string[] = campaign.inbox_ids?.length ? campaign.inbox_ids : (campaign.from_inbox_id ? [campaign.from_inbox_id] : [])
    if (!inboxIds.length) { results.push({ campaign: campaign.name, skipped: true, reason: 'no inboxes configured' }); continue }

    // Skip anything paused (bounce circuit-breaker or manual pause). This
    // is what makes the auto-pause elsewhere actually mean something.
    const { data: accountsRaw } = await supabase.from('user_email_accounts').select('*').in('id', inboxIds).eq('is_active', true)
    const accounts = (accountsRaw || []).filter((a: any) => !a.is_paused)
    const pausedCount = (accountsRaw?.length || 0) - accounts.length
    if (!accounts.length) { results.push({ campaign: campaign.name, skipped: true, reason: `no usable inboxes (${pausedCount} paused)` }); continue }

    const todayStart = todayStartInTimezone(nowDate, campaign.timezone || 'Europe/London')
    const inboxSlots: { account: any; remaining: number }[] = []
    for (const account of accounts) {
      const configuredLimit = campaign.per_inbox_daily_limit || 50
      const dailyCap = warmupCappedLimit(account, configuredLimit)

      const { count: sentTodayFromInbox } = await supabase
        .from('email_sends').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id).eq('inbox_id', account.id)
        .eq('status', 'sent').gte('sent_at', todayStart.toISOString())

      const remainingToday = dailyCap - (sentTodayFromInbox || 0)
      if (remainingToday <= 0) continue

      const minutesLeftInWindow = Math.max(1, window.windowMinutes - window.minutesIntoWindow)
      const paceFraction = Math.min(1, 60 / minutesLeftInWindow)
      const jitter = 0.75 + Math.random() * 0.5
      const paced = body.force ? remainingToday : Math.max(1, Math.ceil(remainingToday * paceFraction * jitter))

      inboxSlots.push({ account, remaining: Math.min(remainingToday, paced) })
    }

    const totalAvailable = inboxSlots.reduce((s, x) => s + x.remaining, 0)
    if (totalAvailable === 0) { results.push({ campaign: campaign.name, skipped: true, reason: 'no inbox capacity available this run' }); continue }

    const { data: contactsRaw } = await supabase
      .from('campaign_contacts').select('*').eq('campaign_id', campaign.id).eq('status', 'active')
      .or(`next_send_at.is.null,next_send_at.lte.${now}`).limit(totalAvailable * 3)
    const contacts = shuffle(contactsRaw || []).slice(0, totalAvailable)

    if (!contacts.length) { results.push({ campaign: campaign.name, skipped: true, reason: 'no contacts due' }); continue }

    const { data: stepsData } = await supabase
      .from('sequence_steps').select('*').eq('campaign_id', campaign.id).order('step_number')
    const steps = stepsData || []
    const stepByNumber = new Map(steps.map((s: any) => [s.step_number, s]))
    const usesSteps = steps.length > 0

    let fallbackSubject = campaign.subject || 'Partnership Opportunity - My Landlord Certificate'
    let fallbackBody = campaign.body || `Dear {{first_name}},\n\nI hope this email finds you well.\n\nMy name is {{sender_name}} from My Landlord Certificate. We provide EICR, Gas Safety Certificates, EPCs, Fire Risk Assessments and all other property compliance certificates across London and the UK.\n\nWe work with many estate agents and lettings agencies and would love to discuss how we can support your landlord clients with fast, reliable and competitively priced certificates.\n\nWould you be open to a quick call this week?\n\nKind regards,\n{{sender_name}}\nMy Landlord Certificate\n020 3996 1070\ninfo@mylandlordcertificate.co.uk`

    if (!usesSteps && campaign.template_id) {
      const { data: tpl } = await supabase.from('email_templates').select('subject, body').eq('id', campaign.template_id).single()
      if (tpl) { fallbackSubject = tpl.subject; fallbackBody = tpl.body }
    }

    const { data: variantsRaw } = await supabase.from('email_variants').select('*').eq('campaign_id', campaign.id)
    const variantsByStep = new Map<string, any[]>()
    for (const v of (variantsRaw || [])) {
      const key = v.step_id || 'legacy'
      if (!variantsByStep.has(key)) variantsByStep.set(key, [])
      variantsByStep.get(key)!.push(v)
    }

    let campaignSent = 0, campaignFailed = 0, campaignCompleted = 0
    let slotIndex = 0

    for (const contact of contacts) {
      const nextStepNumber = (contact.current_step || 0) + 1
      let templateSubject = fallbackSubject
      let templateBody = fallbackBody
      let stepId: string | null = null

      if (usesSteps) {
        const step: any = stepByNumber.get(nextStepNumber)
        if (!step) {
          await supabase.from('campaign_contacts').update({ status: 'completed', next_send_at: null }).eq('id', contact.id)
          campaignCompleted++
          continue
        }
        templateSubject = step.subject
        templateBody = step.body_html
        stepId = step.id
      }

      const variantPool = variantsByStep.get(stepId || 'legacy')
      const variant = pickVariant(variantPool || [])
      if (variant) { templateSubject = variant.subject; templateBody = variant.body_html }

      let slot = null
      for (let i = 0; i < inboxSlots.length; i++) {
        const s = inboxSlots[(slotIndex + i) % inboxSlots.length]
        if (s.remaining > 0) { slot = s; slotIndex = (slotIndex + i + 1) % inboxSlots.length; break }
      }
      if (!slot) break

      const { data: claimed } = await supabase.from('campaign_contacts')
        .update({ status: 'sending' })
        .eq('id', contact.id).eq('status', 'active')
        .or(`next_send_at.is.null,next_send_at.lte.${now}`)
        .select('id')
      if (!claimed?.length) continue

      const account = slot.account
      const fromName = account.display_name || account.gmail_address.split('@')[0]
      const vars = {
        first_name: contact.first_name || contact.company?.split(' ')[0] || contact.email.split('@')[0],
        last_name: contact.last_name || '',
        company: contact.company || '',
        email: contact.email,
        sender_name: fromName,
      }

      const { data: prevSend } = await supabase
        .from('email_sends')
        .select('subject, gmail_thread_id, message_id_header')
        .eq('contact_id', contact.id)
        .eq('status', 'sent')
        .not('gmail_thread_id', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const personalisedSubject = personalise(templateSubject, vars)
      const subject = prevSend
        ? (prevSend.subject.match(/^Re:/i) ? prevSend.subject : `Re: ${prevSend.subject}`)
        : personalisedSubject
      const emailBody = personalise(templateBody, vars)
      const trackingId = crypto.randomUUID()

      if (dryRun) {
        console.log(`[DRY RUN] step ${nextStepNumber} -> ${contact.email} from ${account.gmail_address}${variant ? ` (variant ${variant.label})` : ''}${prevSend ? ' (threaded)' : ''}`)
        await supabase.from('campaign_contacts').update({ status: 'active' }).eq('id', contact.id)
        campaignSent++; slot.remaining--; continue
      }

      try {
        const token = await getValidToken(account)
        const sendResult = await sendGmail(
          token, account.gmail_address, fromName, contact.email, subject, emailBody, trackingId, supabaseUrl,
          prevSend ? { threadId: prevSend.gmail_thread_id, messageIdHeader: prevSend.message_id_header } : null
        )

        await supabase.from('email_sends').insert({
          campaign_id: campaign.id, contact_id: contact.id, inbox_id: account.id,
          step_number: nextStepNumber, variant_id: variant?.id || null,
          subject, body: emailBody, from_email: account.gmail_address, to_email: contact.email,
          status: 'sent', sent_at: new Date().toISOString(),
          gmail_message_id: sendResult.id, gmail_thread_id: sendResult.threadId,
          message_id_header: sendResult.messageIdHeader, tracking_id: trackingId,
        })

        const followUpStep: any = usesSteps ? stepByNumber.get(nextStepNumber + 1) : null
        await supabase.from('campaign_contacts').update({
          current_step: nextStepNumber,
          status: followUpStep ? 'active' : (usesSteps ? 'completed' : 'sent'),
          next_send_at: followUpStep ? new Date(Date.now() + (followUpStep.delay_days || 0) * 86400000).toISOString() : null,
        }).eq('id', contact.id)

        if (contact.lead_id) {
          const { data: lead } = await supabase.from('leads').select('email_send_count, status').eq('id', contact.lead_id).single()
          if (lead) {
            await supabase.from('leads').update({
              last_contacted_at: new Date().toISOString(),
              last_email_sent_at: new Date().toISOString(),
              email_send_count: (lead.email_send_count || 0) + 1,
              in_campaign: true,
              status: lead.status === 'New' ? 'Contacted' : lead.status,
            }).eq('id', contact.lead_id)
          }
          await supabase.from('activities').insert({
            lead_id: contact.lead_id, rep_name: fromName, activity_type: 'email',
            title: `Cold email sent (step ${nextStepNumber}): ${subject}`,
            body: emailBody.slice(0, 300),
            metadata: { campaign_id: campaign.id, from: account.gmail_address, gmail_message_id: sendResult.id, variant: variant?.label || null }
          })
        }

        slot.remaining--
        campaignSent++; totalSent++
        await new Promise(r => setTimeout(r, jitterMs(2000, 9000)))

      } catch (err: any) {
        console.error(`Failed ${contact.email}: ${err.message}`)
        await supabase.from('campaign_contacts').update({ status: 'failed' }).eq('id', contact.id)
        campaignFailed++; totalFailed++
      }
    }

    await supabase.from('campaigns').update({
      total_sent: (campaign.total_sent || 0) + campaignSent,
      started_at: campaign.started_at || new Date().toISOString(),
    }).eq('id', campaign.id)

    results.push({
      campaign: campaign.name,
      sent: campaignSent, failed: campaignFailed, sequence_completed: campaignCompleted,
      uses_steps: usesSteps,
      paused_inboxes_skipped: pausedCount,
      inboxes: inboxSlots.map((s: any) => ({ email: s.account.gmail_address, remaining_this_run: s.remaining })),
    })
  }

  return new Response(JSON.stringify({ ok: true, total_sent: totalSent, total_failed: totalFailed, dry_run: dryRun, results }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
