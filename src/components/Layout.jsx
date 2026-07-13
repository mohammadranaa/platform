import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import AISidebar from './AISidebar'

const S = {
  sidebarBg:      '#1F2937',
  sidebarBorder:  '#374151',
  sidebarText:    '#F9FAFB',
  sidebarMuted:   '#9CA3AF',
  sidebarActiveBg:'#0093DB22',
  sidebarAIBg:    '#80D10022',
}

const NAV_ITEMS = [
  { to: '/',           icon: '◉',  label: 'Dashboard',    exact: true },
  { to: '/leads',      icon: '🎯', label: 'Leads'                     },
  { to: '/clients',    icon: '◎',  label: 'Clients'                   },
  { to: '/jobs',       icon: '🔧', label: 'Jobs'                      },
  { to: '/properties', icon: '🏠', label: 'Properties'                },
  { to: '/inbox',      icon: '✉️', label: 'Email Inbox'               },
  { to: '/templates',  icon: '📝', label: 'Templates'                 },
  { to: '/documents',  icon: '🧾', label: 'Documents'                 },
  { to: '/invoices',   icon: '💰', label: 'Invoices'                  },
  { to: '/campaigns',  icon: '⚡', label: 'Cold Email',  adminOnly: true },
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

  const roleColor = { admin: '#0093DB', rep: '#80D100', engineer: '#D97706' }[profile?.role] || S.sidebarMuted

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA' }}>

      {/* Sidebar */}
      <aside style={{ width: 220, background: S.sidebarBg, display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
        {/* Logo */}
        <div style={{ padding: '18px 20px 16px', borderBottom: `1px solid ${S.sidebarBorder}`, marginBottom: 6 }}>
          <div style={{ color: '#0093DB', fontWeight: 800, fontSize: 17, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>◈</span> MLC Platform
          </div>
          <div style={{ color: S.sidebarMuted, fontSize: 10, marginTop: 2 }}>CRM · Jobs · Cold Email</div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 0', overflowY: 'auto' }}>
          {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 18px', fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#0093DB' : S.sidebarMuted,
                background: isActive ? S.sidebarActiveBg : 'transparent',
                borderLeft: `3px solid ${isActive ? '#0093DB' : 'transparent'}`,
                textDecoration: 'none', transition: 'all 0.12s',
              })}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          {/* AI Assistant */}
          <button onClick={() => setAiOpen(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 18px', fontSize: 13, fontWeight: aiOpen ? 600 : 400, color: aiOpen ? '#80D100' : S.sidebarMuted, background: aiOpen ? S.sidebarAIBg : 'transparent', borderLeft: `3px solid ${aiOpen ? '#80D100' : 'transparent'}`, border: 'none', cursor: 'pointer', transition: 'all 0.12s' }}>
            <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>✦</span>
            AI Assistant
          </button>
        </nav>

        {/* User */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${S.sidebarBorder}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, color: S.sidebarText }}>{profile?.full_name || '…'}</div>
          <div style={{ fontSize: 10, color: roleColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{profile?.role || '…'}</div>
          <button onClick={handleSignOut} style={{ width: '100%', padding: '6px', background: 'transparent', border: `1px solid ${S.sidebarBorder}`, borderRadius: 6, color: S.sidebarMuted, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, marginRight: aiOpen ? 380 : 0, transition: 'margin-right 0.25s ease' }}>
        <main style={{ flex: 1, padding: 28, overflowY: 'auto', background: '#FFFFFF' }}>
          <Outlet />
        </main>
      </div>

      <AISidebar isOpen={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  )
}
