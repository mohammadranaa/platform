// gmail-reply v24: branded:false is always respected (rep/cold emails stay plain text); tighter process-email detection
// gmail-reply v23: CC support; large attachments sent through Gmail's upload endpoint
// gmail-reply v22: process emails auto-branded + calendar invite built from the email when the site doesn't send one
// gmail-reply v21: proper UTF-8 encoding (no more garbled dashes/£), optional branded HTML + calendar invite
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMessage, buildIcs, renderBrandedHtml, formatAddress, toBase64Url, type Attachment } from './mime.ts'

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
  if (!data.access_token) {
    await supabase.from('user_email_accounts').update({
      needs_reconnect: true,
      reconnect_reason: `${data.error || 'error'}: ${data.error_description || 'unknown'}`,
    }).eq('id', account.id)
    throw new Error(`Token refresh failed: ${data.error_description || data.error || 'unknown'}`)
  }
  const expiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('user_email_accounts').update({ access_token: data.access_token, token_expiry: expiry, needs_reconnect: false, reconnect_reason: null }).eq('id', account.id)
  return data.access_token
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
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

// ── Process-email helpers ────────────────────────────────────────────────
const TITLES: Record<string, string> = { booking: 'Booking Confirmed', payment: 'Payment Received', invoice: 'Your Invoice', certificate: 'Your Certificate', quote: 'Your Quote' }

function detectKind(subject: string): string | null {
  const s = subject.toLowerCase()
  if (/booking confirm/.test(s)) return 'booking'
  if (/payment (received|confirm)/.test(s)) return 'payment'
  if (/^(your )?certificate|your certificate/.test(s)) return 'certificate'
  if (/^invoice\s+(inv|#|\d)|your invoice/.test(s)) return 'invoice'
  if (/^quote\s+(q|#|\d)|your quote/.test(s)) return 'quote'
  return null
}

const longDate = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z')
  .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).replace(',', '')

// Older website versions replaced "—" with "--" and "£" with "GBP"; ISO dates read badly
function tidySubject(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\s--\s/g, ' — ').replace(/\bGBP\s?(?=\d)/g, '£')
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d) => longDate(d)).trim()
}
function tidyBody(s: string): string {
  return s.replace(/\bGBP\s?(?=\d)/g, '£')
    .replace(/^(\s*(?:Date|Appointment|Appointment date|Inspection date)\s*:\s*)(\d{4}-\d{2}-\d{2})\s*$/gim, (_, k, d) => k + longDate(d))
    .replace(/^Time Slot:/gim, 'Arrival window:')
}

// Build a calendar event from "Date:", "Arrival window:" and "Property:" lines in the email
function eventFromBody(text: string, to: string) {
  const line = (re: RegExp) => (text.match(re)?.[1] || '').trim()
  const rawDate = line(/^\s*(?:Date|Appointment(?: date)?)\s*:\s*(.+)$/im)
  const slot = line(/^\s*(?:Arrival window|Time slot|Time window)\s*:\s*(.+)$/im)
  if (!rawDate || !slot || /tbc|to be confirmed/i.test(rawDate + slot)) return null
  let iso = (rawDate.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || ''
  if (!iso) {
    const t = Date.parse(rawDate.replace(/^[A-Za-z]+day\s+/, '') + ' 12:00 UTC')
    if (!isNaN(t)) iso = new Date(t).toISOString().slice(0, 10)
  }
  if (!iso) return null
  const service = line(/^\s*Service\s*:\s*(.+)$/im) || 'Property inspection'
  const property = line(/^\s*Property(?: address)?\s*:\s*(.+)$/im)
  const ref = line(/^\s*Reference\s*:\s*(.+)$/im)
  const name = line(/^\s*Dear\s+([^,\n]+),?\s*$/im)
  const key = (ref || `${to}-${iso}-${property}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '')
  return {
    uid: `booking-${key}@mylandlordcertificate.co.uk`, date: iso, slot,
    summary: `${service.split('(')[0].trim()} — My Landlord Certificate`, location: property,
    description: `${service}\nArrival window: ${slot}\nOur engineer will call approximately one hour before arrival.${ref ? `\nReference: ${ref}` : ''}\nQuestions or changes: 020 3996 1070`,
    attendee_email: to, attendee_name: name,
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
      calendar_event, branded, html_title, cc,
    } = body

    const client_id = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
    const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

    if (!account_id || !to || !message) return fail('account_id, to, and message are required')

    const { data: account } = await supabase.from('user_email_accounts').select('*').eq('id', account_id).single()
    if (!account) return fail('Account not found', 404)

    const token = await refreshToken(account, client_id, client_secret)
    const fromName = account.send_as_name || account.display_name || 'My Landlord Certificate'
    const fromAddr = account.send_as_email || account.gmail_address
    const safeSubject = tidySubject(subject || 'My Landlord Certificate')

    const allAttachments: Attachment[] = []

    if (storage_paths && Array.isArray(storage_paths)) {
      for (const sp of storage_paths) {
        if (!sp.path) continue
        const { data: fileBytes, contentType } = await fetchStorageFile(sp.path)
        allAttachments.push({
          base64: uint8ToBase64(fileBytes),
          name: sp.name || sp.path.split('/').pop() || 'Certificate.pdf',
          mime: sp.mime || contentType || 'application/pdf',
        })
      }
    }

    if (attachments && Array.isArray(attachments)) {
      for (const a of attachments) {
        if (a.base64 && a.name) allAttachments.push({ base64: a.base64, name: a.name, mime: a.mime || 'application/pdf' })
      }
    } else if (attachment_base64 && attachment_name) {
      allAttachments.push({ base64: attachment_base64, name: attachment_name, mime: attachment_mime || 'application/pdf' })
    }

    // ── Professional formatting, enforced server-side ─────────────────────────
    // Works for every sending point (job page, lead page, client page, older cached
    // versions of the website): process emails are recognised from the subject.
    const kind = detectKind(safeSubject)
    const text = kind && branded !== false ? tidyBody(message) : message
    const isBranded = branded ?? (!!kind && !thread_id)

    // Calendar invite: use the one the website sent, or build it from the email itself
    let event = calendar_event || null
    // Plain emails (branded: false — rep emails on leads, inbox replies, cold emails) never get auto-added invites
    if (!event && branded !== false && (kind === 'booking' || kind === 'payment')) event = eventFromBody(text, to)
    const ics = event ? buildIcs({ ...event, attendee_email: event.attendee_email || to }, fromAddr, fromName) : null
    const html = isBranded ? renderBrandedHtml(text, { title: html_title || TITLES[kind || ''] || undefined, calendarNote: !!ics }) : undefined

    const mime = buildMessage({
      from: formatAddress(fromName, fromAddr),
      to: formatAddress(to),
      cc: cc ? String(cc).split(/[,;]+/).map((x: string) => x.trim()).filter(Boolean).map((x: string) => formatAddress(x)).join(', ') : undefined,
      subject: safeSubject,
      text,
      html,
      ics,
      attachments: allAttachments,
      extraHeaders: thread_id ? [`In-Reply-To: <${thread_id}>`, `References: <${thread_id}>`] : [],
    })

    console.log(`Sending to ${to} with ${allAttachments.length} attachment(s)${ics ? ' + calendar invite' : ''}${html ? ' (branded)' : ''}`)

    // Small messages: simple JSON send. Large ones (big PDFs): Gmail's upload endpoint (up to 35 MB).
    const sendRes = mime.length < 4_000_000
      ? await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: toBase64Url(mime), ...(thread_id ? { threadId: thread_id } : {}) }),
        })
      : await (() => {
          const b = 'up_' + crypto.randomUUID().replace(/-/g, '')
          const payload = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(thread_id ? { threadId: thread_id } : {})}\r\n--${b}\r\nContent-Type: message/rfc822\r\n\r\n${mime}\r\n--${b}--`
          return fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${b}` },
            body: payload,
          })
        })()

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

    return ok({ ok: true, message_id: sendData.id, attachments_sent: allAttachments.length, calendar_invite: !!ics, branded: !!html })

  } catch (e: any) {
    console.error('gmail-reply error:', e?.message || e)
    return fail(e?.message || 'Unexpected server error', 500)
  }
})
