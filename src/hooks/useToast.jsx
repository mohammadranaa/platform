import { useState, useCallback } from 'react'

// Usage:
//   const { toast, showToast } = useToast()
//   showToast('Client saved ✓')
//   showToast('Something went wrong', 'error')
//
//   Then in JSX: <Toast toast={toast} />

export function useToast() {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  return { toast, showToast }
}

// ── Toast UI component ────────────────────────────────────────
// Import and render this at the bottom of any page that uses toasts

const COLORS = {
  success: { bg: '#80D100', text: '#fff' },
  error:   { bg: '#EF4444', text: '#fff' },
  info:    { bg: '#0093DB', text: '#fff' },
  warning: { bg: '#F59E0B', text: '#fff' },
}

export function Toast({ toast }) {
  if (!toast) return null
  const c = COLORS[toast.type] || COLORS.success
  return (
    <div style={{
      position: 'fixed',
      bottom: 28,
      right: 28,
      background: c.bg,
      color: c.text,
      borderRadius: 10,
      padding: '12px 22px',
      fontWeight: 600,
      fontSize: 14,
      zIndex: 9999,
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      animation: 'fadeIn 0.2s ease',
    }}>
      {toast.message}
    </div>
  )
}
