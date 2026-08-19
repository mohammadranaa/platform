import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const C = {
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#3d7a00', greenSoft: '#F0FAE0',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
  border: '#E5E7EB', surface: '#F5F7FA',
}

export default function MyLeads() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterType, setFilterType] = useState('All')

  useEffect(() => { if (profile?.id) fetchMyLeads() }, [profile])

  async function fetchMyLeads() {
    setLoading(true)
    const { data } = await supabase
      .from('leads')
      .select('id, lead_type, inbound_name, inbound_email, inbound_phone, cold_company_name, cold_email, landline_number, status, email_verified, created_at, assigned_to, last_contacted_at')
      .eq('assigned_to', profile.id)
      .order('created_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  async function unclaimLead(leadId) {
    if (!window.confirm('Remove this lead from your list?')) return
    await supabase.from('leads').update({ assigned_to: null }).eq('id', leadId)
    setLeads(p => p.filter(l => l.id !== leadId))
  }

  const statusColors = {
    New: { bg:'#E6F4FC', color:'#0093DB' },
    Contacted: { bg:'#FEF3C7', color:'#D97706' },
    'In Discussion': { bg:'#F0FAE0', color:'#3d7a00' },
    Declined: { bg:'#FEE2E2', color:'#DC2626' },
    Accepted: { bg:'#DCFCE7', color:'#166534' },
  }

  const filtered = leads.filter(l => {
    const name = l.inbound_name || l.cold_company_name || ''
    const email = l.inbound_email || l.cold_email || ''
    const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || email.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'All' || l.status === filterStatus
    const matchType = filterType === 'All' || l.lead_type === filterType
    return matchSearch && matchStatus && matchType
  })

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:C.text, margin:0 }}>My Leads</h1>
          <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>Leads you have claimed — {leads.length} total</div>
        </div>
        <button onClick={() => navigate('/leads')}
          style={{ background:C.accentSoft, color:C.accent, border:`1px solid ${C.accent}44`, borderRadius:8, padding:'8px 16px', fontWeight:600, fontSize:13, cursor:'pointer' }}>
          Browse All Leads
        </button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email..."
          style={{ flex:1, minWidth:200, background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', fontSize:13 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', fontSize:13 }}>
          <option value="All">All Statuses</option>
          {['New','Contacted','In Discussion','Declined','Accepted'].map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', fontSize:13 }}>
          <option value="All">All Types</option>
          <option value="inbound">Inbound</option>
          <option value="cold_agent">Cold</option>
        </select>
      </div>

      {/* Stats */}
      <div style={{ display:'flex', gap:12, marginBottom:20 }}>
        {[
          { label:'Total', value:leads.length, color:C.text },
          { label:'New', value:leads.filter(l=>l.status==='New').length, color:'#0093DB' },
          { label:'Contacted', value:leads.filter(l=>l.status==='Contacted').length, color:'#D97706' },
          { label:'In Discussion', value:leads.filter(l=>l.status==='In Discussion').length, color:C.green },
        ].map(s => (
          <div key={s.label} style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:10, padding:'12px 16px', flex:1, textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.value}</div>
            <div style={{ fontSize:11, color:C.muted, textTransform:'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Leads list */}
      {loading ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:C.muted }}>Loading your leads...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', background:'#fff', borderRadius:12, border:`2px dashed ${C.border}` }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
          <div style={{ fontSize:16, fontWeight:600, color:C.text, marginBottom:8 }}>
            {leads.length === 0 ? 'No leads claimed yet' : 'No leads match your filters'}
          </div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>
            {leads.length === 0 ? 'Go to All Leads and claim leads to track them here' : 'Try clearing your filters'}
          </div>
          {leads.length === 0 && (
            <button onClick={() => navigate('/leads')}
              style={{ background:C.accent, color:'#fff', border:'none', borderRadius:8, padding:'10px 24px', fontWeight:700, fontSize:14, cursor:'pointer' }}>
              Browse All Leads
            </button>
          )}
        </div>
      ) : (
        <div style={{ background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:C.surface }}>
                {['Name / Company','Type','Email','Phone','Status','Last Contact',''].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', color:C.muted, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const name = l.inbound_name || l.cold_company_name || '—'
                const email = l.inbound_email || l.cold_email || '—'
                const phone = l.inbound_phone || l.landline_number || '—'
                const sc = statusColors[l.status] || { bg:'#F5F7FA', color:C.muted }
                return (
                  <tr key={l.id} onClick={() => navigate('/leads/' + l.id)}
                    style={{ cursor:'pointer', borderBottom:`1px solid ${C.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding:'12px 14px' }}>
                      <div style={{ fontWeight:600, fontSize:13, color:C.text }}>{name}</div>
                      <div style={{ fontSize:11, color:C.muted }}>{l.lead_type === 'inbound' ? 'Inbound' : 'Cold'}</div>
                    </td>
                    <td style={{ padding:'12px 14px' }}>
                      <span style={{ background: l.lead_type==='inbound' ? '#E6F4FC' : '#F0FAE0', color: l.lead_type==='inbound' ? '#0093DB' : '#3d7a00', borderRadius:5, padding:'2px 8px', fontSize:11, fontWeight:600 }}>
                        {l.lead_type === 'inbound' ? 'Inbound' : 'Cold'}
                      </span>
                    </td>
                    <td style={{ padding:'12px 14px', fontSize:12, color:C.muted }}>{email}</td>
                    <td style={{ padding:'12px 14px', fontSize:12, color:C.muted }}>{phone}</td>
                    <td style={{ padding:'12px 14px' }}>
                      <span style={{ background:sc.bg, color:sc.color, borderRadius:5, padding:'2px 8px', fontSize:11, fontWeight:600 }}>
                        {l.status || 'New'}
                      </span>
                    </td>
                    <td style={{ padding:'12px 14px', fontSize:11, color:C.dim }}>
                      {l.last_contacted_at ? new Date(l.last_contacted_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td style={{ padding:'12px 14px' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => unclaimLead(l.id)}
                        style={{ background:'#FEE2E2', color:'#DC2626', border:'1px solid #DC262644', borderRadius:6, padding:'4px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
