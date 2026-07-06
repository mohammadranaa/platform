import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

const C = {
  bg: '#FFFFFF', surface: '#F5F5F5', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#003d5c',
  green: '#80D100', greenSoft: '#3a5c00',
  amber: '#F59E0B', amberSoft: '#451A03',
  red: '#EF4444', redSoft: '#450A0A',
  purple: '#A855F7', purpleSoft: '#2E1065',
  teal: '#2DD4BF', tealSoft: '#0D3330',
  text: '#1F2937', muted: '#6B7280', dim: '#6B7280',
}

const JOB_STATUS_COLORS = {
  'Quote':       C.purple,
  'Scheduled':   '#38BDF8',
  'In Progress': C.amber,
  'Completed':   C.teal,
  'Invoiced':    C.accent,
  'Paid':        C.green,
  'Cancelled':   C.red,
}

function StatCard({ label, value, sub, color = C.accent, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '20px 24px',
        flex: 1,
        minWidth: 140,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ color, fontSize: 28, fontWeight: 700, marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ color: C.dim, fontSize: 12 }}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.muted,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 12, marginTop: 28,
    }}>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [stats, setStats]         = useState(null)
  const [recentJobs, setRecentJobs] = useState([])
  const [recentClients, setRecentClients] = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => { fetchAll() }, [profile])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([
      fetchStats(),
      fetchRecentJobs(),
      fetchRecentClients(),
      fetchRecentActivity(),
    ])
    setLoading(false)
  }

  async function fetchStats() {
    // Client counts by type
    const { data: clients } = await supabase
      .from('clients')
      .select('customer_type, status, total_revenue')

    // Job counts by status
    let jobQuery = supabase.from('jobs').select('status, invoice_amount, payment_amount, payment_status')
    if (!isAdmin) jobQuery = jobQuery.eq('assigned_to', profile.id)
    const { data: jobs } = await jobQuery

    if (!clients || !jobs) return

    const inbound  = clients.filter(c => c.customer_type === 'inbound')
    const verified = clients.filter(c => c.customer_type === 'verified')
    const cold     = clients.filter(c => c.customer_type === 'cold_agent')

    const activeJobs    = jobs.filter(j => !['Paid','Cancelled'].includes(j.status))
    const invoicedJobs  = jobs.filter(j => j.status === 'Invoiced')
    const paidJobs      = jobs.filter(j => j.status === 'Paid')

    setStats({
      // Clients
      totalClients:    clients.length,
      inboundCount:    inbound.length,
      verifiedCount:   verified.length,
      coldCount:       cold.length,
      // Jobs
      activeJobs:      activeJobs.length,
      scheduledToday:  jobs.filter(j => j.status === 'Scheduled').length,
      awaitingInvoice: jobs.filter(j => j.status === 'Completed').length,
      invoicedValue:   invoicedJobs.reduce((s, j) => s + (j.invoice_amount || 0), 0),
      revenueCollected: paidJobs.reduce((s, j) => s + (j.payment_amount || 0), 0),
      // Job breakdown
      jobsByStatus: jobs.reduce((acc, j) => {
        acc[j.status] = (acc[j.status] || 0) + 1
        return acc
      }, {}),
    })
  }

  async function fetchRecentJobs() {
    let q = supabase
      .from('jobs')
      .select('id, job_number, title, status, scheduled_date, client_id, clients(first_name, last_name, company_name)')
      .order('created_at', { ascending: false })
      .limit(6)
    if (!isAdmin) q = q.eq('assigned_to', profile.id)
    const { data } = await q
    setRecentJobs(data || [])
  }

  async function fetchRecentClients() {
    let q = supabase
      .from('clients')
      .select('id, customer_type, first_name, last_name, company_name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    if (!isAdmin) q = q.eq('assigned_to', profile.id)
    const { data } = await q
    setRecentClients(data || [])
  }

  async function fetchRecentActivity() {
    const { data } = await supabase
      .from('client_activities')
      .select('id, type, content, created_at, rep_name, clients(first_name, last_name, company_name)')
      .order('created_at', { ascending: false })
      .limit(8)
    setRecentActivity(data || [])
  }

  const fmt = v => '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || 'Unknown'

  const typeLabel = { inbound: 'Inbound', verified: 'Verified', cold_agent: 'Cold Agent' }
  const typeColor = { inbound: C.green, verified: C.accent, cold_agent: C.amber }

  const statusColor = s => JOB_STATUS_COLORS[s] || C.muted

  const actIcon = { note: '📝', call: '📞', email: '✉️', whatsapp: '💬', meeting: '🤝', status_change: '🔄', job_created: '🔧', invoice_sent: '🧾', payment_received: '💰' }

  if (loading) {
    return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading dashboard…</div>
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {profile?.full_name?.split(' ')[0] || 'there'} 👋
        </h1>
        <div style={{ color: C.muted, fontSize: 14 }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* ── Job KPIs ────────────────────────────────────────── */}
      <SectionTitle>Jobs Overview</SectionTitle>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
        <StatCard label="Active Jobs"        value={stats?.activeJobs ?? '—'}     sub="in progress / scheduled"  color={C.accent} onClick={() => navigate('/jobs')} />
        <StatCard label="Scheduled Today"    value={stats?.scheduledToday ?? '—'} sub="awaiting engineer"        color={'#38BDF8'} onClick={() => navigate('/jobs')} />
        <StatCard label="Awaiting Invoice"   value={stats?.awaitingInvoice ?? '—'} sub="completed, not invoiced" color={C.amber} onClick={() => navigate('/jobs')} />
        <StatCard label="Invoiced"           value={fmt(stats?.invoicedValue)}     sub="outstanding"              color={C.purple} />
        <StatCard label="Revenue Collected"  value={fmt(stats?.revenueCollected)}  sub="paid jobs"                color={C.green} />
      </div>

      {/* ── Client KPIs (admin only) ─────────────────────────── */}
      {isAdmin && (
        <>
          <SectionTitle>Client Pipeline</SectionTitle>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <StatCard label="Total Clients"   value={stats?.totalClients ?? '—'}  sub="all types"          color={C.text}   onClick={() => navigate('/clients')} />
            <StatCard label="Inbound Leads"   value={stats?.inboundCount ?? '—'}  sub="from booking form"  color={C.green}  onClick={() => navigate('/clients?type=inbound')} />
            <StatCard label="Verified Clients" value={stats?.verifiedCount ?? '—'} sub="past job history"  color={C.accent} onClick={() => navigate('/clients?type=verified')} />
            <StatCard label="Cold Agents"     value={stats?.coldCount ?? '—'}     sub="estate agent leads"  color={C.amber}  onClick={() => navigate('/clients?type=cold_agent')} />
          </div>
        </>
      )}

      {/* ── Job status breakdown ──────────────────────────────── */}
      {stats?.jobsByStatus && Object.keys(stats.jobsByStatus).length > 0 && (
        <>
          <SectionTitle>Jobs by Status</SectionTitle>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(stats.jobsByStatus).map(([status, count]) => (
              <div
                key={status}
                onClick={() => navigate(`/jobs?status=${status}`)}
                style={{
                  background: C.surface,
                  border: `1px solid ${statusColor(status)}44`,
                  borderRadius: 10,
                  padding: '10px 18px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: statusColor(status), flexShrink: 0,
                }} />
                <span style={{ color: C.muted, fontSize: 13 }}>{status}</span>
                <span style={{ color: statusColor(status), fontWeight: 700, fontSize: 16 }}>{count}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 28 }}>

        {/* ── Recent Jobs ───────────────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Recent Jobs</div>
            <button onClick={() => navigate('/jobs')} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer' }}>View all →</button>
          </div>
          {recentJobs.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No jobs yet.</div>}
          {recentJobs.map(job => (
            <div
              key={job.id}
              onClick={() => navigate(`/jobs/${job.id}`)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderBottom: `1px solid ${C.border}20`, cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{job.title}</div>
                <div style={{ fontSize: 12, color: C.dim }}>
                  {job.job_number} · {clientName(job.clients)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{
                  background: statusColor(job.status) + '22',
                  color: statusColor(job.status),
                  border: `1px solid ${statusColor(job.status)}44`,
                  borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600,
                }}>
                  {job.status}
                </span>
                {job.scheduled_date && (
                  <span style={{ color: C.dim, fontSize: 11 }}>📅 {job.scheduled_date}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Recent Activity ───────────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Recent Activity</div>
          {recentActivity.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>No activity yet.</div>}
          {recentActivity.map(a => (
            <div key={a.id} style={{
              display: 'flex', gap: 10, padding: '8px 0',
              borderBottom: `1px solid ${C.border}20`, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{actIcon[a.type] || '📝'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text }} className="truncate">
                  {clientName(a.clients)}
                </div>
                <div style={{ fontSize: 12, color: C.muted }} className="truncate">{a.content}</div>
              </div>
              <div style={{ color: C.dim, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── New clients ───────────────────────────────────────── */}
      <SectionTitle>Newly Added Clients</SectionTitle>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {recentClients.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>No clients yet.</div>
        )}
        {recentClients.map((c, i) => (
          <div
            key={c.id}
            onClick={() => navigate(`/clients/${c.id}`)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 20px',
              borderBottom: i < recentClients.length - 1 ? `1px solid ${C.border}20` : 'none',
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{clientName(c)}</div>
              <div style={{ fontSize: 12, color: C.dim }}>
                Added {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                background: typeColor[c.customer_type] + '22',
                color: typeColor[c.customer_type],
                border: `1px solid ${typeColor[c.customer_type]}44`,
                borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600,
              }}>
                {typeLabel[c.customer_type]}
              </span>
              <span style={{
                background: C.bg,
                color: C.muted,
                border: `1px solid ${C.border}`,
                borderRadius: 6, padding: '2px 8px', fontSize: 11,
              }}>
                {c.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
