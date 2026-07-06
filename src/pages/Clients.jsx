import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#111827', surface: '#1F2937', border: '#374151',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7',
  text: '#FAFAF7', muted: '#9ca3af', dim: '#475569',
}

const STATUSES = ['New','Contacted','Qualified','Proposal Sent','Active Client','Closed Won','Closed Lost','Unsubscribed']

const STATUS_COLORS = {
  'New':           { color: C.muted,   bg: C.surface },
  'Contacted':     { color: C.amber,   bg: C.amberSoft },
  'Qualified':     { color: C.purple,  bg: '#2E1065' },
  'Proposal Sent': { color: '#38BDF8', bg: '#0C2A3D' },
  'Active Client': { color: C.green,   bg: C.greenSoft },
  'Closed Won':    { color: C.green,   bg: C.greenSoft },
  'Closed Lost':   { color: C.red,     bg: C.redSoft },
  'Unsubscribed':  { color: C.dim,     bg: C.surface },
}

const TYPE_META = {
  inbound:    { label: 'Inbound',      color: C.green,  desc: 'Website & WhatsApp bookings' },
  verified:   { label: 'Verified',     color: C.accent, desc: 'Past customers from job history' },
  cold_agent: { label: 'Cold Agents',  color: C.amber,  desc: 'Estate agents for outreach' },
}

const TABS = [
  { key: 'all',        label: 'All Clients' },
  { key: 'inbound',    label: 'Inbound' },
  { key: 'verified',   label: 'Verified' },
  { key: 'cold_agent', label: 'Cold Agents' },
]

// ── Shared atoms ──────────────────────────────────────────────
const Badge = ({ status }) => {
  const m = STATUS_COLORS[status] || { color: C.muted, bg: C.surface }
  return (
    <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}33`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

const TypeChip = ({ type }) => {
  const m = TYPE_META[type] || { label: type, color: C.muted }
  return (
    <span style={{ background: m.color + '22', color: m.color, border: `1px solid ${m.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: 'transparent', color: C.muted, border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft, color: C.red, border: `1px solid ${C.red}44` },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 8,
        fontWeight: 600,
        padding: small ? '6px 14px' : '9px 18px',
        fontSize: small ? 12 : 14,
        opacity: disabled ? 0.5 : 1,
        ...v[variant],
        ...sx,
      }}
    >
      {children}
    </button>
  )
}

export default function Clients() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast, showToast } = useToast()

  const [clients, setClients]   = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  // Filters
  const initialTab = searchParams.get('type') || 'all'
  const [tab, setTab]             = useState(initialTab)
  const [search, setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterRep, setFilterRep]       = useState('All')

  // Add client modal
  const [showAdd, setShowAdd] = useState(false)
  const blankClient = {
    customer_type: 'inbound',
    first_name: '', last_name: '', company_name: '',
    email: '', phone: '', phone_2: '',
    street_address: '', city: '', postcode: '',
    source: 'manual', notes: '',
    status: 'New', assigned_to: '',
  }
  const [form, setForm] = useState(blankClient)

  useEffect(() => { fetchAll() }, [profile])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchClients(), fetchProfiles()])
    setLoading(false)
  }

  async function fetchClients() {
    let q = supabase
      .from('clients')
      .select('id, customer_type, first_name, last_name, company_name, email, phone, status, source, total_jobs, total_revenue, created_at, assigned_to, profiles(full_name)')
      .order('created_at', { ascending: false })
    if (!isAdmin) q = q.eq('assigned_to', profile.id)
    const { data, error } = await q
    if (!error) setClients(data || [])
  }

  async function fetchProfiles() {
    const { data } = await supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
    setProfiles(data || [])
  }

  async function addClient() {
    if (!form.email && !form.phone && !form.company_name) {
      showToast('Please enter at least an email, phone, or company name', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('clients').insert({
      ...form,
      assigned_to: form.assigned_to || profile.id,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchClients()
    setShowAdd(false)
    setForm(blankClient)
    showToast('Client added ✓')
  }

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    return clients
      .filter(c => tab === 'all' || c.customer_type === tab)
      .filter(c => filterStatus === 'All' || c.status === filterStatus)
      .filter(c => filterRep === 'All' || c.assigned_to === filterRep)
      .filter(c => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          c.first_name?.toLowerCase().includes(q) ||
          c.last_name?.toLowerCase().includes(q) ||
          c.company_name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.includes(q)
        )
      })
  }, [clients, tab, filterStatus, filterRep, search])

  const clientName = c => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '—'
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })

  const th = { textAlign: 'left', padding: '10px 16px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}` }
  const td = { padding: '11px 16px', borderBottom: `1px solid ${C.border}18`, fontSize: 14, verticalAlign: 'middle' }

  // Update setForm helper
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Clients</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>
            {clients.length} total · {filtered.length} shown
          </div>
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Client</Btn>
      </div>

      {/* ── Type tabs ──────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? C.bg : 'transparent',
              color: tab === t.key ? C.text : C.muted,
              transition: 'all .15s',
            }}
          >
            {t.label}
            <span style={{ marginLeft: 6, color: tab === t.key ? C.accent : C.dim, fontSize: 12 }}>
              {t.key === 'all' ? clients.length : clients.filter(c => c.customer_type === t.key).length}
            </span>
          </button>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, company, email, phone…"
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 14px', fontSize: 14, flex: 1, minWidth: 220 }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14 }}>
          <option value="All">All Statuses</option>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        {isAdmin && (
          <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 14 }}>
            <option value="All">All Reps</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────── */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading clients…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No clients found.{' '}
            <button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Add one →
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Client', 'Type', 'Status', 'Source', isAdmin ? 'Rep' : null, 'Jobs', 'Revenue', 'Added'].filter(Boolean).map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={td}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{clientName(c)}</div>
                    <div style={{ color: C.dim, fontSize: 12 }}>{c.email || c.phone || '—'}</div>
                  </td>
                  <td style={td}><TypeChip type={c.customer_type} /></td>
                  <td style={td}><Badge status={c.status} /></td>
                  <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{c.source || '—'}</span></td>
                  {isAdmin && <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{c.profiles?.full_name || '—'}</span></td>}
                  <td style={td}><span style={{ color: C.accent, fontWeight: 600 }}>{c.total_jobs || 0}</span></td>
                  <td style={td}><span style={{ color: '#80D100', fontWeight: 600 }}>{fmt(c.total_revenue)}</span></td>
                  <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add Client Modal ────────────────────────────────── */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 580, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Add New Client</div>

            {/* Customer type selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => set('customer_type', key)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${form.customer_type === key ? meta.color : C.border}`,
                    background: form.customer_type === key ? meta.color + '22' : 'transparent',
                    color: form.customer_type === key ? meta.color : C.muted,
                    cursor: 'pointer', fontSize: 13, fontWeight: form.customer_type === key ? 700 : 400,
                  }}
                >
                  {meta.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { label: 'First Name', key: 'first_name', placeholder: 'Jordan' },
                { label: 'Last Name', key: 'last_name', placeholder: 'Blake' },
                { label: 'Company Name', key: 'company_name', placeholder: 'Capital Homes Ltd', full: true },
                { label: 'Email', key: 'email', type: 'email', placeholder: 'jordan@example.co.uk' },
                { label: 'Phone', key: 'phone', placeholder: '07700 900000' },
                { label: 'Phone 2', key: 'phone_2', placeholder: '020 1234 5678' },
                { label: 'Street Address', key: 'street_address', placeholder: '12 High Street', full: true },
                { label: 'City', key: 'city', placeholder: 'London' },
                { label: 'Postcode', key: 'postcode', placeholder: 'N1 9XX' },
              ].map(f => (
                <div key={f.key} style={{ gridColumn: f.full ? 'span 2' : 'span 1', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</label>
                  <input
                    type={f.type || 'text'}
                    value={form[f.key]}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}
                  />
                </div>
              ))}

              {/* Source */}
              <div style={{ gridColumn: 'span 1', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source</label>
                <select value={form.source} onChange={e => set('source', e.target.value)}
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
                  {['manual','website','whatsapp','email','cold-email','phone','referral','servicem8-import'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Assign rep — admin only */}
              {isAdmin && (
                <div style={{ gridColumn: 'span 1', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assign To</label>
                  <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}
                    style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
                    <option value="">— Select rep —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  rows={3}
                  placeholder="Any initial notes about this client…"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <Btn onClick={addClient} disabled={saving}>{saving ? 'Saving…' : 'Add Client'}</Btn>
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
