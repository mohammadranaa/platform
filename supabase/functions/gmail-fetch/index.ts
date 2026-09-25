// gmail-fetch v14
// - Bounce protection is RATE-based (7-day bounce rate > 8% on 30+ sends, or 8+ bounces in 24h), not a lifetime counter
// - Delay notices ("will retry") are not counted as bounces
// - Out-of-office / auto-replies no longer stop sequences
// - Replies matched by Gmail thread as well as sender address (catches a colleague replying)
// - "Unsubscribe / remove me" replies mark the contact unsubscribed everywhere
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function refreshToken(account: any, clientId: string) {
  if (!account.refresh_token || account.refresh_token === 'NOT_CONNECTED') return null
  if (account.token_expiry && new Date() < new Date(account.token_expiry)) return account.access_token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '', refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  if (data.access_token) {
    await supabase.from('user_email_accounts').update({ access_token: data.access_token, needs_reconnect: false,
      token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() }).eq('id', account.id)
    return data.access_token
  }
  console.error(`Token refresh FAILED for ${account.gmail_address}: ${data.error}`)
  await supabase.from('user_email_accounts').update({ needs_reconnect: true, reconnect_reason: `${data.error}: ${data.error_description || ''}`.trim() }).eq('id', account.id)
  return null
}

function decodeBase64Url(str: string): string {
  if (!str) return ''
  const b = str.replace(/-/g, '+').replace(/_/g, '/')
  try { return decodeURIComponent(escape(atob(b))) } catch { return atob(b) }
}
function extractBody(payload: any) {
  let text = '', html = ''
  const walk = (p: any) => {
    if (!p) return
    if (p.body?.data) { if (p.mimeType === 'text/html') html ||= decodeBase64Url(p.body.data); else if (p.mimeType === 'text/plain') text ||= decodeBase64Url(p.body.data) }
    for (const c of p.parts || []) walk(c)
  }
  walk(payload)
  if (!text && payload?.body?.data && payload.mimeType !== 'text/html') text = decodeBase64Url(payload.body.data)
  return { text, html }
}

const BOUNCE_SENDER = /mailer-daemon|postmaster|mail-daemon|delivery-notification/i
const BOUNCE_SUBJECT = /delivery status notification \(failure\)|undeliverable|undelivered mail|delivery failed|failure notice|returned mail|address not found|mail delivery failed/i
const DELAY = /delay|will retry|temporar|warning:/i
const AUTO_SUBJECT = /out of (the )?office|automatic reply|auto[- ]?reply|autoreply|away from (the )?office|on (annual )?leave|on holiday|vacation/i
const UNSUB = /\b(unsubscribe|remove me|take me off|stop (emailing|contacting)|do not (email|contact)|not interested)\b/i
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

async function evaluateInboxHealth(account: any) {
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString()
  const since24 = new Date(Date.now() - 86400000).toISOString()
  const [{ count: sent7 }, { count: b7 }, { count: b24 }] = await Promise.all([
    supabase.from('email_sends').select('id', { count: 'exact', head: true }).eq('inbox_id', account.id).in('status', ['sent', 'bounced']).gte('sent_at', since7),
    supabase.from('email_sends').select('id', { count: 'exact', head: true }).eq('inbox_id', account.id).eq('status', 'bounced').gte('sent_at', since7),
    supabase.from('campaign_contacts').select('id', { count: 'exact', head: true }).eq('status', 'bounced').gte('bounced_at', since24)
      .in('id', (await supabase.from('email_sends').select('contact_id').eq('inbox_id', account.id).gte('sent_at', since7)).data?.map((r: any) => r.contact_id) || ['00000000-0000-0000-0000-000000000000']),
  ])
  const rate = (sent7 || 0) > 0 ? (b7 || 0) / (sent7 || 1) : 0
  const tooHigh = ((sent7 || 0) >= 30 && rate > 0.08) || (b24 || 0) >= 8
  if (tooHigh && !account.is_paused) {
    const reason = `Auto-paused: bounce rate ${(rate * 100).toFixed(1)}% over 7 days (${b7}/${sent7}), ${b24} in 24h`
    await supabase.from('user_email_accounts').update({ is_paused: true, paused_reason: reason, paused_at: new Date().toISOString() }).eq('id', account.id)
    await supabase.from('notifications').insert({ type: 'campaign_bounce', title: `⚠ Inbox auto-paused: ${account.gmail_address}`,
      body: `${reason}. Check the lead list for bad addresses, then resume the inbox from Campaigns.`, link: '/campaigns' }).then(() => {}, () => {})
  }
}

async function handleCampaignSignal(account: any, msg: any, fromEmail: string, subject: string, snippet: string, bodyText: string, headers: any[]) {
  if (account.account_type !== 'cold') return
  const h = (n: string) => headers.find((x: any) => x.name.toLowerCase() === n.toLowerCase())?.value || ''

  // ---- Bounces ----
  if (BOUNCE_SENDER.test(fromEmail) || BOUNCE_SUBJECT.test(subject || '')) {
    if (DELAY.test(subject || '') && !BOUNCE_SUBJECT.test(subject || '')) return // delay notice, not a bounce
    const own = account.gmail_address.toLowerCase()
    const candidates = [...new Set([...(subject || '').matchAll(EMAIL_RE), ...(snippet || '').matchAll(EMAIL_RE), ...(bodyText || '').matchAll(EMAIL_RE)]
      .map(m => m[0].toLowerCase()).filter(e => e !== own && !BOUNCE_SENDER.test(e)))]
    if (!candidates.length) return
    const { data: sends } = await supabase.from('email_sends').select('id, contact_id, to_email').eq('inbox_id', account.id)
      .in('to_email', candidates).eq('status', 'sent').order('sent_at', { ascending: false }).limit(1)
    const hit = sends?.[0]
    if (!hit) return
    await supabase.from('email_sends').update({ status: 'bounced' }).eq('id', hit.id)
    await supabase.from('campaign_contacts').update({ status: 'bounced', next_send_at: null, bounced_at: new Date().toISOString() })
      .ilike('email', hit.to_email).not('status', 'in', '(replied,unsubscribed)')
    await supabase.from('user_email_accounts').update({ bounce_count: (account.bounce_count || 0) + 1 }).eq('id', account.id)
    await supabase.from('leads').update({ email_verified: 'Unverified' }).ilike('cold_email', hit.to_email)
    await evaluateInboxHealth(account)
    return
  }

  // ---- Find the contact: by thread first (catches colleagues replying), then by sender ----
  const contactIds = new Set<string>()
  const { data: byThread } = await supabase.from('email_sends').select('contact_id').eq('inbox_id', account.id).eq('gmail_thread_id', msg.threadId).limit(5)
  for (const r of byThread || []) contactIds.add(r.contact_id)
  const { data: byEmail } = await supabase.from('campaign_contacts').select('id').ilike('email', fromEmail)
  for (const r of byEmail || []) contactIds.add(r.id)
  if (!contactIds.size) return

  const { data: contacts } = await supabase.from('campaign_contacts').select('id, campaign_id, lead_id, email, status').in('id', [...contactIds])
  const live = (contacts || []).filter((c: any) => !['replied', 'bounced', 'unsubscribed'].includes(c.status))
  if (!live.length) return

  // ---- Out-of-office: log it, keep the sequence going ----
  const isAuto = AUTO_SUBJECT.test(subject || '') || /auto-replied|auto-generated/i.test(h('Auto-Submitted')) || !!h('X-Autoreply') || !!h('X-Autorespond')
  if (isAuto) {
    for (const c of live) if (c.lead_id) await supabase.from('activities').insert({ lead_id: c.lead_id, rep_name: 'System', activity_type: 'email',
      title: `🏖 Auto-reply from ${fromEmail}`, body: snippet || '', metadata: { campaign_id: c.campaign_id, auto_reply: true } }).then(() => {}, () => {})
    return
  }

  const wantsOut = UNSUB.test(`${subject} ${snippet} ${(bodyText || '').slice(0, 400)}`)
  const newStatus = wantsOut ? 'unsubscribed' : 'replied'
  const emails = [...new Set(live.map((c: any) => c.email.toLowerCase()))]
  for (const e of emails) {
    // Stop this address in EVERY campaign, not just the one they replied to
    await supabase.from('campaign_contacts').update({ status: newStatus, next_send_at: null })
      .ilike('email', e).not('status', 'in', '(replied,bounced,unsubscribed)')
  }
  for (const c of live) {
    const { data: s } = await supabase.from('email_sends').select('id').eq('contact_id', c.id).is('replied_at', null).order('sent_at', { ascending: false }).limit(1)
    if (s?.[0]) await supabase.from('email_sends').update({ replied_at: new Date().toISOString() }).eq('id', s[0].id)
    const { data: camp } = await supabase.from('campaigns').select('name').eq('id', c.campaign_id).maybeSingle()
    if (c.lead_id) await supabase.from('activities').insert({ lead_id: c.lead_id, rep_name: 'System', activity_type: 'email',
      title: wantsOut ? `🚫 Unsubscribe request from ${fromEmail}` : `↩ Reply received from ${fromEmail}`,
      body: snippet || '', metadata: { campaign_id: c.campaign_id, campaign_name: camp?.name || null, from_email: fromEmail } }).then(() => {}, () => {})
    await supabase.from('notifications').insert({ type: 'campaign_reply',
      title: wantsOut ? `🚫 Unsubscribe: ${fromEmail}` : `↩ Reply from ${fromEmail}`,
      body: `${fromEmail} ${wantsOut ? 'asked to be removed from' : 'replied to'} "${camp?.name || 'a campaign'}" — sequence stopped.`,
      link: c.lead_id ? `/leads/${c.lead_id}` : '/campaigns' }).then(() => {}, () => {})
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } })
  let body: any; try { body = await req.json() } catch { body = {} }
  const clientId = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
  const type = body.account_type || 'personal'
  const limit = body.max_results || 30
  const started = Date.now()

  const { data: accounts } = await supabase.from('user_email_accounts').select('*').eq('account_type', type).eq('is_active', true)
  if (!accounts?.length) return new Response(JSON.stringify({ ok: true, accounts: 0 }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })

  let totalNew = 0
  for (const account of accounts) {
    if (Date.now() - started > 120_000) break
    try {
      const token = await refreshToken(account, clientId)
      if (!token) continue
      const auth = { headers: { Authorization: `Bearer ${token}` } }
      const [inboxData, sentData] = await Promise.all([
        fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX`, auth).then(r => r.json()),
        fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=SENT`, auth).then(r => r.json()),
      ])
      const ids = new Map<string, string>()
      for (const m of inboxData.messages || []) ids.set(m.id, 'inbox')
      for (const m of sentData.messages || []) if (!ids.has(m.id)) ids.set(m.id, 'sent')
      if (!ids.size) continue
      const { data: known } = await supabase.from('gmail_messages').select('gmail_id').eq('account_id', account.id).in('gmail_id', [...ids.keys()])
      const seen = new Set((known || []).map((k: any) => k.gmail_id))
      for (const [msgId, mailType] of ids) {
        if (seen.has(msgId)) continue
        const msg = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, auth).then(r => r.json())
        const headers = msg.payload?.headers || []
        const gh = (n: string) => headers.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || ''
        const fromRaw = gh('From')
        const fm = fromRaw.match(/^(.*?)\s*<(.+?)>$/)
        const fromName = fm ? fm[1].replace(/"/g, '').trim() : ''
        const fromEmail = (fm ? fm[2] : fromRaw).trim()
        const { text, html } = extractBody(msg.payload)
        const isSent = msg.labelIds?.includes('SENT'), isInbox = msg.labelIds?.includes('INBOX')
        const actual = isSent && !isInbox ? 'sent' : isInbox ? 'inbox' : mailType
        await supabase.from('gmail_messages').insert({
          account_id: account.id, gmail_id: msgId, thread_id: msg.threadId, from_email: fromEmail, from_name: fromName,
          to_email: gh('To'), subject: gh('Subject'), snippet: msg.snippet, body_text: text?.slice(0, 50000), body_html: html?.slice(0, 100000),
          date: new Date(parseInt(msg.internalDate)).toISOString(), is_read: !msg.labelIds?.includes('UNREAD'),
          is_reply: isInbox && !isSent, mail_type: actual, labels: msg.labelIds,
        })
        if (actual === 'inbox') {
          try { await handleCampaignSignal(account, msg, fromEmail, gh('Subject'), msg.snippet, text, headers) }
          catch (e) { console.error('Reply/bounce handling failed:', e) }
        }
        totalNew++
      }
    } catch (err) { console.error(`Error fetching ${account.gmail_address}:`, err) }
  }
  return new Response(JSON.stringify({ ok: true, accounts: accounts.length, new_messages: totalNew }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } })
})
