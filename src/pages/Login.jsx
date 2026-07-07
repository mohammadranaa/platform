import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const C = {
  bg:      '#FFFFFF',
  surface: '#F5F7FA',
  border:  '#E5E7EB',
  accent:  '#0093DB',
  text:    '#1F2937',
  muted:   '#6B7280',
  red:     '#DC2626',
  redSoft: '#FEE2E2',
}

export default function Login() {
  const { signIn, session } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // If already logged in, redirect immediately
  if (session) {
    navigate('/')
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const err = await signIn(email, password)
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      navigate('/')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: '40px 44px',
        width: 400,
      }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            color: C.accent,
            fontWeight: 800,
            fontSize: 24,
            marginBottom: 6,
            letterSpacing: '-0.5px',
          }}>
            ◈ MLC Platform
          </div>
          <div style={{ color: C.muted, fontSize: 14 }}>
            Sign in to your account
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: C.muted, fontSize: 13 }}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@mlcservices.co.uk"
              required
              autoFocus
              style={{
                background: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                color: C.text,
                padding: '10px 14px',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: C.muted, fontSize: 13 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                background: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                color: C.text,
                padding: '10px 14px',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: C.redSoft,
              border: `1px solid ${C.red}44`,
              color: C.red,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '12px',
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: 4,
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        {/* Footer note */}
        <div style={{
          marginTop: 28,
          padding: 14,
          background: '#F5F7FA',
          borderRadius: 10,
          fontSize: 12,
          color: C.muted,
          lineHeight: 1.7,
        }}>
          <strong style={{ color: C.text }}>Forgot your password?</strong><br />
          Contact your admin to reset it via the Supabase dashboard.
        </div>
      </div>
    </div>
  )
}
