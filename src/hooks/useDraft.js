import { useEffect, useState } from 'react'

// useState that survives a page reload (Chrome Memory Saver tab discards, accidental
// refresh, a new deploy). Text is kept in localStorage under `draft:<key>` while the
// user types and removed with clear() once it has been saved/sent. Drafts older than
// 7 days are ignored.
const MAX_AGE = 7 * 24 * 3600 * 1000

export function useDraft(key, initial = '') {
  const storageKey = key ? `draft:${key}` : null
  const read = () => {
    if (!storageKey) return initial
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return initial
      const { v, t } = JSON.parse(raw)
      return Date.now() - t < MAX_AGE ? v : initial
    } catch { return initial }
  }
  const [value, setValue] = useState(read)

  // If the record changes (e.g. navigating to another lead), load that record's draft.
  useEffect(() => { setValue(read()) }, [storageKey])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!storageKey) return
    try {
      if (value === initial || value === '') localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify({ v: value, t: Date.now() }))
    } catch { /* storage full or disabled: draft just won't persist */ }
  }, [storageKey, value])  // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    setValue(initial)
    try { if (storageKey) localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }
  return [value, setValue, clear]
}
