import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// MIME body Content-Transfer-Encoding requires STANDARD base64 (+/ with padding),
// not the URL-safe variant used for the outer Gmail API `raw` field.
function encodeBase64Standard(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  return btoa(binary)
}

function buildMimeBoundary() {
  return 'boundary_mlc_' + Date.now().toString(36)
}

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

  // Clean subject — remove any em dash encoding issues
  const cleanSubject = (subject || '')
    .replace(/â€"/g, '-')
    .replace(/â€"/g, '--')
    .replace(/[^\x00-\x7F]/g, (c) => {
      // Keep the character but encode it properly for email headers
      return c
    })
    .trim()

  // Build email — with or without attachment
  let rawEmail: string

  if (attachment_base64 && attachment_name) {
    // Multipart email with attachment
    const boundary = buildMimeBoundary()
    const mimeType = attachment_mime || 'application/pdf'

    const parts = [
      `From: ${account.display_name || account.gmail_address} <${account.gmail_address}>`,
      `To: ${to}`,
      `Subject: ${cleanSubject}`,
      thread_id ? `In-Reply-To: ${thread_id}` : '',
      thread_id ? `References: ${thread_id}` : '',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      message,
      '',
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${attachment_name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment_name}"`,
      '',
      // Split base64 into 76-char lines (RFC 2045)
      attachment_base64.match(/.{1,76}/g)?.join('\r\n') || attachment_base64,
      '',
      `--${boundary}--`,
    ].filter(l => l !== null).join('\r\n')

    rawEmail = parts
  } else {
    // Plain text email
    rawEmail = [
      `From: ${account.display_name || account.gmail_address} <${account.gmail_address}>`,
      `To: ${to}`,
      `Subject: ${cleanSubject}`,
      thread_id ? `In-Reply-To: ${thread_id}` : '',
      thread_id ? `References: ${thread_id}` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64Standard(message),
    ].filter(l => l !== null).join('\r\n')
  }

  const encodedEmail = encodeBase64Url(rawEmail)

  const sendBody: any = { raw: encodedEmail }
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
    console.error('Gmail send error:', sendData.error)
    return new Response(JSON.stringify({ error: sendData.error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Cache sent message
  await supabase.from('gmail_messages').insert({
    account_id: account.id,
    gmail_id: sendData.id,
    thread_id: sendData.threadId || thread_id,
    from_email: account.gmail_address,
    from_name: account.display_name,
    to_email: to,
    subject: cleanSubject,
    body_text: message,
    snippet: message.slice(0, 200),
    date: new Date().toISOString(),
    is_read: true,
    is_reply: false,
    mail_type: 'sent',
    labels: ['SENT'],
  }).catch(() => {}) // non-critical

  return new Response(JSON.stringify({ ok: true, message_id: sendData.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
