// ============================================================
// MLC PLATFORM — Edge Function: send-sequences
// Runs every hour via Supabase cron
// Finds contacts due for their next email, picks an inbox,
// renders the template, sends via SMTP, logs the send
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async () => {
  try {
    const results = await processSequences()
    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-sequences error:', err)
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

async function processSequences() {
  const now = new Date().toISOString()
  let sent = 0
  let skipped = 0
  let errors = 0

  // 1. Find all active contacts due for their next email
  const { data: contacts, error: contactsError } = await supabase
    .from('campaign_contacts')
    .select(`
      *,
      campaigns (
        id, name, from_name, daily_limit, status,
        track_opens, track_clicks,
        campaign_inboxes ( inbox_id )
      )
    `)
    .eq('status', 'active')
    .lte('next_send_at', now)
    .limit(100)

  if (contactsError) throw new Error('Failed to fetch contacts: ' + contactsError.message)
  if (!contacts || contacts.length === 0) {
    return { sent: 0, message: 'No contacts due for sending' }
  }

  for (const contact of contacts) {
    const campaign = contact.campaigns
    if (!campaign || campaign.status !== 'active') {
      skipped++
      continue
    }

    try {
      // 2. Get the next sequence step for this contact
      const nextStepNumber = contact.current_step + 1
      const { data: step } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('campaign_id', campaign.id)
        .eq('step_number', nextStepNumber)
        .single()

      if (!step) {
        // No more steps — mark as completed
        await supabase
          .from('campaign_contacts')
          .update({ status: 'completed' })
          .eq('id', contact.id)
        skipped++
        continue
      }

      // 3. Pick the best available inbox for this campaign
      const inbox = await pickInbox(campaign)
      if (!inbox) {
        console.log(`No available inbox for campaign ${campaign.id}`)
        skipped++
        continue
      }

      // 4. Check campaign daily limit
      const campaignSentToday = await getCampaignSentToday(campaign.id)
      if (campaignSentToday >= campaign.daily_limit) {
        skipped++
        continue
      }

      // 5. Render the email with personalisation variables
      const trackingId = crypto.randomUUID()
      const rendered = renderTemplate(step.subject, step.body_html, contact, campaign, trackingId)

      // 6. Send the email via SMTP
      await sendEmail({
        inbox,
        from: `${campaign.from_name} <${inbox.email}>`,
        to: contact.email,
        subject: rendered.subject,
        html: rendered.html,
      })

      // 7. Log the send
      await supabase.from('email_sends').insert({
        campaign_id: campaign.id,
        contact_id: contact.id,
        inbox_id: inbox.id,
        step_number: nextStepNumber,
        subject: rendered.subject,
        status: 'sent',
        tracking_id: trackingId,
      })

      // 8. Increment inbox sent_today counter
      await supabase
        .from('inboxes')
        .update({ sent_today: inbox.sent_today + 1 })
        .eq('id', inbox.id)

      // 9. Advance the contact to the next step
      const nextStep = await getNextStep(campaign.id, nextStepNumber)
      const nextSendAt = nextStep
        ? new Date(Date.now() + nextStep.delay_days * 86400000).toISOString()
        : null

      await supabase
        .from('campaign_contacts')
        .update({
          current_step: nextStepNumber,
          next_send_at: nextSendAt,
          status: nextSendAt ? 'active' : 'completed',
        })
        .eq('id', contact.id)

      sent++
    } catch (err) {
      console.error(`Failed to send to ${contact.email}:`, err)

      // Mark as bounced if SMTP error
      if (String(err).includes('550') || String(err).includes('bounce')) {
        await supabase
          .from('campaign_contacts')
          .update({ status: 'bounced' })
          .eq('id', contact.id)
      }

      errors++
    }
  }

  return { sent, skipped, errors }
}

// ── Pick the best inbox for a campaign ───────────────────────
// Chooses the inbox with the most remaining capacity today
async function pickInbox(campaign: any) {
  const inboxIds = campaign.campaign_inboxes?.map((ci: any) => ci.inbox_id) || []
  if (inboxIds.length === 0) return null

  const today = new Date().toISOString().slice(0, 10)

  const { data: inboxes } = await supabase
    .from('inboxes')
    .select('*')
    .in('id', inboxIds)
    .eq('is_active', true)

  if (!inboxes || inboxes.length === 0) return null

  // Reset daily counter if it's a new day
  for (const inbox of inboxes) {
    if (inbox.last_reset_at !== today) {
      await supabase
        .from('inboxes')
        .update({ sent_today: 0, last_reset_at: today })
        .eq('id', inbox.id)
      inbox.sent_today = 0
      inbox.last_reset_at = today
    }
  }

  // Calculate today's warm-up limit for each inbox
  const withCapacity = inboxes.map(inbox => {
    const daysSince = Math.floor(
      (Date.now() - new Date(inbox.warmup_started_at).getTime()) / 86400000
    )
    const intervals = Math.floor(daysSince / (inbox.warmup_interval_days || 3))
    const dailyLimit = inbox.warmup_enabled
      ? Math.min(
          (inbox.warmup_start_limit || 10) + intervals * (inbox.warmup_step || 5),
          inbox.warmup_max_limit || 50
        )
      : inbox.warmup_max_limit || 50
    const remaining = dailyLimit - inbox.sent_today
    return { ...inbox, dailyLimit, remaining }
  })

  // Pick the inbox with the most remaining capacity
  const best = withCapacity
    .filter(i => i.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)[0]

  return best || null
}

// ── Get how many emails this campaign has sent today ─────────
async function getCampaignSentToday(campaignId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await supabase
    .from('email_sends')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .gte('sent_at', today + 'T00:00:00Z')
  return count || 0
}

// ── Get the step after the current one ──────────────────────
async function getNextStep(campaignId: string, currentStepNumber: number) {
  const { data } = await supabase
    .from('sequence_steps')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('step_number', currentStepNumber + 1)
    .single()
  return data
}

// ── Render template variables ────────────────────────────────
// Replaces {{first_name}}, {{company}}, etc. in subject and body
function renderTemplate(
  subject: string,
  bodyHtml: string,
  contact: any,
  campaign: any,
  trackingId: string
) {
  const vars: Record<string, string> = {
    first_name: contact.first_name || '',
    last_name:  contact.last_name  || '',
    company:    contact.company    || '',
    email:      contact.email      || '',
    from_name:  campaign.from_name || '',
    ...contact.custom_vars,
  }

  const replace = (str: string) =>
    str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '')

  // Append open tracking pixel if enabled
  const trackingPixel = campaign.track_opens
    ? `<img src="${Deno.env.get('SUPABASE_URL')}/functions/v1/track-open?id=${trackingId}" width="1" height="1" style="display:none" />`
    : ''

  // Convert plain text line breaks to HTML
  const htmlBody = replace(bodyHtml)
    .replace(/\n/g, '<br>')

  return {
    subject: replace(subject),
    html: `
      <div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #333; max-width: 600px;">
        ${htmlBody}
      </div>
      ${trackingPixel}
    `,
  }
}

// ── Send email via SMTP ──────────────────────────────────────
async function sendEmail({ inbox, from, to, subject, html }: {
  inbox: any
  from: string
  to: string
  subject: string
  html: string
}) {
  const client = new SMTPClient({
    connection: {
      hostname: inbox.smtp_host,
      port: inbox.smtp_port,
      tls: inbox.smtp_port === 465,
      auth: {
        username: inbox.smtp_user,
        password: inbox.smtp_pass,
      },
    },
  })

  await client.send({
    from,
    to,
    subject,
    content: 'auto',
    html,
  })

  await client.close()
}
