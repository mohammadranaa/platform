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
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()
  if (data.access_token) {
    await supabase
      .from('user_email_accounts')
      .update({
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      })
      .eq('id', account.id)
    return data.access_token
  }
  return account.access_token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }

  const { account_type, client_id, client_secret, max_results } = body
  const type = account_type || 'personal'
  const limit = max_results || 20

  // Get all active accounts of this type
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

  const allMessages: any[] = []

  for (const account of accounts) {
    try {
      const token = await refreshToken(account, client_id, client_secret)

      // Fetch recent messages
      const listRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      const listData = await listRes.json()

      if (!listData.messages) continue

      for (const msg of listData.messages.slice(0, limit)) {
        // Check if already cached
        const { data: existing } = await supabase
          .from('gmail_messages')
          .select('id')
          .eq('account_id', account.id)
          .eq('gmail_id', msg.id)
          .limit(1)

        if (existing?.length) continue

        // Fetch full message
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        )
        const msgData = await msgRes.json()

        const headers = msgData.payload?.headers || []
        const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        const fromRaw = getHeader('From')
        const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/)
        const fromName = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : ''
        const fromEmail = fromMatch ? fromMatch[2] : fromRaw

        await supabase.from('gmail_messages').insert({
          account_id: account.id,
          gmail_id: msg.id,
          thread_id: msgData.threadId,
          from_email: fromEmail,
          from_name: fromName,
          to_email: getHeader('To'),
          subject: getHeader('Subject'),
          snippet: msgData.snippet,
          date: new Date(parseInt(msgData.internalDate)).toISOString(),
          is_read: !msgData.labelIds?.includes('UNREAD'),
          is_reply: msgData.labelIds?.includes('SENT') ? false : true,
          labels: msgData.labelIds,
        })

        allMessages.push({
          gmail_id: msg.id,
          account: account.gmail_address,
          from: fromEmail,
          subject: getHeader('Subject'),
          date: new Date(parseInt(msgData.internalDate)).toISOString(),
        })
      }
    } catch (err) {
      console.error(`Error fetching ${account.gmail_address}:`, err)
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    accounts: accounts.length,
    new_messages: allMessages.length,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
