// track-open v5 — always returns the pixel (v4 crashed on every first open: rpc().catch is not a function)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const PIXEL = new Uint8Array([71,73,70,56,57,97,1,0,1,0,128,0,0,255,255,255,0,0,0,33,249,4,0,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59])
const pixel = () => new Response(PIXEL, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' } })

Deno.serve(async (req: Request) => {
  try {
    const t = new URL(req.url).searchParams.get('t')
    if (!t) return pixel()
    const { data: send } = await supabase.from('email_sends').select('id, contact_id, campaign_id, open_count, subject').eq('tracking_id', t).maybeSingle()
    if (!send) return pixel()
    const now = new Date().toISOString()
    const first = !send.open_count
    await supabase.from('email_sends').update(first ? { open_count: 1, opened_at: now } : { open_count: send.open_count + 1 }).eq('id', send.id)
    if (first) {
      const { data: contact } = await supabase.from('campaign_contacts').select('lead_id, first_opened_at').eq('id', send.contact_id).maybeSingle()
      if (contact && !contact.first_opened_at) await supabase.from('campaign_contacts').update({ first_opened_at: now }).eq('id', send.contact_id)
      if (contact?.lead_id) {
        const { data: lead } = await supabase.from('leads').select('email_open_count').eq('id', contact.lead_id).maybeSingle()
        if (lead) await supabase.from('leads').update({ last_email_opened_at: now, email_open_count: (lead.email_open_count || 0) + 1 }).eq('id', contact.lead_id)
        await supabase.from('activities').insert({ lead_id: contact.lead_id, rep_name: 'System', activity_type: 'system',
          title: `📬 Email opened: ${send.subject || 'campaign email'}`, body: 'The lead opened this email.',
          metadata: { campaign_id: send.campaign_id, email_send_id: send.id } })
      }
      const { error } = await supabase.rpc('increment_campaign_opens', { p_campaign_id: send.campaign_id })
      if (error) console.error('increment_campaign_opens:', error.message)
    }
  } catch (e) {
    console.error('track-open error:', e)
  }
  return pixel()
})
