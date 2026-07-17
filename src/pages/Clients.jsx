import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const CLIENT_TYPES = ['Landlord', 'Estate Agent', 'Other']
const TYPE_COLORS = {
  'Landlord':     { color: C.accent,    bg: C.accentSoft },
  'Estate Agent': { color: C.purple,    bg: C.purpleSoft },
  'Other':        { color: C.muted,     bg: C.surface    },
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,    color: '#fff',     border: 'none' },
    ghost:   { background: '#fff',      color: C.muted,    border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,   color: C.red,      border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.green}66` },
    purple:  { background: C.purpleSoft, color: C.purple,  border: `1px solid ${C.purple}44` },
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8, fontWeight: 600,
        padding: small ? '6px 13px' : '9px 18px', fontSize: small ? 12 : 14,
        opacity: disabled ? 0.5 : 1, ...v[variant], ...sx }}>
      {children}
    </button>
  )
}

const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const lbl = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

export default function Clients() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()

  const [clients, setClients]     = useState([])
  const [leads, setLeads]         = useState([])
  const [profiles, setProfiles]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType]       = useState('All')
  const [filterActive, setFilterActive]   = useState('Active')
  const [showAdd, setShowAdd]     = useState(false)
  const [showFromLead, setShowFromLead]   = useState(false)
  const [selectedLead, setSelectedLead]   = useState('')

  const blank = {
    client_type: 'Landlord', first_name: '', last_name: '', company_name: '',
    email: '', phone: '', phone_2: '', street_address: '', city: '', postcode: '',
    billing_name: '', billing_email: '', billing_address: '',
    source: 'manual', notes: '', assigned_to: '', is_active: true,
  }
  const [form, setForm] = useState(blank)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchAll() }, [profile])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: l }, { data: p }] = await Promise.all([
      (() => {
        let q = supabase.from('clients').select('*, profiles(full_name)').order('created_at', { ascending: false })
        if (!isAdmin) q = q.eq('assigned_to', profile?.id)
        return q
      })(),
      supabase.from('leads').select('id, lead_type, inbound_name, inbound_email, inbound_phone, company_name, contact_first, contact_last, email_address, job_telephone, street_address, city, postcode, cold_company_name, cold_contact_name, cold_email, cold_address').eq('status', 'Accepted').is('lead_id', null).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('is_active', true),
    ])
    setClients(c || [])
    setLeads(l || [])
    setProfiles(p || [])
    setLoading(false)
  }

  async function addClient() {
    if (!form.email && !form.phone && !form.company_name) {
      showToast('Enter at least email, phone or company name', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('clients').insert({ ...form, assigned_to: form.assigned_to || profile.id })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchAll()
    setShowAdd(false)
    setForm(blank)
    showToast('Client added ✓')
  }

  async function addFromLead() {
    if (!selectedLead) { showToast('Select a lead', 'error'); return }
    setSaving(true)
    const lead = leads.find(l => l.id === selectedLead)
    if (!lead) { setSaving(false); return }

    const clientName = lead.inbound_name || lead.company_name || lead.cold_company_name || `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()
    const email = lead.inbound_email || lead.email_address || lead.cold_email
    const phone = lead.inbound_phone || lead.job_telephone || ''
    const address = lead.street_address || lead.address || lead.cold_address || ''
    const type = lead.lead_type === 'cold_agent' ? 'Estate Agent' : 'Landlord'

    const { error } = await supabase.from('clients').insert({
      client_type: type,
      company_name: lead.company_name || lead.cold_company_name || null,
      first_name: lead.contact_first || (lead.inbound_name ? lead.inbound_name.split(' ')[0] : null),
      last_name: lead.contact_last || (lead.inbound_name ? lead.inbound_name.split(' ').slice(1).join(' ') : null),
      email, phone, street_address: address,
      city: lead.city, postcode: lead.postcode,
      source: 'converted-lead', lead_id: lead.id,
      assigned_to: profile.id, is_active: true,
    })

    // Mark lead as accepted
    await supabase.from('leads').update({ status: 'Accepted' }).eq('id', lead.id)

    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchAll()
    setShowFromLead(false)
    setSelectedLead('')
    showToast(`${clientName} added to clients ✓`)
  }

  async function toggleActive(client) {
    const newVal = !client.is_active
    await supabase.from('clients').update({ is_active: newVal }).eq('id', client.id)
    setClients(p => p.map(c => c.id === client.id ? { ...c, is_active: newVal } : c))
    showToast(newVal ? 'Client set to Active' : 'Client set to Inactive')
  }

  const clientName = c => c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || '—'
  const leadName = l => l.inbound_name || l.company_name || l.cold_company_name || `${l.contact_first || ''} ${l.contact_last || ''}`.trim() || '—'
  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })

  const filtered = useMemo(() => clients
    .filter(c => filterType === 'All' || c.client_type === filterType)
    .filter(c => filterActive === 'All' || (filterActive === 'Active' ? c.is_active !== false : c.is_active === false))
    .filter(c => {
      if (!search) return true
      const q = search.toLowerCase()
      return clientName(c).toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.phone?.includes(q)
    })
  , [clients, filterType, filterActive, search])

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Clients</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{clients.length} total · {filtered.length} shown</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="purple" onClick={() => setShowFromLead(true)}>+ From Lead</Btn>
          <Btn small onClick={() => setShowAdd(true)}>+ Add Client</Btn>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, company, email…"
          style={{ ...inp, flex: 1, minWidth: 200, width: 'auto', padding: '8px 14px' }} />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All Types</option>
          {CLIENT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading clients…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No clients yet. <button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Add one →</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Client','Type','Status','Email','Phone','Jobs','Revenue','Rep','Actions'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const tm = TYPE_COLORS[c.client_type] || { color: C.muted, bg: C.surface }
                return (
                  <tr key={c.id}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: C.text, cursor: 'pointer' }} onClick={() => navigate(`/clients/${c.id}`)}>{clientName(c)}{c.auto_generated && <span style={{ background: '#CCFBF1', color: '#0D9488', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, marginLeft: 6 }}>AUTO</span>}</div>
                      {c.email && <div style={{ fontSize: 12, color: C.muted }}>{c.email}</div>}
                    </td>
                    <td style={td}>
                      <span style={{ background: tm.bg, color: tm.color, border: `1px solid ${tm.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{c.client_type}</span>
                    </td>
                    <td style={td}>
                      <span style={{ background: c.is_active !== false ? C.greenSoft : C.redSoft, color: c.is_active !== false ? C.greenDark : C.red, border: `1px solid ${c.is_active !== false ? C.green : C.red}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 600 }}>
                        {c.is_active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{c.email || '—'}</span></td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{c.phone || '—'}</span></td>
                    <td style={td}><span style={{ color: C.accent, fontWeight: 700 }}>{c.total_jobs || 0}</span></td>
                    <td style={td}><span style={{ color: C.greenDark, fontWeight: 600 }}>{fmt(c.total_revenue)}</span></td>
                    <td style={td}><span style={{ color: C.muted, fontSize: 13 }}>{c.profiles?.full_name || '—'}</span></td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => navigate(`/clients/${c.id}`)}
                          style={{ background: C.accentSoft, color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>View</button>
                        <button onClick={() => toggleActive(c)}
                          style={{ background: c.is_active !== false ? C.redSoft : C.greenSoft, color: c.is_active !== false ? C.red : C.greenDark, border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                          {c.is_active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Add from Lead Modal ──────────────────────────────── */}
      {showFromLead && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowFromLead(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Add Client from Lead</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Select an accepted lead to convert to a client. The lead will be marked as Accepted.</div>

            {leads.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 14, padding: '20px 0' }}>No leads available to convert. Leads with status "Accepted" will appear here.</div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Select Lead</label>
                <select value={selectedLead} onChange={e => setSelectedLead(e.target.value)} style={inp}>
                  <option value="">— Select a lead —</option>
                  {leads.map(l => (
                    <option key={l.id} value={l.id}>
                      {leadName(l)} · {l.lead_type === 'inbound' ? 'Inbound' : l.lead_type === 'verified' ? 'Verified' : 'Cold Agent'}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              {leads.length > 0 && <Btn onClick={addFromLead} disabled={saving || !selectedLead}>{saving ? 'Converting…' : 'Convert to Client'}</Btn>}
              <Btn variant="ghost" onClick={() => { setShowFromLead(false); setSelectedLead('') }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Client Modal ─────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 20 }}>Add New Client</div>

            {/* Type */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {CLIENT_TYPES.map(t => {
                const m = TYPE_COLORS[t]
                return (
                  <button key={t} onClick={() => set('client_type', t)}
                    style={{ flex: 1, padding: '9px', borderRadius: 8, border: `1px solid ${form.client_type === t ? m.color : C.border}`, background: form.client_type === t ? m.bg : '#fff', color: form.client_type === t ? m.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: form.client_type === t ? 700 : 400 }}>
                    {t}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { label: 'First Name',       key: 'first_name' },
                { label: 'Last Name',        key: 'last_name' },
                { label: 'Company Name',     key: 'company_name', full: true },
                { label: 'Email',            key: 'email',    type: 'email' },
                { label: 'Phone',            key: 'phone' },
                { label: 'Phone 2',          key: 'phone_2' },
                { label: 'Street Address',   key: 'street_address', full: true },
                { label: 'City',             key: 'city' },
                { label: 'Postcode',         key: 'postcode' },
                { label: 'Billing Name',     key: 'billing_name' },
                { label: 'Billing Email',    key: 'billing_email', type: 'email' },
                { label: 'Billing Address',  key: 'billing_address', full: true },
              ].map(f => (
                <div key={f.key} style={{ gridColumn: f.full ? 'span 2' : 'span 1' }}>
                  <label style={lbl}>{f.label}</label>
                  <input type={f.type || 'text'} value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} style={inp} />
                </div>
              ))}
              {isAdmin && (
                <div>
                  <label style={lbl}>Assign To</label>
                  <select value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)} style={inp}>
                    <option value="">— Select rep —</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={lbl}>Source</label>
                <select value={form.source} onChange={e => set('source', e.target.value)} style={inp}>
                  {['manual','website','whatsapp','email','phone','referral','import'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} id="is_active" />
                <label htmlFor="is_active" style={{ color: C.text, fontSize: 14, cursor: 'pointer' }}>Active Client</label>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Notes</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                  style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
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
