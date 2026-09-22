import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // session = null (logged out) | object (logged in) | undefined (loading)
  const [session, setSession]   = useState(undefined)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    // 1. Get the current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
      }
    })

    // 2. Listen for login / logout events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // TOKEN_REFRESHED fires every time the tab regains focus — ignore it
        // to prevent full re-render cascades when reps switch tabs
        if (event === 'TOKEN_REFRESHED') return
        setSession(session)
        if (session) {
          fetchProfile(session.user.id)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!error && data) {
      setProfile(data)
    }
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

  return (
    <AuthContext.Provider value={{
      session,
      profile,
      loading,
      isAdmin,
      isRep,
      isEngineer,
      isFinance,
      canViewFinance,
      signIn,
      signOut,
    }}>
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
