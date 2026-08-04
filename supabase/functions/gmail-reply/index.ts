import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function refreshToken(account: any, clientId: string, clientSecret: string): Promise<string> {
  const now = new Date()
  const expiry = new Date(account.token_expiry)
  if (now < expiry) return account.access_token
  if (!account.refresh_token) return account.access_token

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
    await supabase.from('user_email_accounts').update({
      access_token: data.access_token,
      token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    }).eq('id', account.id)
    return data.access_token
  }
  return account.access_token
}

// Encode string to base64url (for the overall message wrapper)
function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Clean subject - remove all non-ASCII characters that cause encoding issues
function cleanSubject(subject: string): string {
  return (subject || '')
    .replace(/\u2014/g, '--')   // em dash
    .replace(/\u2013/g, '-')    // en dash
    .replace(/\u00a3/g, 'GBP')  // £
    .replace(/[^\x00-\x7F]/g, '') // strip any remaining non-ASCII
    .trim()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const {
    account_id, thread_id, to, subject, message,
    client_id, client_secret,
    attachment_base64, attachment_name, attachment_mime,
  } = body

  if (!account_id || !to || !message) {
    return new Response(JSON.stringify({ error: 'account_id, to, and message are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Get the account
  const { data: account, error: accErr } = await supabase
    .from('user_email_accounts')
    .select('*')
    .eq('id', account_id)
    .single()

  if (accErr || !account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  const token = await refreshToken(account, client_id, client_secret)
  const safeSubject = cleanSubject(subject || 'My Landlord Certificate')
  const fromDisplay = `${account.display_name || 'My Landlord Certificate'} <${account.gmail_address}>`

  // Build the raw MIME email
  let rawEmail: string
  const boundary = `mlc_boundary_${Date.now()}`

  if (attachment_base64 && attachment_name) {
    // Multipart email WITH attachment
    const mimeType = attachment_mime || 'application/pdf'
    // Split base64 into 76-char lines per RFC 2045
    const b64Lines = (attachment_base64 as string).replace(/\s/g, '').match(/.{1,76}/g)?.join('\r\n') || attachment_base64

    const parts: string[] = [
      `From: ${fromDisplay}`,
      `To: ${to}`,
      `Subject: ${safeSubject}`,
      thread_id ? `In-Reply-To: <${thread_id}>` : '',
      thread_id ? `References: <${thread_id}>` : '',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      message,
      '',
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${attachment_name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment_name}"`,
      '',
      b64Lines,
      '',
      `--${boundary}--`,
    ].filter(l => l !== null)

    rawEmail = parts.join('\r\n')

  } else {
    // Plain text email - NO base64 encoding of body, use 7bit
    const parts: string[] = [
      `From: ${fromDisplay}`,
      `To: ${to}`,
      `Subject: ${safeSubject}`,
      thread_id ? `In-Reply-To: <${thread_id}>` : '',
      thread_id ? `References: <${thread_id}>` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      message,
    ].filter(l => l !== null)

    rawEmail = parts.join('\r\n')
  }

  // The entire raw message is base64url encoded for the Gmail API
  const encodedRaw = toBase64Url(rawEmail)

  const sendBody: any = { raw: encodedRaw }
  if (thread_id) sendBody.threadId = thread_id

  const sendRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sendBody),
  })

  const sendData = await sendRes.json()

  if (sendData.error) {
    console.error('Gmail send error:', JSON.stringify(sendData.error))
    return new Response(JSON.stringify({ error: sendData.error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Cache the sent message (non-critical)
  supabase.from('gmail_messages').insert({
    account_id: account.id,
    gmail_id: sendData.id,
    thread_id: sendData.threadId || thread_id,
    from_email: account.gmail_address,
    from_name: account.display_name,
    to_email: to,
    subject: safeSubject,
    body_text: message,
    snippet: message.slice(0, 200),
    date: new Date().toISOString(),
    is_read: true,
    is_reply: false,
    mail_type: 'sent',
    labels: ['SENT'],
  }).catch(() => {})

  return new Response(JSON.stringify({ ok: true, message_id: sendData.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
