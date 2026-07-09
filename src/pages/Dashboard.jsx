import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  teal: '#0D9488', tealSoft: '#CCFBF1',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const JOB_STATUS_COLORS = {
  'In Progress': C.amber, 'Scheduled': '#0284C7', 'Paid': C.accent,
  'Completed': C.teal, 'Certificate Delivered': C.greenDark, 'Cancelled': C.red,
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

function getPeriodStart(period) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'today') return today.toISOString()
  if (period === 'week') {
    const day = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
    return monday.toISOString()
  }
  if (period === 'month') return new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
  return today.toISOString()
}

function StatCard({ label, value, sub, color = C.accent, icon, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', border: `1px solid ${C.border}`,
      borderTop: `3px solid ${color}`, borderRadius: 12,
      padding: '18px 20px', flex: 1, minWidth: 130,
      cursor: onClick ? 'pointer' : 'default',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}
      </div>
      <div style={{ color, fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ color: C.dim, fontSize: 12 }}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{children}</div>
      {action}
    </div>
  )
}

function LogActivityWidget({ profile, onLogged }) {
  const [type, setType] = useState('call')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  async function log() {
    if (!content.trim()) return
    setSaving(true)
    await supabase.from('rep_activities').insert({ rep_id: profile.id, rep_name: profile.full_name, type, content })
    setSaving(false)
    setContent('')
    onLogged()
  }
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={type} onChange={e => setType(e.target.value)}
        style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }}>
        <option value="call">📞 Call</option>
        <option value="email">✉️ Email</option>
        <option value="outreach">📡 Outreach</option>
        <option value="meeting">🤝 Meeting</option>
        <option value="note">📝 Note</option>
      </select>
      <input value={content} onChange={e => setContent(e.target.value)} onKeyDown={e => e.key === 'Enter' && log()}
        placeholder="What did you do? Press Enter to log…"
        style={{ flex: 1, minWidth: 200, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '8px 12px', fontSize: 13 }} />
      <button onClick={log} disabled={saving || !content.trim()}
        style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
        {saving ? 'Logging…' : 'Log'}
      </button>
    </div>
  )
}

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState('today')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({})
  const [repStats, setRepStats] = useState([])
  const [recentJobs, setRecentJobs] = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [renewalsDue, setRenewalsDue] = useState([])

  useEffect(() => { fetchAll() }, [period, profile])

  async function fetchAll() {
    if (!profile) return
    setLoading(true)
    const from = getPeriodStart(period)
    await Promise.all([
      fetchStats(from),
      fetchRecentJobs(),
      fetchRecentActivity(from),
      isAdmin ? fetchRenewals() : Promise.resolve(),
    ])
    setLoading(false)
  }

  async function fetchStats(from) {
    if (isAdmin) {
      const [{ data: allJobs }, { data: periodJobs }, { data: leads }, { data: profiles }, { data: activities }, { data: periodPayments }] = await Promise.all([
        supabase.from('jobs').select('status, payment_amount, payment_status'),
        supabase.from('jobs').select('status, assigned_to, payment_amount, payment_status').gte('created_at', from),
        supabase.from('leads').select('lead_type'),
        supabase.from('profiles').select('id, full_name, role').eq('is_active', true).neq('role', 'admin'),
        supabase.from('rep_activities').select('rep_id, type').gte('created_at', from),
        supabase.from('jobs').select('assigned_to, payment_amount').eq('payment_status', 'Paid').gte('updated_at', from),
      ])
      setData({
        totalJobs: allJobs?.length || 0,
        periodJobs: periodJobs?.length || 0,
        inProgress: allJobs?.filter(j => j.status === 'In Progress').length || 0,
        scheduled: allJobs?.filter(j => j.status === 'Scheduled').length || 0,
        completed: allJobs?.filter(j => j.status === 'Completed').length || 0,
        certDelivered: allJobs?.filter(j => j.status === 'Certificate Delivered').length || 0,
        totalRevenue: allJobs?.filter(j => j.payment_status === 'Paid').reduce((s, j) => s + (j.payment_amount || 0), 0) || 0,
        periodRevenue: periodPayments?.reduce((s, j) => s + (j.payment_amount || 0), 0) || 0,
        totalLeads: leads?.length || 0,
        inbound: leads?.filter(l => l.lead_type === 'inbound').length || 0,
        verified: leads?.filter(l => l.lead_type === 'verified').length || 0,
        coldAgents: leads?.filter(l => l.lead_type === 'cold_agent').length || 0,
        jobsByStatus: allJobs?.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {}) || {},
      })
      const summaries = (profiles || []).map(rep => ({
        id: rep.id, name: rep.full_name, role: rep.role,
        jobs: periodJobs?.filter(j => j.assigned_to === rep.id).length || 0,
        revenue: periodPayments?.filter(j => j.assigned_to === rep.id).reduce((s, j) => s + (j.payment_amount || 0), 0) || 0,
        calls: activities?.filter(a => a.rep_id === rep.id && a.type === 'call').length || 0,
        emails: activities?.filter(a => a.rep_id === rep.id && a.type === 'email').length || 0,
        outreach: activities?.filter(a => a.rep_id === rep.id && a.type === 'outreach').length || 0,
      }))
      setRepStats(summaries)
    } else {
      const [{ data: myJobs }, { data: allMyJobs }, { data: myActs }, { data: myPaid }] = await Promise.all([
        supabase.from('jobs').select('status').eq('assigned_to', profile.id).gte('created_at', from),
        supabase.from('jobs').select('status').eq('assigned_to', profile.id),
        supabase.from('rep_activities').select('type').eq('rep_id', profile.id).gte('created_at', from),
        supabase.from('jobs').select('payment_amount').eq('assigned_to', profile.id).eq('payment_status', 'Paid').gte('updated_at', from),
      ])
      setData({
        periodJobs: myJobs?.length || 0,
        totalJobs: allMyJobs?.length || 0,
        periodRevenue: myPaid?.reduce((s, j) => s + (j.payment_amount || 0), 0) || 0,
        calls: myActs?.filter(a => a.type === 'call').length || 0,
        emails: myActs?.filter(a => a.type === 'email').length || 0,
        outreach: myActs?.filter(a => a.type === 'outreach').length || 0,
        inProgress: allMyJobs?.filter(j => j.status === 'In Progress').length || 0,
        scheduled: allMyJobs?.filter(j => j.status === 'Scheduled').length || 0,
      })
    }
  }

  async function fetchRecentJobs() {
    let q = supabase.from('jobs').select('id, job_number, title, status, clients(first_name, last_name, company_name)').order('created_at', { ascending: false }).limit(6)
    if (!isAdmin) q = q.eq('assigned_to', profile?.id)
    const { data } = await q
    setRecentJobs(data || [])
  }

  async function fetchRecentActivity(from) {
    let q = supabase.from('rep_activities').select('id, type, content, created_at, rep_name').order('created_at', { ascending: false }).limit(8)
    if (!isAdmin) q = q.eq('rep_id', profile?.id)
    const { data } = await q
    setRecentActivity(data || [])
  }

  async function fetchRenewals() {
    const { data } = await supabase.from('leads').select('id, contact_first, contact_last, company_name, work_done, renewal_due_date').eq('lead_type', 'verified').not('renewal_due_date', 'is', null).order('renewal_due_date').limit(8)
    setRenewalsDue(data || [])
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })
  const periodLabel = PERIODS.find(p => p.key === period)?.label || 'Today'
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'
  const actIcon = { call: '📞', email: '✉️', outreach: '📡', meeting: '🤝', note: '📝' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {profile?.full_name?.split(' ')[0] || 'there'} 👋
          </h1>
          <div style={{ color: C.muted, fontSize: 14 }}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        {/* Period toggle */}
        <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 2 }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: period === p.key ? 700 : 400, background: period === p.key ? '#fff' : 'transparent', color: period === p.key ? C.accent : C.muted, boxShadow: period === p.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>Loading dashboard…</div>
      ) : isAdmin ? (
        <>
          {/* Admin — company overview */}
          <SectionTitle>Company Overview — {periodLabel}</SectionTitle>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <StatCard label="Jobs Created"        value={data.periodJobs ?? '—'}      color={C.accent}    icon="🔧" onClick={() => navigate('/jobs')} />
            <StatCard label={`Revenue ${periodLabel}`} value={fmt(data.periodRevenue)} color={C.greenDark} icon="💷" />
            <StatCard label="In Progress"          value={data.inProgress ?? '—'}      color={C.amber}     icon="⚙️" />
            <StatCard label="Scheduled"            value={data.scheduled ?? '—'}       color={'#0284C7'}   icon="📅" />
            <StatCard label="Cert. Delivered"      value={data.certDelivered ?? '—'}   color={C.greenDark} icon="✅" />
          </div>

          <SectionTitle>Lead Pipeline</SectionTitle>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <StatCard label="Total Leads"  value={data.totalLeads ?? '—'}  color={C.text}   onClick={() => navigate('/leads')} />
            <StatCard label="Inbound"      value={data.inbound ?? '—'}     color={C.accent} onClick={() => navigate('/leads?type=inbound')} />
            <StatCard label="Verified"     value={data.verified ?? '—'}    color={C.purple} onClick={() => navigate('/leads?type=verified')} />
            <StatCard label="Cold Agents"  value={data.coldAgents ?? '—'}  color={C.amber}  onClick={() => navigate('/leads?type=cold_agent')} />
          </div>

          {/* Jobs by status */}
          {data.jobsByStatus && Object.keys(data.jobsByStatus).length > 0 && (
            <>
              <SectionTitle>Jobs by Status</SectionTitle>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(data.jobsByStatus).map(([status, count]) => {
                  const color = JOB_STATUS_COLORS[status] || C.muted
                  return (
                    <div key={status} onClick={() => navigate(`/jobs?status=${encodeURIComponent(status)}`)}
                      style={{ background: '#fff', border: `1px solid ${color}44`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: C.muted, fontSize: 13 }}>{status}</span>
                      <span style={{ color, fontWeight: 800, fontSize: 18 }}>{count}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Rep table */}
          {repStats.length > 0 && (
            <>
              <SectionTitle>Rep Performance — {periodLabel}</SectionTitle>
              <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.surface }}>
                      {['Rep', 'Jobs', 'Revenue', 'Calls', 'Emails', 'Outreach'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '10px 16px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repStats.map((rep, i) => (
                      <tr key={rep.id} style={{ borderBottom: i < repStats.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: C.text }}>{rep.name}</td>
                        <td style={{ padding: '12px 16px', color: rep.jobs > 0 ? C.accent : C.dim, fontWeight: rep.jobs > 0 ? 700 : 400, fontSize: 15 }}>{rep.jobs}</td>
                        <td style={{ padding: '12px 16px', color: rep.revenue > 0 ? C.greenDark : C.dim, fontWeight: rep.revenue > 0 ? 600 : 400 }}>{fmt(rep.revenue)}</td>
                        <td style={{ padding: '12px 16px' }}><span style={{ background: rep.calls > 0 ? C.amberSoft : 'transparent', color: rep.calls > 0 ? C.amber : C.dim, borderRadius: 5, padding: '2px 8px', fontSize: 13, fontWeight: 600 }}>{rep.calls}</span></td>
                        <td style={{ padding: '12px 16px', color: rep.emails > 0 ? C.accent : C.dim }}>{rep.emails}</td>
                        <td style={{ padding: '12px 16px' }}><span style={{ background: rep.outreach > 0 ? C.purpleSoft : 'transparent', color: rep.outreach > 0 ? C.purple : C.dim, borderRadius: 5, padding: '2px 8px', fontSize: 13, fontWeight: 600 }}>{rep.outreach}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Renewals */}
          {renewalsDue.length > 0 && (
            <>
              <SectionTitle>
                Renewals Due Soon
                <button onClick={() => navigate('/leads?type=verified')} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>View all →</button>
              </SectionTitle>
              <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {renewalsDue.map((lead, i) => {
                  const days = lead.renewal_due_date ? Math.floor((new Date(lead.renewal_due_date) - new Date()) / 86400000) : null
                  const color = days < 0 ? C.red : days <= 14 ? C.amber : C.greenDark
                  const bg = days < 0 ? C.redSoft : days <= 14 ? C.amberSoft : C.greenSoft
                  return (
                    <div key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: i < renewalsDue.length - 1 ? `1px solid ${C.border}` : 'none', cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{lead.company_name || `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()}</div>
                        <div style={{ color: C.muted, fontSize: 12 }}>{lead.work_done} · Due {lead.renewal_due_date}</div>
                      </div>
                      <span style={{ background: bg, color, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                        {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Bottom grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 28 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Recent Jobs</div>
                <button onClick={() => navigate('/jobs')} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer' }}>View all →</button>
              </div>
              {recentJobs.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No jobs yet.</div>}
              {recentJobs.map(job => {
                const sc = JOB_STATUS_COLORS[job.status] || C.muted
                return (
                  <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{job.title}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{job.job_number} · {clientName(job.clients)}</div>
                    </div>
                    <span style={{ background: sc + '22', color: sc, border: `1px solid ${sc}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{job.status}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>Recent Activity</div>
              {recentActivity.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No activity yet.</div>}
              {recentActivity.map((a, i) => (
                <div key={a.id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 14 }}>{actIcon[a.type] || '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.content || a.type}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{a.rep_name} · {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Rep dashboard */}
          <SectionTitle>Your Stats — {periodLabel}</SectionTitle>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <StatCard label="Jobs Created"  value={data.periodJobs ?? '—'}     color={C.accent}    icon="🔧" />
            <StatCard label="Revenue"       value={fmt(data.periodRevenue)}    color={C.greenDark} icon="💷" />
            <StatCard label="Calls Logged"  value={data.calls ?? '—'}          color={C.amber}     icon="📞" />
            <StatCard label="Emails Sent"   value={data.emails ?? '—'}         color={'#0284C7'}   icon="✉️" />
            <StatCard label="Outreach"      value={data.outreach ?? '—'}       color={C.purple}    icon="📡" />
          </div>

          <SectionTitle>Your Job Pipeline</SectionTitle>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <StatCard label="Total Jobs"   value={data.totalJobs ?? '—'}   color={C.text}    onClick={() => navigate('/jobs')} />
            <StatCard label="In Progress"  value={data.inProgress ?? '—'}  color={C.amber}   onClick={() => navigate('/jobs?status=In Progress')} />
            <StatCard label="Scheduled"    value={data.scheduled ?? '—'}   color={'#0284C7'} onClick={() => navigate('/jobs?status=Scheduled')} />
          </div>

          <SectionTitle>Log Activity</SectionTitle>
          <LogActivityWidget profile={profile} onLogged={fetchAll} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>Your Recent Jobs</div>
              {recentJobs.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No jobs yet.</div>}
              {recentJobs.map(job => {
                const sc = JOB_STATUS_COLORS[job.status] || C.muted
                return (
                  <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{job.title}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{job.job_number}</div>
                    </div>
                    <span style={{ background: sc + '22', color: sc, border: `1px solid ${sc}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{job.status}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 16 }}>Your Activity Log</div>
              {recentActivity.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No activity logged yet.</div>}
              {recentActivity.map((a, i) => (
                <div key={a.id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 14 }}>{actIcon[a.type] || '📝'}</span>
                  <div>
                    <div style={{ fontSize: 13, color: C.text }}>{a.content || a.type}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
