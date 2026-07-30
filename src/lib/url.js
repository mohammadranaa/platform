export function fixUrl(url) {
  if (!url) return ''
  url = url.trim()
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return 'https://' + url
}
