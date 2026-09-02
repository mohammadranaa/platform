import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// 1x1 transparent GIF
const PIXEL = new Uint8Array([
  71,73,70,56,57,97,1,0,1,0,128,0,0,255,255,255,0,0,0,33,249,4,0,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59
])

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const trackingId = url.searchParams.get('t')

  if (trackingId) {
    // Find the email send record
    const { data: send } = await supabase
      .from('email_sends')
      .select('id, contact_id, campaign_id, open_count')
      .eq('tracking_id', trackingId)
      .single()

    if (send) {
      const now = new Date().toISOString()
      const isFirstOpen = !send.open_count || send.open_count === 0

      // Update the send record. Deliberately NOT touching `status` here --
      // it stays 'sent'. send-sequences counts each inbox's sends-today by
      // filtering email_sends on status='sent'; flipping it to 'opened'
      // would make opened emails invisible to that count and silently blow
      // past the daily/warmup caps.
      await supabase.from('email_sends').update({
        open_count: (send.open_count || 0) + 1,
        opened_at: isFirstOpen ? now : undefined,
      }).eq('id', send.id)

      // Update the contact -- track that they opened without touching
      // `status`, which is what send-sequences uses to decide who's still
      // active in the sequence. Overwriting it here used to silently end
      // every contact's sequence the moment they opened one email.
      if (isFirstOpen) {
        await supabase.from('campaign_contacts').update({
          first_opened_at: new Date().toISOString(),
        }).eq('id', send.contact_id)
      }

      // Engagement trigger handles the lead update automatically
      if (isFirstOpen) {
        // Get lead_id from contact
        const { data: contact } = await supabase
          .from('campaign_contacts')
          .select('lead_id')
          .eq('id', send.contact_id)
          .single()

        if (contact?.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('email_open_count')
            .eq('id', contact.lead_id)
            .single()

          if (lead) {
            await supabase.from('leads').update({
              last_email_opened_at: now,
              email_open_count: (lead.email_open_count || 0) + 1,
            }).eq('id', contact.lead_id)
          }

          const { data: sendRow } = await supabase
            .from('email_sends').select('subject').eq('id', send.id).single()

          await supabase.from('activities').insert({
            lead_id: contact.lead_id,
            rep_name: 'System',
            activity_type: 'system',
            title: `📬 Email opened: ${sendRow?.subject || 'campaign email'}`,
            body: 'The lead opened this email.',
            metadata: { campaign_id: send.campaign_id, email_send_id: send.id },
          })
        }

        // Update campaign total
        await supabase.rpc('increment_campaign_opens', { p_campaign_id: send.campaign_id }).catch(() => {})
      }
    }
  }

  // Always return the tracking pixel
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    }
  })
})
