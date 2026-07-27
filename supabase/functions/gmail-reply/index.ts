import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function encodeBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } })
  }

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const { account_id, thread_id, to, subject, message, client_id, client_secret } = body

  if (!account_id || !to || !message) {
    return new Response(JSON.stringify({ error: 'account_id, to, and message are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Get the account
  const { data: account } = await supabase
    .from('user_email_accounts')
    .select('*')
    .eq('id', account_id)
    .single()

  if (!account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Refresh token if needed
  let token = account.access_token
  const now = new Date()
  const expiry = new Date(account.token_expiry)
  if (now >= expiry && account.refresh_token) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client_id, client_secret: client_secret,
        refresh_token: account.refresh_token, grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (data.access_token) {
      token = data.access_token
      await supabase.from('user_email_accounts').update({
        access_token: token,
        token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      }).eq('id', account.id)
    }
  }

  // Build the RFC 2822 email
  const replySubject = subject?.startsWith('Re:') ? subject : `Re: ${subject || ''}`
  const rawEmail = [
    `From: ${account.gmail_address}`,
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `In-Reply-To: ${thread_id || ''}`,
    `References: ${thread_id || ''}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    message,
  ].join('\r\n')

  const encodedEmail = encodeBase64Url(rawEmail)

  // Send via Gmail API
  const sendUrl = thread_id
    ? `https://www.googleapis.com/gmail/v1/users/me/messages/send`
    : `https://www.googleapis.com/gmail/v1/users/me/messages/send`

  const sendBody: any = { raw: encodedEmail }
  if (thread_id) sendBody.threadId = thread_id

  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sendBody),
  })

  const sendData = await sendRes.json()

  if (sendData.error) {
    return new Response(JSON.stringify({ error: sendData.error.message }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Cache the sent message
  await supabase.from('gmail_messages').insert({
    account_id: account.id,
    gmail_id: sendData.id,
    thread_id: sendData.threadId || thread_id,
    from_email: account.gmail_address,
    from_name: account.display_name,
    to_email: to,
    subject: replySubject,
    body_text: message,
    snippet: message.slice(0, 200),
    date: new Date().toISOString(),
    is_read: true,
    is_reply: false,
    mail_type: 'sent',
    labels: ['SENT'],
  })

  return new Response(JSON.stringify({ ok: true, message_id: sendData.id }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
