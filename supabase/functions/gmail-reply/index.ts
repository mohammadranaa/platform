import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

function ok(data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

function cleanSubject(s: string): string {
  return (s || '').replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/\u00a3/g, 'GBP').replace(/[^\x00-\x7F]/g, '').trim()
}

async function refreshToken(account: any, clientId: string, clientSecret: string): Promise<string> {
  if (new Date() < new Date(account.token_expiry)) return account.access_token
  if (!account.refresh_token) throw new Error(`${account.gmail_address} needs to be reconnected in Email Inbox`)
  if (!clientId || !clientSecret) throw new Error('Missing Google OAuth credentials — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Supabase secrets')

  console.log(`Refreshing token for ${account.gmail_address}...`)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error_description || data.error || 'unknown'}`)

  const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('user_email_accounts').update({ access_token: data.access_token, token_expiry: expiry }).eq('id', account.id)
  console.log(`Token refreshed for ${account.gmail_address}`)
  return data.access_token
}

// Encode string to base64url for Gmail API raw field
function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => null)
    if (!body) return err('Invalid JSON body')

    const { account_id, to, subject, message, thread_id, attachment_base64, attachment_name, attachment_mime } = body
    const client_id = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
    const client_secret = body.client_secret || Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

    if (!account_id || !to || !message) return err('account_id, to, and message are required')

    const { data: account } = await supabase.from('user_email_accounts').select('*').eq('id', account_id).single()
    if (!account) return err('Account not found', 404)

    const token = await refreshToken(account, client_id, client_secret)
    const fromName = account.send_as_name || account.display_name || 'My Landlord Certificate'
    const fromAddr = account.send_as_email || account.gmail_address
    const safeSubject = cleanSubject(subject || 'My Landlord Certificate')
    const boundary = 'MLC' + Date.now()

    // Build the RFC 2822 message
    // IMPORTANT: For attachments, the base64 content comes from the frontend
    // (where the file was already in memory as a blob). The edge function
    // never fetches or decodes the file — it only assembles the MIME message.
    let mime: string

    if (attachment_base64 && attachment_name) {
      const mimeType = attachment_mime || 'application/pdf'
      // Split base64 into 76-char lines (RFC 2045) — no decode, just formatting
      const b64 = attachment_base64.replace(/[\r\n\s]/g, '').match(/.{1,76}/g)?.join('\r\n') || attachment_base64

      mime = [
        `From: ${fromName} <${fromAddr}>`,
        `To: ${to}`,
        `Subject: ${safeSubject}`,
        ...(thread_id ? [`In-Reply-To: <${thread_id}>`, `References: <${thread_id}>`] : []),
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        message.replace(/\n/g, '\r\n'),
        '',
        `--${boundary}`,
        `Content-Type: ${mimeType}; name="${attachment_name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment_name}"`,
        '',
        b64,
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
        '',
        message.replace(/\n/g, '\r\n'),
      ].join('\r\n')
    }

    const sendRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toBase64Url(mime), ...(thread_id ? { threadId: thread_id } : {}) }),
    })

    const sendData = await sendRes.json()
    if (sendData.error) {
      console.error('Gmail API error:', JSON.stringify(sendData.error))
      return err(sendData.error.message || 'Gmail send failed')
    }

    // Cache in gmail_messages (non-critical)
    try {
      await supabase.from('gmail_messages').insert({
        account_id: account.id, gmail_id: sendData.id,
        thread_id: sendData.threadId || thread_id,
        from_email: fromAddr, from_name: fromName,
        to_email: to, subject: safeSubject,
        body_text: message.slice(0, 500),
        snippet: message.slice(0, 200),
        date: new Date().toISOString(),
        is_read: true, is_reply: false, mail_type: 'sent', labels: ['SENT'],
      })
    } catch (e) { console.log('gmail_messages cache failed (non-critical)') }

    return ok({ ok: true, message_id: sendData.id })

  } catch (e: any) {
    console.error('gmail-reply error:', e?.message || e)
    return err(e?.message || 'Unexpected server error', 500)
  }
})
