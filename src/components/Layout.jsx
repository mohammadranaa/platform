import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import Leads from '../pages/Leads'
import MyLeads from '../pages/MyLeads'
import Jobs from '../pages/Jobs'
import Clients from '../pages/Clients'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import AISidebar from './AISidebar'
import IncomingCallPopup from './IncomingCallPopup'
import GlobalSearch from './GlobalSearch'

const S = {
  sidebarBg:      '#1F2937',
  sidebarBorder:  '#374151',
  sidebarText:    '#F9FAFB',
  sidebarMuted:   '#9CA3AF',
  sidebarActiveBg:'#0093DB22',
  sidebarAIBg:    '#80D10022',
}

// List pages that stay open in the background. Leaving Leads for Jobs (or a lead, a
// client, anything) and coming back shows Leads exactly as it was: same page of
// results, filters, search, scroll position, selections and open panels. Each one
// refreshes its data quietly when you return.
const KEEP_ALIVE = { '/leads': Leads, '/my-leads': MyLeads, '/jobs': Jobs, '/clients': Clients }
const SCROLL_KEY = path => `scroll:${path}`

const NAV_ITEMS = [
  { to: '/',           icon: '◉',  label: 'Dashboard',    exact: true },
  { to: '/my-leads',   icon: '📋', label: 'My Leads'                  },
  { to: '/leads',      icon: '🎯', label: 'Leads'                     },
  { to: '/clients',    icon: '◎',  label: 'Clients'                   },
  { to: '/jobs',       icon: '🔧', label: 'Jobs'                      },
  { to: '/calendar',   icon: '📅', label: 'Calendar'                  },
  { to: '/calls',      icon: '📞', label: 'Calls (NUACOM)'            },
  { to: '/properties', icon: '🏠', label: 'Properties', adminOnly: true },
  { to: '/inbox',      icon: '✉️', label: 'Email Inbox'               },
  { to: '/templates',  icon: '📝', label: 'Templates'                 },
  { to: '/invoices',   icon: '🧾', label: 'Invoices'                  },
  { to: '/campaigns',  icon: '⚡', label: 'Cold Email' },
  { to: '/cold-inbox', icon: '📨', label: 'Cold Inbox',  adminOnly: false },
]

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [aiOpen, setAiOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const unread = notifications.filter(n => !n.is_read).length

  // ── Keep-alive list pages ─────────────────────────────────────
  const location = useLocation()
  const activeKeep = KEEP_ALIVE[location.pathname] ? location.pathname : null
  const [opened, setOpened] = useState(() => (activeKeep ? [activeKeep] : []))
  const lastUrl = useRef({})        // '/leads' -> '/leads?type=cold_agent&page=3'
  const scrollPos = useRef({})      // '/leads' -> 1840
  const prevPath = useRef(null)     // null until the first render: lets a browser reload restore too

  useEffect(() => {
    const prev = prevPath.current
    prevPath.current = location.pathname

    if (activeKeep) {
      lastUrl.current[activeKeep] = location.pathname + location.search
      if (!opened.includes(activeKeep)) setOpened(o => [...o, activeKeep])
      if (prev !== location.pathname) {
        // Returning to a kept page: put the scroll back once it's visible.
        // After a real browser reload the rows arrive a moment later, so keep
        // trying briefly until the page is tall enough.
        const target = scrollPos.current[activeKeep] ?? Number(sessionStorage.getItem(SCROLL_KEY(activeKeep)) || 0)
        let tries = 0, userMoved = false
        const stop = () => { userMoved = true }
        const evts = ['wheel', 'touchstart', 'keydown', 'mousedown']
        evts.forEach(e => window.addEventListener(e, stop, { once: true, passive: true }))
        const done = () => evts.forEach(e => window.removeEventListener(e, stop))
        const restore = () => {
          if (userMoved) return done()          // the rep is scrolling: never fight them
          window.scrollTo(0, target)
          if (Math.abs(window.scrollY - target) > 2 && tries++ < 240) requestAnimationFrame(restore)  // up to ~4s for data to arrive
          else done()
        }
        requestAnimationFrame(restore)
      }
    } else if (prev !== location.pathname) {
      window.scrollTo(0, 0)   // ordinary pages open at the top
    }
  }, [location.pathname, location.search])  // eslint-disable-line react-hooks/exhaustive-deps

  // Also keep the scroll position across a real browser reload (per tab)
  useEffect(() => {
    if (!activeKeep) return
    let t = null
    const onScroll = () => {
      // Ignore the scroll jump the browser makes when this page is being hidden
      if (window.location.pathname !== activeKeep) return
      scrollPos.current[activeKeep] = window.scrollY   // recorded live, so leaving never loses it
      clearTimeout(t)
      t = setTimeout(() => { try { sessionStorage.setItem(SCROLL_KEY(activeKeep), String(window.scrollY)) } catch { /* ignore */ } }, 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { clearTimeout(t); window.removeEventListener('scroll', onScroll) }
  }, [activeKeep])

  useEffect(() => {
    fetchNotifications()
    const channel = supabase
      .channel('notif_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
        setNotifications(p => [payload.new, ...p].slice(0, 30))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
    setNotifications(data || [])
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    setNotifications(p => p.map(n => ({ ...n, is_read: true })))
  }

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

        {/* Global search */}
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${S.sidebarBorder}22` }}>
          <GlobalSearch />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '4px 0', overflowY: 'auto' }}>
          {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(item => (
            <NavLink key={item.to} to={lastUrl.current[item.to] || item.to} end={item.exact}
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

        {/* Notifications bell */}
        <div style={{ padding: '8px 18px', borderTop: `1px solid ${S.sidebarBorder}`, position: 'relative' }}>
          <button onClick={() => { setNotifOpen(p => !p); if (!notifOpen) markAllRead() }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 'none', color: S.sidebarMuted, cursor: 'pointer', fontSize: 13, padding: '4px 0' }}>
            <span style={{ fontSize: 15 }}>🔔</span> Notifications
            {unread > 0 && (
              <span style={{ background: '#DC2626', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 700, marginLeft: 'auto' }}>{unread}</span>
            )}
          </button>
          {notifOpen && (
            <div style={{ position: 'absolute', left: 210, bottom: 0, width: 320, maxHeight: 420, overflowY: 'auto', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 700 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E7EB', fontWeight: 700, fontSize: 13, color: '#1F2937', display: 'flex', justifyContent: 'space-between' }}>
                Notifications
                <span onClick={() => setNotifOpen(false)} style={{ cursor: 'pointer', color: '#9CA3AF' }}>✕</span>
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No notifications yet</div>
              ) : notifications.map(n => (
                <div key={n.id}
                  onClick={() => { if (n.link) navigate(n.link); setNotifOpen(false) }}
                  style={{ padding: '10px 16px', borderBottom: '1px solid #F5F7FA', cursor: n.link ? 'pointer' : 'default', background: n.is_read ? '#fff' : '#E6F4FC' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937' }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{n.body}</div>}
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>{new Date(n.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              ))}
            </div>
          )}
        </div>

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
          {opened.map(path => {
            const Page = KEEP_ALIVE[path]
            const isActive = path === activeKeep
            return (
              <div key={path} style={{ display: isActive ? 'block' : 'none' }}>
                <Page active={isActive} />
              </div>
            )
          })}
          <Outlet />
        </main>
      </div>

      <AISidebar isOpen={aiOpen} onClose={() => setAiOpen(false)} />
      <IncomingCallPopup />
    </div>
  )
}
