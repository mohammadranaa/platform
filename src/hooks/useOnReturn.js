import { useEffect, useRef } from 'react'

// For pages kept alive in the background (see Layout): runs `fn` each time the page
// becomes visible again (not on first mount), so its data is refreshed quietly while
// everything the rep had on screen (page, filters, scroll, open panels) stays put.
export function useOnReturn(active, fn) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) fnRef.current()
    wasActive.current = active
  }, [active])
}
