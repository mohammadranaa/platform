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

async function sendGmail(token: string, from: string, fromName: string, to: string, subject: string, body: string, trackingId: string, supabaseUrl: string): Promise<string> {
  // Add invisible tracking pixel at end of email
  const trackingPixel = `\n\n<img src="${supabaseUrl}/functions/v1/track-open?t=${trackingId}" width="1" height="1" style="display:none" />`
  const htmlBody = body.replace(/\n/g, '<br>') + trackingPixel

  const boundary = 'mlc_' + Date.now()
  const raw = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
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
    `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${htmlBody}</body></html>`,
    '',
    `--${boundary}--`,
  ].join('\r\n')

  const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encodeBase64Url(raw) }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Gmail send failed: ${data.error.message}`)
  return data.id
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

// Checks whether "now" falls inside the campaign's allowed sending window
// (day-of-week + local time-of-day, in the campaign's own timezone).
function isWithinSendWindow(campaign: any, now: Date): boolean {
  const tz = campaign.timezone || 'Europe/London'
  const days: number[] = campaign.send_days?.length ? campaign.send_days : [1, 2, 3, 4, 5]
  const startStr: string = (campaign.send_time_start || '09:00').slice(0, 5)
  const endStr: string = (campaign.send_time_end || '17:30').slice(0, 5)

  // Get the campaign-local weekday and time via Intl, so this is correct
  // regardless of what timezone the server itself runs in.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const weekdayShort = parts.find(p => p.type === 'weekday')?.value || 'Mon'
  const hour = parts.find(p => p.type === 'hour')?.value || '00'
  const minute = parts.find(p => p.type === 'minute')?.value || '00'

  const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const todayIdx = WEEKDAY_MAP[weekdayShort] ?? 1
  if (!days.includes(todayIdx)) return false

  const nowMinutes = Number(hour) * 60 + Number(minute)
  const [startH, startM] = startStr.split(':').map(Number)
  const [endH, endM] = endStr.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  return nowMinutes >= startMinutes && nowMinutes <= endMinutes
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
  const now = new Date().toISOString()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  let campaignsQuery = supabase.from('campaigns').select('*').in('status', ['active', 'running'])
  if (targetCampaignId) campaignsQuery = campaignsQuery.eq('id', targetCampaignId)
  const { data: campaigns, error: cErr } = await campaignsQuery
  if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500 })
  if (!campaigns?.length) return new Response(JSON.stringify({ ok: true, message: 'No active campaigns', sent: 0 }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })

  let totalSent = 0, totalFailed = 0
  const results: any[] = []

  for (const campaign of campaigns) {
    if (!body.force && !isWithinSendWindow(campaign, new Date())) {
      results.push({ campaign: campaign.name, skipped: true, reason: 'outside allowed sending schedule (days/hours)' })
      continue
    }

    const perInboxLimit = campaign.per_inbox_daily_limit || 50
    const inboxIds: string[] = campaign.inbox_ids?.length ? campaign.inbox_ids : (campaign.from_inbox_id ? [campaign.from_inbox_id] : [])
    if (!inboxIds.length) { results.push({ campaign: campaign.name, skipped: true, reason: 'no inboxes configured' }); continue }

    // Load inbox accounts
    const { data: accounts } = await supabase.from('user_email_accounts').select('*').in('id', inboxIds).eq('is_active', true)
    if (!accounts?.length) { results.push({ campaign: campaign.name, skipped: true, reason: 'no active inboxes' }); continue }

    // Check per-inbox sends today and build available slots
    const inboxSlots: { account: any; remaining: number }[] = []
    for (const account of accounts) {
      const { count: sentTodayFromInbox } = await supabase
        .from('email_sends').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id).eq('inbox_id', account.id)
        .eq('status', 'sent').gte('sent_at', todayStart.toISOString())
      const remaining = perInboxLimit - (sentTodayFromInbox || 0)
      if (remaining > 0) inboxSlots.push({ account, remaining })
    }

    const totalAvailable = inboxSlots.reduce((s, x) => s + x.remaining, 0)
    if (totalAvailable === 0) { results.push({ campaign: campaign.name, skipped: true, reason: `all ${accounts.length} inboxes at ${perInboxLimit}/day limit` }); continue }

    // Load contacts due to send — up to total available slots
    const { data: contacts } = await supabase
      .from('campaign_contacts').select('*').eq('campaign_id', campaign.id).eq('status', 'active')
      .or(`next_send_at.is.null,next_send_at.lte.${now}`).limit(totalAvailable)

    if (!contacts?.length) { results.push({ campaign: campaign.name, skipped: true, reason: 'no contacts due' }); continue }

    // Load this campaign's sequence steps (added via the Campaigns page).
    // A contact's next step is (current_step + 1) — step numbering starts
    // at 1, current_step starts at 0 on enrollment.
    const { data: stepsData } = await supabase
      .from('sequence_steps').select('*').eq('campaign_id', campaign.id).order('step_number')
    const steps = stepsData || []
    const stepByNumber = new Map(steps.map((s: any) => [s.step_number, s]))
    const usesSteps = steps.length > 0

    // Fallback content — only used for legacy campaigns with no sequence
    // steps configured at all (campaign-level subject/body or template_id).
    let fallbackSubject = campaign.subject || 'Partnership Opportunity - My Landlord Certificate'
    let fallbackBody = campaign.body || `Dear {{first_name}},

I hope this email finds you well.

My name is {{sender_name}} from My Landlord Certificate. We provide EICR, Gas Safety Certificates, EPCs, Fire Risk Assessments and all other property compliance certificates across London and the UK.

We work with many estate agents and lettings agencies and would love to discuss how we can support your landlord clients with fast, reliable and competitively priced certificates.

Would you be open to a quick call this week?

Kind regards,
{{sender_name}}
My Landlord Certificate
020 3996 1070
info@mylandlordcertificate.co.uk`

    if (!usesSteps && campaign.template_id) {
      const { data: tpl } = await supabase.from('email_templates').select('subject, body').eq('id', campaign.template_id).single()
      if (tpl) { fallbackSubject = tpl.subject; fallbackBody = tpl.body }
    }

    // Send with round-robin rotation respecting per-inbox limits
    let campaignSent = 0, campaignFailed = 0, campaignCompleted = 0
    let slotIndex = 0

    for (const contact of contacts) {
      const nextStepNumber = (contact.current_step || 0) + 1
      let templateSubject = fallbackSubject
      let templateBody = fallbackBody

      if (usesSteps) {
        const step: any = stepByNumber.get(nextStepNumber)
        if (!step) {
          // No more steps configured for this contact — sequence finished.
          await supabase.from('campaign_contacts').update({ status: 'completed', next_send_at: null }).eq('id', contact.id)
          campaignCompleted++
          continue
        }
        templateSubject = step.subject
        templateBody = step.body_html
      }

      // Find next inbox that still has capacity
      let slot = null
      for (let i = 0; i < inboxSlots.length; i++) {
        const s = inboxSlots[(slotIndex + i) % inboxSlots.length]
        if (s.remaining > 0) { slot = s; slotIndex = (slotIndex + i + 1) % inboxSlots.length; break }
      }
      if (!slot) break // all inboxes full

      const account = slot.account
      const fromName = account.display_name || account.gmail_address.split('@')[0]
      const vars = {
        first_name: contact.first_name || contact.company?.split(' ')[0] || contact.email.split('@')[0],
        last_name: contact.last_name || '',
        company: contact.company || '',
        email: contact.email,
        sender_name: fromName,
      }

      const subject  = personalise(templateSubject, vars)
      const emailBody = personalise(templateBody, vars)
      const trackingId = crypto.randomUUID()

      if (dryRun) {
        console.log(`[DRY RUN] ${contact.email} from ${account.gmail_address}`)
        campaignSent++; slot.remaining--; continue
      }

      try {
        const token = await getValidToken(account)
        const gmailMsgId = await sendGmail(token, account.gmail_address, fromName, contact.email, subject, emailBody, trackingId, supabaseUrl)

        await supabase.from('email_sends').insert({
          campaign_id: campaign.id, contact_id: contact.id, inbox_id: account.id,
          step_number: nextStepNumber,
          subject, body: emailBody, from_email: account.gmail_address, to_email: contact.email,
          status: 'sent', sent_at: new Date().toISOString(),
          gmail_message_id: gmailMsgId, tracking_id: trackingId,
        })

        // If there's a further step, keep the contact active and schedule
        // it for that step's delay; otherwise the sequence is complete.
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
            title: `Cold email sent: ${subject}`,
            body: emailBody.slice(0, 300),
            metadata: { campaign_id: campaign.id, from: account.gmail_address, gmail_message_id: gmailMsgId }
          })
        }

        slot.remaining--
        campaignSent++; totalSent++
        await new Promise(r => setTimeout(r, 300)) // 300ms between sends

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
      per_inbox_limit: perInboxLimit,
      inboxes: inboxSlots.map((s: any) => ({ email: s.account.gmail_address, remaining: s.remaining })),
    })
  }

  return new Response(JSON.stringify({ ok: true, total_sent: totalSent, total_failed: totalFailed, dry_run: dryRun, results }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
