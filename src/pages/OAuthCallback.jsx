import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const C = { accent: '#0093DB', text: '#1F2937', muted: '#6B7280', red: '#DC2626' }
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://fyjgtwupzpeivdedoutj.supabase.co'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = `${window.location.origin}/inbox/oauth-callback`

export default function OAuthCallback() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting your Gmail account…')
  const [error, setError] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam) {
      setError('Google denied access: ' + errorParam)
      return
    }

    if (!code) {
      setError('No authorization code received from Google.')
      return
    }

    exchangeCode(code)
  }, [])

  async function exchangeCode(code) {
    const accountType = localStorage.getItem('oauth_account_type') || 'cold'
    
    try {
      setStatus('Exchanging authorization code…')

      const res = await fetch(`${SUPABASE_URL}/functions/v1/gmail-oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: REDIRECT_URI,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          user_id: profile?.id,
          account_type: accountType,
        }),
      })

      const data = await res.json()

      if (data.ok) {
        setStatus(`✅ ${data.email} connected successfully!`)
        localStorage.removeItem('oauth_account_type')
        // Redirect to the correct inbox after 2 seconds
        setTimeout(() => {
          navigate(accountType === 'cold' ? '/cold-inbox' : '/inbox')
        }, 2000)
      } else {
        setError(data.error || 'Failed to connect account')
      }
    } catch (err) {
      setError('Connection failed: ' + err.message)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        {error ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.red, marginBottom: 8 }}>Connection Failed</div>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>{error}</div>
            <button onClick={() => navigate('/cold-inbox')}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Back to Cold Inbox
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              {status.startsWith('✅') ? '✅' : '⏳'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>{status}</div>
            {!status.startsWith('✅') && (
              <div style={{ fontSize: 13, color: C.muted }}>Please wait, do not close this page…</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
