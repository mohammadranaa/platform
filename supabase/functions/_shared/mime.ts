// mime.ts — shared email helpers (copied into each function folder that sends mail).
// Fixes "Ã¢Â€Â”" style garbling: headers with non-ASCII characters (—, £, ’) must be
// RFC 2047 encoded, and bodies must declare a transfer encoding that matches what we send.

const enc = new TextEncoder()

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 8192
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}
export const strToB64 = (s: string) => bytesToB64(enc.encode(s))
export const wrap76 = (b64: string) => b64.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') || ''
export const toBase64Url = (s: string) => strToB64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Encode a header value (Subject, display names) only if it contains non-ASCII. */
export function encodeHeader(v: string): string {
  const s = (v || '').replace(/[\r\n]+/g, ' ').trim()
  if (/^[\x20-\x7E]*$/.test(s)) return s
  // Split into chunks so each encoded-word stays under ~75 chars
  const words: string[] = []
  let chunk = ''
  for (const ch of s) {
    if (enc.encode(chunk + ch).length > 45) { words.push(chunk); chunk = '' }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map(w => `=?UTF-8?B?${strToB64(w)}?=`).join('\r\n ')
}

/** "Name <addr>" with the name safely encoded. Accepts a bare address or "Name <addr>". */
export function formatAddress(nameOrFull: string, addr?: string): string {
  if (!addr) {
    const m = (nameOrFull || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
    if (!m) return (nameOrFull || '').trim()
    nameOrFull = m[1]; addr = m[2]
  }
  const name = (nameOrFull || '').trim()
  if (!name) return addr!
  const encoded = encodeHeader(name)
  return encoded === name && /[(),:;<>@\[\]".]/.test(name) ? `"${name.replace(/"/g, '')}" <${addr}>` : `${encoded} <${addr}>`
}

/** A text/* MIME part, UTF-8, base64 transfer encoding. */
export function textPart(contentType: string, content: string): string[] {
  return [`Content-Type: ${contentType}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(strToB64(content))]
}

// ── HTML rendering ───────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const linkify = (s: string) => s
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0093DB">$1</a>')
  .replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g, '<a href="mailto:$1" style="color:#0093DB">$1</a>')

const BRAND = {
  name: 'My Landlord Certificate', phone: '020 3996 1070', web: 'www.mylandlordcertificate.co.uk',
  email: 'info@mylandlordcertificate.co.uk', navy: '#0F1B2D', blue: '#0093DB', green: '#80D100',
}

/**
 * Turn a plain-text business email into a clean, branded HTML email.
 * - "Label: value" lines (2+ in a row) become a details card
 * - "- " / "• " lines become a bullet list
 * - ALL-CAPS short lines become section headings
 */
export function renderBrandedHtml(text: string, opts: { title?: string; calendarNote?: boolean } = {}): string {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks: string[] = []
  let i = 0
  const kv = /^\s*([A-Za-z][A-Za-z /&()'-]{1,32}):\s+(.+)$/
  const bullet = /^\s*(?:[-•·*]|\d+\.)\s+(.+)$/
  const isHeading = (l: string) => /^(?:\d+\.\s+)?[A-Z0-9 &/'-]{4,40}$/.test(l.trim()) && /[A-Z]{3}/.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    // details card
    if (kv.test(line) && kv.test(lines[i + 1] || '')) {
      const rows: string[] = []
      while (i < lines.length && kv.test(lines[i])) {
        const [, k, v] = lines[i].match(kv)!
        rows.push(`<tr><td style="padding:9px 0;width:38%;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6B7280;vertical-align:top;border-bottom:1px solid #EEF1F5">${esc(k)}</td><td style="padding:9px 0;font-size:14px;color:#111827;font-weight:600;border-bottom:1px solid #EEF1F5">${linkify(esc(v))}</td></tr>`)
        i++
      }
      blocks.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid #E5E9F0;border-left:4px solid ${BRAND.blue};border-radius:8px;padding:6px 18px;margin:18px 0;border-collapse:separate">${rows.join('')}</table>`)
      continue
    }
    // heading (e.g. "BEFORE YOUR APPOINTMENT", "1. NAME ON CERTIFICATE")
    if (isHeading(line)) {
      blocks.push(`<div style="margin:22px 0 8px;font-size:12px;font-weight:800;letter-spacing:.08em;color:${BRAND.navy}">${esc(line.trim())}</div>`)
      i++; continue
    }
    // bullets
    if (bullet.test(line)) {
      const items: string[] = []
      while (i < lines.length && bullet.test(lines[i])) { items.push(`<li style="margin:0 0 6px">${linkify(esc(lines[i].match(bullet)![1]))}</li>`); i++ }
      blocks.push(`<ul style="margin:8px 0 16px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6">${items.join('')}</ul>`)
      continue
    }
    // paragraph (consecutive non-empty lines joined with <br>)
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !(kv.test(lines[i]) && kv.test(lines[i + 1] || '')) && !bullet.test(lines[i]) && !(para.length && isHeading(lines[i]))) { para.push(linkify(esc(lines[i]))); i++ }
    blocks.push(`<p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#1F2937">${para.join('<br>')}</p>`)
  }

  const cal = opts.calendarNote ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="background:#F0FAE0;border:1px solid #CDEBA0;border-radius:8px;padding:12px 16px;font-size:13px;color:#2F5F00">&#128197;&nbsp; <strong>Calendar invitation attached.</strong> Accept it to add this appointment to your calendar.</td></tr></table>` : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title || BRAND.name)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F5;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(15,27,45,.08)">
<tr><td style="background:${BRAND.navy};padding:20px 28px">
  <div style="font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:.01em">${BRAND.name}</div>
  <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.green};margin-top:3px">Property Compliance</div>
</td></tr>
<tr><td style="height:3px;background:${BRAND.blue}"></td></tr>
<tr><td style="padding:28px 28px 8px">${opts.title ? `<div style="font-size:20px;font-weight:800;color:${BRAND.navy};margin:0 0 16px">${esc(opts.title)}</div>` : ''}${cal}${blocks.join('\n')}</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #EEF1F5;font-size:12px;line-height:1.6;color:#6B7280">
  <strong style="color:#374151">${BRAND.name}</strong><br>
  ${BRAND.phone} &nbsp;&middot;&nbsp; <a href="mailto:${BRAND.email}" style="color:#6B7280">${BRAND.email}</a> &nbsp;&middot;&nbsp; <a href="https://${BRAND.web}" style="color:#6B7280">${BRAND.web}</a>
</td></tr>
</table>
<div style="font-size:11px;color:#9CA3AF;margin-top:14px">Sent by ${BRAND.name} Ltd &middot; London</div>
</td></tr></table></body></html>`
}

// ── Calendar invite (.ics) ───────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')

/** Parse "Morning (8am–1pm)", "Custom (10:30am–12pm)", "08:00-13:00" into 24h start/end. */
export function parseSlot(slot: string): { start: string; end: string } | null {
  const s = String(slot || '').toLowerCase()
  const times = [...s.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g)].filter(m => m[3] || m[2]).map(m => {
    let h = Number(m[1]); const mi = Number(m[2] || 0)
    if (m[3] === 'pm' && h < 12) h += 12
    if (m[3] === 'am' && h === 12) h = 0
    return `${pad(h)}:${pad(mi)}`
  })
  if (times.length >= 2) return { start: times[0], end: times[1] }
  if (s.includes('morning')) return { start: '08:00', end: '13:00' }
  if (s.includes('afternoon')) return { start: '13:00', end: '18:00' }
  return null
}

/** Europe/London wall-clock date+time -> UTC "YYYYMMDDTHHMMSSZ" */
function londonToUtc(date: string, hhmm: string): string {
  const [y, mo, d] = date.slice(0, 10).split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', timeZoneName: 'longOffset' })
    .formatToParts(guess).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
  const u = new Date(guess.getTime() - offMin * 60000)
  return `${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}00Z`
}

const icsText = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
function fold(line: string): string {
  const out: string[] = []; let cur = ''
  for (const ch of line) { if (enc.encode(cur + ch).length > 73) { out.push(cur); cur = ' ' } cur += ch }
  out.push(cur); return out.join('\r\n')
}

export type CalendarEvent = {
  uid: string; date: string; slot: string; summary: string; location?: string; description?: string
  attendee_email: string; attendee_name?: string
}

export function buildIcs(ev: CalendarEvent, organizerEmail: string, organizerName: string): string | null {
  if (!ev?.date || !/^\d{4}-\d{2}-\d{2}/.test(ev.date)) return null
  const t = parseSlot(ev.slot) || { start: '08:00', end: '18:00' }
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//My Landlord Certificate//Bookings//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${now}`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTART:${londonToUtc(ev.date, t.start)}`,
    `DTEND:${londonToUtc(ev.date, t.end)}`,
    `SUMMARY:${icsText(ev.summary)}`,
    ...(ev.location ? [`LOCATION:${icsText(ev.location)}`] : []),
    `DESCRIPTION:${icsText(ev.description || '')}`,
    `ORGANIZER;CN=${icsText(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${icsText(ev.attendee_name || ev.attendee_email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ev.attendee_email}`,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Appointment reminder', 'TRIGGER:-PT24H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export type Attachment = { base64: string; name: string; mime: string }

/**
 * Build a complete RFC 5322 message.
 * Structure: multipart/mixed[ multipart/alternative[ text/plain, text/html?, text/calendar? ], attachments..., invite.ics? ]
 */
export function buildMessage(o: {
  from: string; to: string; subject: string; text: string; html?: string; ics?: string | null
  attachments?: Attachment[]; extraHeaders?: string[]; replyTo?: string; cc?: string
}): string {
  const id = crypto.randomUUID().replace(/-/g, '')
  const mixed = `mix_${id}`, alt = `alt_${id}`
  const head = [
    `From: ${o.from}`, `To: ${o.to}`, ...(o.cc ? [`Cc: ${o.cc}`] : []), ...(o.replyTo ? [`Reply-To: ${o.replyTo}`] : []),
    `Subject: ${encodeHeader(o.subject)}`, ...(o.extraHeaders || []), 'MIME-Version: 1.0',
  ]
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, ...textPart('text/plain', o.text),
    ...(o.html ? [`--${alt}`, ...textPart('text/html', o.html)] : []),
    ...(o.ics ? [`--${alt}`, ...textPart('text/calendar; method=REQUEST', o.ics)] : []),
    `--${alt}--`,
  ]
  const atts = [...(o.attachments || [])]
  if (o.ics) atts.push({ base64: strToB64(o.ics), name: 'invite.ics', mime: 'application/ics' })
  if (!atts.length) return [...head, ...altPart].join('\r\n')
  const body = [`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...altPart]
  for (const a of atts) {
    const n = a.name.replace(/"/g, '')
    body.push(`--${mixed}`, `Content-Type: ${a.mime}; name="${n}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${n}"`, '', wrap76(a.base64))
  }
  body.push(`--${mixed}--`)
  return [...head, ...body].join('\r\n')
}
