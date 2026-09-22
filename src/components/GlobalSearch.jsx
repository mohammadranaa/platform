import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  accent: '#0093DB', accentSoft: '#E6F4FC', border: '#E5E7EB',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF', surface: '#F5F7FA',
  green: '#80D100', greenDark: '#3d7a00', red: '#DC2626',
}

export default function GlobalSearch() {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const debounceRef = useRef(null)

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else { setQuery(''); setResults([]) }
  }, [open])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => search(query.trim()), 300)
  }, [query])

  async function search(q) {
    setLoading(true)
    const lq = q.toLowerCase()

    // Run all searches in parallel
    const [leads, clients, jobs, calls] = await Promise.all([
      // Leads — search by name, email, company, phone, postcode
      supabase.from('leads').select('id, lead_type, cold_company_name, cold_contact_name, cold_email, inbound_name, inbound_email, inbound_phone, status, postcode, city')
        .or(`cold_company_name.ilike.%${q}%,cold_contact_name.ilike.%${q}%,cold_email.ilike.%${q}%,inbound_name.ilike.%${q}%,inbound_email.ilike.%${q}%,inbound_phone.ilike.%${q}%,postcode.ilike.%${q}%`)
        .is('deleted_at', null).limit(5),

      // Clients — search by name, email, phone, company, postcode
      supabase.from('clients').select('id, first_name, last_name, company_name, email, phone, postcode, client_type')
        .or(`company_name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,postcode.ilike.%${q}%`)
        .limit(5),

      // Jobs — search by job number, address, postcode, client name, tenant phone
      supabase.from('jobs').select('id, job_number, title, site_address, site_postcode, status, tenant_name, tenant_phone')
        .or(`job_number.ilike.%${q}%,site_address.ilike.%${q}%,site_postcode.ilike.%${q}%,tenant_name.ilike.%${q}%,tenant_phone.ilike.%${q}%`)
        .limit(5),

      // Calls — search by caller number or name
      supabase.from('nuacom_calls').select('id, call_caller_number, call_caller_number_local, call_caller_name, call_direction, call_answered, call_at, duration_seconds')
        .or(`call_caller_number.ilike.%${q}%,call_caller_number_local.ilike.%${q}%,call_caller_name.ilike.%${q}%`)
        .order('call_at', { ascending: false }).limit(5),
    ])

    const out = []

    for (const l of (leads.data || [])) {
      const name = l.cold_company_name || l.cold_contact_name || l.inbound_name || l.inbound_email || '—'
      const sub  = l.cold_email || l.inbound_email || l.inbound_phone || l.postcode || ''
      out.push({ type: 'Lead', icon: '📋', label: name, sub, status: l.status, path: `/leads/${l.id}` })
    }
    for (const c of (clients.data || [])) {
      const name = c.company_name || `${c.first_name||''} ${c.last_name||''}`.trim() || '—'
      const sub  = c.email || c.phone || c.postcode || ''
      out.push({ type: 'Client', icon: '👤', label: name, sub, status: c.client_type, path: `/clients/${c.id}` })
    }
    for (const j of (jobs.data || [])) {
      out.push({ type: 'Job', icon: '🔧', label: `${j.job_number} — ${j.title||''}`, sub: j.site_address || j.site_postcode || '', status: j.status, path: `/jobs/${j.id}` })
    }
    for (const c of (calls.data || [])) {
      const num  = c.call_caller_number_local || c.call_caller_number || '—'
      const name = c.call_caller_name || num
      const dt   = c.call_at ? new Date(c.call_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''
      out.push({ type: 'Call', icon: '📞', label: name, sub: `${c.call_direction} · ${dt} · ${Math.floor((c.duration_seconds||0)/60)}m`, status: c.call_answered ? 'Answered' : 'Missed', path: null, call: c })
    }

    setResults(out)
    setLoading(false)
  }

  function go(item) {
    if (item.path) navigate(item.path)
    setOpen(false)
  }

  const STATUS_COLOR = {
    'Answered': '#DCFCE7', 'Missed': '#FEE2E2', 'New': '#F3F4F6', 'Contacted': '#E6F4FC',
    'In Discussion': '#CCFBF1', 'Accepted': '#DCFCE7', 'Declined': '#FEE2E2',
    'Completed': '#DCFCE7', 'Confirmed': '#EDE9FE', 'Landlord': '#F3F4F6', 'Estate Agent': '#FEF3C7',
  }
  const STATUS_TEXT = {
    'Answered': '#15803D', 'Missed': '#DC2626', 'New': '#6B7280', 'Contacted': '#0093DB',
    'In Discussion': '#0D9488', 'Accepted': '#15803D', 'Declined': '#DC2626',
    'Completed': '#15803D', 'Confirmed': '#7C3AED', 'Landlord': '#6B7280', 'Estate Agent': '#B45309',
  }

  return (
    <>
      {/* Search icon button in sidebar — rendered from Layout via props */}
      <button onClick={() => setOpen(true)}
        title="Global search (Ctrl+K)"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: '100%', gap: 8, color: C.muted, fontSize: 13 }}>
        <span style={{ fontSize: 18 }}>🔍</span>
        <span style={{ fontSize: 12 }}>Search</span>
        <span style={{ marginLeft: 'auto', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 5px', fontSize: 10, color: C.dim }}>⌘K</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80 }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 600, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>

            {/* Search input */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${C.border}`, gap: 10 }}>
              <span style={{ fontSize: 18 }}>🔍</span>
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search leads, clients, jobs, phone numbers, postcodes…"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, color: C.text, background: 'transparent' }} />
              {loading && <span style={{ fontSize: 11, color: C.dim }}>Searching…</span>}
              <kbd style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', fontSize: 11, color: C.dim, cursor: 'pointer' }}
                onClick={() => setOpen(false)}>Esc</kbd>
            </div>

            {/* Results */}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {query.length < 2 ? (
                <div style={{ padding: '24px 20px', color: C.dim, fontSize: 13, textAlign: 'center' }}>
                  Type a name, phone number, postcode, job number, or email address
                </div>
              ) : results.length === 0 && !loading ? (
                <div style={{ padding: '24px 20px', color: C.dim, fontSize: 13, textAlign: 'center' }}>
                  No results for "{query}"
                </div>
              ) : (
                <>
                  {['Lead','Client','Job','Call'].map(type => {
                    const group = results.filter(r => r.type === type)
                    if (!group.length) return null
                    return (
                      <div key={type}>
                        <div style={{ padding: '8px 18px 4px', fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em', background: C.surface }}>
                          {type}s
                        </div>
                        {group.map((item, i) => (
                          <button key={i} onClick={() => go(item)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: item.path ? 'pointer' : 'default', textAlign: 'left' }}
                            onMouseEnter={e => e.currentTarget.style.background = C.accentSoft}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                              {item.sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</div>}
                            </div>
                            {item.status && (
                              <span style={{ background: STATUS_COLOR[item.status] || C.surface, color: STATUS_TEXT[item.status] || C.muted, borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                {item.status}
                              </span>
                            )}
                            {item.path && <span style={{ color: C.dim, fontSize: 12, flexShrink: 0 }}>→</span>}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
