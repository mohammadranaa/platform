import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function refreshToken(account: any, clientId: string, clientSecret: string) {
  if (!account.refresh_token) return account.access_token
  const now = new Date()
  const expiry = new Date(account.token_expiry)
  if (now < expiry) return account.access_token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: account.refresh_token, grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.access_token) {
    await supabase.from('user_email_accounts').update({
      access_token: data.access_token,
      token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    }).eq('id', account.id)
    return data.access_token
  }
  return account.access_token
}

function decodeBase64Url(str: string): string {
  if (!str) return ''
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  try { return decodeURIComponent(escape(atob(base64))) } catch { return atob(base64) }
}

function extractBody(payload: any): { text: string, html: string } {
  let text = '', html = ''
  
  if (!payload) return { text, html }

  // Simple message (no parts)
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data)
    if (payload.mimeType === 'text/html') html = decoded
    else text = decoded
  }

  // Multipart message
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeBase64Url(part.body.data)
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeBase64Url(part.body.data)
      } else if (part.parts) {
        // Nested multipart
        for (const sub of part.parts) {
          if (sub.mimeType === 'text/plain' && sub.body?.data) text = decodeBase64Url(sub.body.data)
          if (sub.mimeType === 'text/html' && sub.body?.data) html = decodeBase64Url(sub.body.data)
        }
      }
    }
  }

  return { text, html }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }

  const { account_type, client_id, client_secret, max_results } = body
  const type = account_type || 'personal'
  const limit = max_results || 30

  const { data: accounts } = await supabase
    .from('user_email_accounts')
    .select('*')
    .eq('account_type', type)
    .eq('is_active', true)

  if (!accounts?.length) {
    return new Response(JSON.stringify({ ok: true, messages: [], accounts: 0 }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  let totalNew = 0

  for (const account of accounts) {
    try {
      const token = await refreshToken(account, client_id, client_secret)

      // Fetch INBOX messages
      const inboxRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const inboxData = await inboxRes.json()

      // Fetch SENT messages
      const sentRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=SENT`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const sentData = await sentRes.json()

      // Combine and deduplicate
      const allMsgIds = new Map<string, string>()
      for (const m of (inboxData.messages || [])) allMsgIds.set(m.id, 'inbox')
      for (const m of (sentData.messages || [])) {
        if (!allMsgIds.has(m.id)) allMsgIds.set(m.id, 'sent')
      }

      for (const [msgId, mailType] of allMsgIds) {
        // Skip if already cached
        const { data: existing } = await supabase
          .from('gmail_messages')
          .select('id')
          .eq('account_id', account.id)
          .eq('gmail_id', msgId)
          .limit(1)
        if (existing?.length) continue

        // Fetch FULL message (not just metadata)
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
        const msgData = await msgRes.json()

        const headers = msgData.payload?.headers || []
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        const fromRaw = getHeader('From')
        const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/)
        const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : ''
        const fromEmail = fromMatch ? fromMatch[2] : fromRaw

        const { text: bodyText, html: bodyHtml } = extractBody(msgData.payload)

        // Determine if this is a reply (received in inbox, not sent by us)
        const isSent = msgData.labelIds?.includes('SENT') || false
        const isInbox = msgData.labelIds?.includes('INBOX') || false
        const actualMailType = isSent && !isInbox ? 'sent' : isInbox ? 'inbox' : mailType

        await supabase.from('gmail_messages').insert({
          account_id: account.id,
          gmail_id: msgId,
          thread_id: msgData.threadId,
          from_email: fromEmail,
          from_name: fromName,
          to_email: getHeader('To'),
          subject: getHeader('Subject'),
          snippet: msgData.snippet,
          body_text: bodyText?.slice(0, 50000),
          body_html: bodyHtml?.slice(0, 100000),
          date: new Date(parseInt(msgData.internalDate)).toISOString(),
          is_read: !msgData.labelIds?.includes('UNREAD'),
          is_reply: isInbox && !isSent,
          mail_type: actualMailType,
          labels: msgData.labelIds,
        })

        totalNew++
      }
    } catch (err) {
      console.error(`Error fetching ${account.gmail_address}:`, err)
    }
  }

  return new Response(JSON.stringify({
    ok: true, accounts: accounts.length, new_messages: totalNew,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
