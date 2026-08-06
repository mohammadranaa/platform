import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function refreshToken(account: any, clientId: string, clientSecret: string): Promise<string> {
  const expiry = new Date(account.token_expiry)
  if (new Date() < expiry) return account.access_token
  if (!account.refresh_token) {
    console.error(`No refresh token for ${account.gmail_address} — user needs to reconnect`)
    throw new Error(`Gmail account ${account.gmail_address} needs to be reconnected. Go to Email Inbox and reconnect.`)
  }
  if (!clientId || !clientSecret) {
    console.error('Cannot refresh token: missing Google OAuth credentials')
    throw new Error('Gmail token expired and cannot be refreshed. Contact admin to set Google OAuth credentials.')
  }
  console.log(`Refreshing token for ${account.gmail_address}...`)
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
    const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
    await supabase.from('user_email_accounts').update({
      access_token: data.access_token,
      token_expiry: newExpiry,
    }).eq('id', account.id)
    console.log(`Token refreshed for ${account.gmail_address}, expires ${newExpiry}`)
    return data.access_token
  }
  console.error(`Token refresh failed for ${account.gmail_address}:`, JSON.stringify(data))
  throw new Error(`Gmail token refresh failed for ${account.gmail_address}: ${data.error_description || data.error || 'Unknown error'}. Try reconnecting the account.`)
}

function cleanSubject(s: string): string {
  return (s || '')
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u00a3/g, 'GBP')
    .replace(/[^\x00-\x7F]/g, '')
    .trim()
}

// Encode bytes to base64url
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Encode string to base64url via UTF-8 bytes
function strToBase64Url(str: string): string {
  return bytesToBase64Url(new TextEncoder().encode(str))
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  // Everything below is wrapped so that ANY uncaught exception still
  // returns a response with CORS headers attached. Without this, an
  // unhandled error produces a bare response the browser cannot read
  // cross-origin, which surfaces to the user as a generic
  // "Failed to fetch" with zero diagnostic information — even though
  // the server-side work (e.g. sending the email) may have completed.
  try {
    return await handleRequest(req)
  } catch (err: any) {
    console.error('Unhandled error in gmail-reply:', err)
    return new Response(JSON.stringify({ error: err?.message || 'Unexpected server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }
})

async function handleRequest(req: Request): Promise<Response> {
  let body: any
  try { body = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }) }

  const { account_id, thread_id, to, subject, message, attachment_base64, attachment_name, attachment_mime } = body

  // Google OAuth credentials: prefer request body, fall back to server env
  const client_id = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
  const client_secret = body.client_secret || Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

  if (!client_id || !client_secret) {
    console.error('No Google OAuth credentials available. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Supabase secrets.')
  }

  if (!account_id || !to || !message) {
    return new Response(JSON.stringify({ error: 'account_id, to, and message are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  const { data: account } = await supabase
    .from('user_email_accounts').select('*').eq('id', account_id).single()
  if (!account) {
    return new Response(JSON.stringify({ error: 'Account not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  const token = await refreshToken(account, client_id, client_secret)
  const safeSubject = cleanSubject(subject || 'My Landlord Certificate')
  const fromName = account.send_as_name || account.display_name || 'My Landlord Certificate'
  // Use the configured "Send As" alias if one is set (e.g. info@...
  // sent through an asad@... mailbox that has it added under Gmail
  // Settings > Accounts > Send mail as). Falls back to the connected
  // mailbox's own address if no alias is configured.
  const fromAddr = account.send_as_email || account.gmail_address
  const boundary = 'mlc' + Date.now().toString(36)

  // Build RFC 2822 message as a raw string
  // CRITICAL: headers and body must be separated by exactly one blank line
  // The entire string is then base64url encoded for the Gmail API raw field
  let mime: string

  if (attachment_base64 && attachment_name) {
    const mimeType = attachment_mime || 'application/pdf'
    // Split attachment into 76-char lines per RFC 2045
    const b64clean = (attachment_base64 as string).replace(/\s/g, '')
    const b64lines = b64clean.match(/.{1,76}/g)?.join('\r\n') || b64clean

    mime = [
      `From: ${fromName} <${fromAddr}>`,
      `To: ${to}`,
      `Subject: ${safeSubject}`,
      ...(thread_id ? [`In-Reply-To: <${thread_id}>`, `References: <${thread_id}>`] : []),
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',                                          // blank line separates headers from body
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      message.replace(/\n/g, '\r\n'),             // body text
      '',
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${attachment_name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment_name}"`,
      '',
      b64lines,
      '',
      `--${boundary}--`,
    ].join('\r\n')
  } else {
    mime = [
      `From: ${fromName} <${fromAddr}>`,
      `To: ${to}`,
      `Subject: ${safeSubject}`,
      ...(thread_id ? [`In-Reply-To: <${thread_id}>`, `References: <${thread_id}>`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',                                          // blank line separates headers from body
      message.replace(/\n/g, '\r\n'),
    ].join('\r\n')
  }

  // Encode the entire RFC 2822 message as base64url for Gmail API
  const raw = strToBase64Url(mime)

  const payload: any = { raw }
  if (thread_id) payload.threadId = thread_id

  const sendRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const sendData = await sendRes.json()

  if (sendData.error) {
    console.error('Gmail error:', JSON.stringify(sendData.error))
    return new Response(JSON.stringify({ error: sendData.error.message }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    })
  }

  // Cache sent message (non-critical — never block the response)
  try {
    await supabase.from('gmail_messages').insert({
      account_id: account.id, gmail_id: sendData.id,
      thread_id: sendData.threadId || thread_id,
      from_email: fromAddr, from_name: fromName,
      to_email: to, subject: safeSubject,
      body_text: message, snippet: message.slice(0, 200),
      date: new Date().toISOString(),
      is_read: true, is_reply: false, mail_type: 'sent', labels: ['SENT'],
    })
  } catch (e) { console.log('gmail_messages cache failed (non-critical):', e) }

  return new Response(JSON.stringify({ ok: true, message_id: sendData.id }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  })
}
