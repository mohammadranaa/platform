// mime.ts (slim) — UTF-8 safe message builder. Full version: supabase/functions/_shared/mime.ts
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

export function buildMessage(o: { from: string; to: string; subject: string; text: string; html?: string; cc?: string; replyTo?: string }): string {
  const alt = `alt_${crypto.randomUUID().replace(/-/g, '')}`
  return [
    `From: ${o.from}`, `To: ${o.to}`, ...(o.cc ? [`Cc: ${o.cc}`] : []), ...(o.replyTo ? [`Reply-To: ${o.replyTo}`] : []),
    `Subject: ${encodeHeader(o.subject)}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, ...textPart('text/plain', o.text),
    ...(o.html ? [`--${alt}`, ...textPart('text/html', o.html)] : []),
    `--${alt}--`,
  ].join('\r\n')
}
