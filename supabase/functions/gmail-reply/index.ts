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
function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

function cleanSubject(s: string): string {
  return (s || '').replace(/\u2014/g, '--').replace(/\u2013/g, '-').replace(/[^\x00-\x7F]/g, '').trim()
}

async function refreshToken(account: any, clientId: string, clientSecret: string): Promise<string> {
  if (new Date() < new Date(account.token_expiry)) return account.access_token
  if (!account.refresh_token) throw new Error(`${account.gmail_address} needs to be reconnected`)
  if (!clientId || !clientSecret) throw new Error('Missing Google OAuth credentials — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Supabase secrets')

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

// Convert Uint8Array to base64 in chunks to avoid stack overflow on large files
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function b64Lines(b64: string): string {
  return b64.replace(/[\r\n\s]/g, '').match(/.{1,76}/g)?.join('\r\n') || b64
}

function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Fetch a file from Supabase Storage using service role (no CORS, no size issues)
async function fetchStorageFile(storagePath: string): Promise<{ data: Uint8Array; contentType: string }> {
  const { data, error } = await supabase.storage
    .from('job-files')
    .download(storagePath)

  if (error || !data) throw new Error(`Storage fetch failed for ${storagePath}: ${error?.message || 'unknown'}`)

  const buffer = await data.arrayBuffer()
  return {
    data: new Uint8Array(buffer),
    contentType: data.type || 'application/pdf',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => null)
    if (!body) return fail('Invalid JSON body')

    const {
      account_id, to, subject, message, thread_id,
      // For certificates: pass storage paths, edge function fetches them
      // storage_paths: [{ path: 'job-id/cert.pdf', name: 'EICR.pdf', mime: 'application/pdf' }]
      storage_paths,
      // For small attachments: pass base64 directly (invoices, quotes)
      // attachments: [{ base64, name, mime }]
      attachments,
      // Legacy single attachment
      attachment_base64, attachment_name, attachment_mime,
    } = body

    const client_id = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
    const client_secret = body.client_secret || Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

    if (!account_id || !to || !message) return fail('account_id, to, and message are required')

    const { data: account } = await supabase.from('user_email_accounts').select('*').eq('id', account_id).single()
    if (!account) return fail('Account not found', 404)

    const token = await refreshToken(account, client_id, client_secret)
    const fromName = account.send_as_name || account.display_name || 'My Landlord Certificate'
    const fromAddr = account.send_as_email || account.gmail_address
    const safeSubject = cleanSubject(subject || 'My Landlord Certificate')
    const boundary = 'MLC' + Date.now()

    // Build attachment list
    // Strategy A: storage_paths — edge function fetches from storage (for large files like certs)
    // Strategy B: attachments array — base64 already prepared by frontend (for small files)
    // Strategy C: legacy single attachment_base64
    type Attachment = { base64: string; name: string; mime: string }
    const allAttachments: Attachment[] = []

    if (storage_paths && Array.isArray(storage_paths)) {
      for (const sp of storage_paths) {
        if (!sp.path) continue
        console.log(`Fetching from storage: ${sp.path}`)
        const { data: fileBytes, contentType } = await fetchStorageFile(sp.path)
        allAttachments.push({
          base64: uint8ToBase64(fileBytes),
          name: sp.name || sp.path.split('/').pop() || 'Certificate.pdf',
          mime: sp.mime || contentType || 'application/pdf',
        })
        console.log(`Fetched ${sp.name}: ${fileBytes.length} bytes`)
      }
    }

    if (attachments && Array.isArray(attachments)) {
      for (const a of attachments) {
        if (a.base64 && a.name) allAttachments.push({ base64: a.base64, name: a.name, mime: a.mime || 'application/pdf' })
      }
    } else if (attachment_base64 && attachment_name) {
      allAttachments.push({ base64: attachment_base64, name: attachment_name, mime: attachment_mime || 'application/pdf' })
    }

    // Build MIME message
    let mime: string
    if (allAttachments.length > 0) {
      const parts = [
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
      ]
      for (const att of allAttachments) {
        parts.push(
          `--${boundary}`,
          `Content-Type: ${att.mime}; name="${att.name}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${att.name}"`,
          '',
          b64Lines(att.base64),
          '',
        )
      }
      parts.push(`--${boundary}--`)
      mime = parts.join('\r\n')
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

    console.log(`Sending to ${to} with ${allAttachments.length} attachment(s)`)

    const sendRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toBase64Url(mime), ...(thread_id ? { threadId: thread_id } : {}) }),
    })

    const sendData = await sendRes.json()
    if (sendData.error) {
      console.error('Gmail API error:', JSON.stringify(sendData.error))
      return fail(sendData.error.message || 'Gmail send failed')
    }

    console.log(`Email sent. Message ID: ${sendData.id}`)

    try {
      await supabase.from('gmail_messages').insert({
        account_id: account.id, gmail_id: sendData.id,
        thread_id: sendData.threadId || thread_id,
        from_email: fromAddr, from_name: fromName,
        to_email: to, subject: safeSubject,
        body_text: message.slice(0, 500), snippet: message.slice(0, 200),
        date: new Date().toISOString(),
        is_read: true, is_reply: false, mail_type: 'sent', labels: ['SENT'],
      })
    } catch (e) { /* non-critical */ }

    return ok({ ok: true, message_id: sendData.id, attachments_sent: allAttachments.length })

  } catch (e: any) {
    console.error('gmail-reply error:', e?.message || e)
    return fail(e?.message || 'Unexpected server error', 500)
  }
})
