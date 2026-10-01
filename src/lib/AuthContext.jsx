import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // session = null (logged out) | object (logged in) | undefined (loading)
  const [session, setSession]   = useState(undefined)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)

  // Which user's profile is currently loaded. Supabase re-emits SIGNED_IN (and
  // TOKEN_REFRESHED) every time a tab regains focus; if we treated those as new
  // logins the whole app re-rendered and pages reloaded, wiping half-typed notes.
  const loadedUserId = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!newSession) {
        // Real sign-out (or session expired): clear everything.
        loadedUserId.current = null
        setSession(null); setProfile(null); setLoading(false)
        return
      }
      const sameUser = newSession.user.id === loadedUserId.current
      // Same person, just a focus/refresh event: keep the existing objects so
      // nothing downstream re-runs. supabase-js keeps the fresh token internally.
      if (sameUser) return
      setSession(newSession)
      fetchProfile(newSession.user.id)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    if (loadedUserId.current === userId) { setLoading(false); return }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (!error && data) { loadedUserId.current = userId; setProfile(data) }
    setLoading(false)
  }

  // ── Auth actions ────────────────────────────────────────────

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error // return error so Login.jsx can display it
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // ── Helpers ─────────────────────────────────────────────────

  const isAdmin    = profile?.role === 'admin'
  const isRep      = profile?.role === 'rep'
  const isEngineer = profile?.role === 'engineer'
  const isFinance  = profile?.role === 'finance'
  // Finance and admin both see financial/engineer data
  const canViewFinance = isAdmin || isFinance

  // Stable context value: consumers only re-render when something actually changes.
  const value = useMemo(() => ({
    session, profile, loading, isAdmin, isRep, isEngineer, isFinance, canViewFinance, signIn, signOut,
  }), [session, profile, loading])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Hook ─────────────────────────────────────────────────────
// Use this in any component: const { profile, isAdmin } = useAuth()
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
