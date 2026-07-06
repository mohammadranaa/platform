import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import AISidebar from './AISidebar'

const C = {
  bg: '#111827', surface: '#1F2937', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  purple: '#A855F7', purpleSoft: '#2E1065',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
  green: '#80D100', amber: '#F59E0B',
}

const NAV_ITEMS = [
  { to: '/',           icon: '◉',  label: 'Dashboard',    exact: true },
  { to: '/clients',    icon: '◎',  label: 'Clients'                   },
  { to: '/jobs',       icon: '🔧', label: 'Jobs'                      },
  { to: '/inbox',      icon: '✉️', label: 'Email Inbox'               },
  { to: '/templates',  icon: '📝', label: 'Templates'                 },
  { to: '/documents',  icon: '🧾', label: 'Documents'                 },
  { to: '/campaigns',  icon: '⚡', label: 'Cold Email',   adminOnly: true },
  { to: '/inboxes',    icon: '📬', label: 'SMTP Inboxes', adminOnly: true },
]

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const roleColor = {
    admin:    C.accent,
    rep:      C.green,
    engineer: C.amber,
  }[profile?.role] || C.muted

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>

      {/* Sidebar */}
      <aside style={{
        width: 224, background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh',
      }}>
        {/* Logo */}
        <div style={{ padding: '24px 20px 20px', borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
          <div style={{ color: C.accent, fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>◈ MLC Platform</div>
          <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>CRM · Jobs · Cold Email</div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 0', overflowY: 'auto' }}>
          {NAV_ITEMS
            .filter(item => !item.adminOnly || isAdmin)
            .map(item => (
              <NavLink key={item.to} to={item.to} end={item.exact}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 20px', fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? C.accent : C.muted,
                  background: isActive ? C.accentSoft : 'transparent',
                  borderLeft: `3px solid ${isActive ? C.accent : 'transparent'}`,
                  textDecoration: 'none', transition: 'all 0.15s',
                })}>
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}

          {/* AI Assistant button */}
          <button onClick={() => setAiOpen(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '10px 20px', fontSize: 14, fontWeight: aiOpen ? 600 : 400,
              color: aiOpen ? C.purple : C.muted,
              background: aiOpen ? C.purpleSoft : 'transparent',
              borderLeft: `3px solid ${aiOpen ? C.purple : 'transparent'}`,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>✦</span>
            AI Assistant
          </button>
        </nav>

        {/* User */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, color: C.text }}>
            {profile?.full_name || 'Loading…'}
          </div>
          <div style={{ fontSize: 11, color: roleColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            {profile?.role || '…'}
          </div>
          <button onClick={handleSignOut}
            style={{ width: '100%', padding: '8px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: aiOpen ? 380 : 0, transition: 'margin-right 0.25s ease' }}>
        <main style={{ flex: 1, padding: 28, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>

      {/* AI Sidebar */}
      <AISidebar isOpen={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
