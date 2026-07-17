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

const STATUS_COLORS = {
  'Quote':     { color: '#7C3AED', bg: '#EDE9FE', dot: '#7C3AED' },
  'Scheduled': { color: '#0284C7', bg: '#DBEAFE', dot: '#0284C7' },
  'Invoiced':  { color: '#D97706', bg: '#FEF3C7', dot: '#D97706' },
  'Paid':      { color: '#0093DB', bg: '#E6F4FC', dot: '#0093DB' },
  'Completed': { color: '#3d7a00', bg: '#F0FAE0', dot: '#3d7a00' },
  'Cancelled': { color: '#DC2626', bg: '#FEE2E2', dot: '#DC2626' },
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const HOURS = Array.from({ length: 11 }, (_, i) => i + 7) // 7am to 5pm

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate()
}

function formatDate(d) {
  return d.toISOString().slice(0, 10)
}

export default function CalendarView() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [view, setView]         = useState('week') // day | week | month
  const [current, setCurrent]   = useState(new Date())
  const [jobs, setJobs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState(null)
  const [filterEng, setFilterEng]    = useState('all')
  const [engineers, setEngineers]    = useState([])

  useEffect(() => { fetchJobs() }, [current, view, profile])
  useEffect(() => { fetchEngineers() }, [])

  async function fetchJobs() {
    setLoading(true)
    // Get date range based on view
    let from, to
    if (view === 'day') {
      from = formatDate(current)
      to   = formatDate(current)
    } else if (view === 'week') {
      const mon = getMonday(current)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      from = formatDate(mon)
      to   = formatDate(sun)
    } else {
      const first = new Date(current.getFullYear(), current.getMonth(), 1)
      const last  = new Date(current.getFullYear(), current.getMonth() + 1, 0)
      from = formatDate(first)
      to   = formatDate(last)
    }

    let q = supabase
      .from('jobs')
      .select('id, job_number, title, status, scheduled_date, scheduled_slot, site_address, assigned_to, service_types, clients(first_name, last_name, company_name), profiles(full_name)')
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .neq('status', 'Cancelled')
      .order('scheduled_date')

    if (!isAdmin) q = q.eq('assigned_to', profile.id)

    const { data } = await q
    setJobs(data || [])
    setLoading(false)
  }

  async function fetchEngineers() {
    const { data } = await supabase.from('profiles').select('id, full_name').eq('is_active', true)
    setEngineers(data || [])
  }

  // Navigation
  function prev() {
    const d = new Date(current)
    if (view === 'day')   d.setDate(d.getDate() - 1)
    if (view === 'week')  d.setDate(d.getDate() - 7)
    if (view === 'month') d.setMonth(d.getMonth() - 1)
    setCurrent(d)
  }
  function next() {
    const d = new Date(current)
    if (view === 'day')   d.setDate(d.getDate() + 1)
    if (view === 'week')  d.setDate(d.getDate() + 7)
    if (view === 'month') d.setMonth(d.getMonth() + 1)
    setCurrent(d)
  }
  function goToday() { setCurrent(new Date()) }

  // Filter
  const filteredJobs = filterEng === 'all' ? jobs : jobs.filter(j => j.assigned_to === filterEng)

  // Job helpers
  const jobsOnDate = date => filteredJobs.filter(j => j.scheduled_date === formatDate(date))
  const clientName = c => c?.company_name || `${c?.first_name || ''} ${c?.last_name || ''}`.trim() || '—'
  const slotHour = slot => slot?.toLowerCase().includes('morning') ? 8 : 12

  // Title
  const title = () => {
    if (view === 'day') return current.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (view === 'week') {
      const mon = getMonday(current)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      return `${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return `${MONTHS[current.getMonth()]} ${current.getFullYear()}`
  }

  // ── Job card (used in all views) ────────────────────────────
  const JobCard = ({ job, compact = false }) => {
    const sc = STATUS_COLORS[job.status] || { color: C.muted, bg: C.surface }
    return (
      <div
        onClick={e => { e.stopPropagation(); setSelected(job) }}
        style={{
          background: sc.bg,
          borderLeft: `3px solid ${sc.color}`,
          borderRadius: 6,
          padding: compact ? '3px 6px' : '6px 8px',
          marginBottom: 2,
          cursor: 'pointer',
          fontSize: compact ? 11 : 12,
          lineHeight: 1.4,
          overflow: 'hidden',
        }}>
        <div style={{ fontWeight: 700, color: sc.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.job_number}
        </div>
        {!compact && (
          <>
            <div style={{ color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {clientName(job.clients)}
            </div>
            <div style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.title}
            </div>
            {job.scheduled_slot && (
              <div style={{ color: sc.color, fontSize: 10, fontWeight: 600, marginTop: 2 }}>
                🕐 {job.scheduled_slot}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ── DAY VIEW ─────────────────────────────────────────────────
  const DayView = () => {
    const dayJobs = jobsOnDate(current)
    const morning = dayJobs.filter(j => j.scheduled_slot?.toLowerCase().includes('morning'))
    const afternoon = dayJobs.filter(j => j.scheduled_slot?.toLowerCase().includes('afternoon'))
    const unslotted = dayJobs.filter(j => !j.scheduled_slot)

    return (
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {/* Time slots */}
        {HOURS.map(hour => {
          const isAM = hour < 12
          const slotJobs = dayJobs.filter(j => {
            const h = slotHour(j.scheduled_slot)
            return isAM ? (h === 8 && hour >= 7 && hour < 12) ? hour === 8 : false
                        : (h === 12 && hour >= 12 && hour < 17) ? hour === 12 : false
          })
          const showJobs = (isAM && hour === 8) ? morning : (!isAM && hour === 12) ? afternoon : []

          return (
            <div key={hour} style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, minHeight: 64, background: [8,12].includes(hour) ? '#fff' : C.surface + '66' }}>
              <div style={{ width: 64, padding: '8px 12px', color: C.muted, fontSize: 12, fontWeight: 500, borderRight: `1px solid ${C.border}`, flexShrink: 0, paddingTop: 10 }}>
                {hour === 12 ? '12:00' : `${hour}:00`}
                <div style={{ fontSize: 10, color: C.dim }}>{hour < 12 ? 'AM' : 'PM'}</div>
              </div>
              <div style={{ flex: 1, padding: '6px 10px' }}>
                {showJobs.map(job => <JobCard key={job.id} job={job} />)}
                {hour === 7 && unslotted.length > 0 && (
                  <div style={{ fontSize: 11, color: C.amber, fontWeight: 600, marginBottom: 4 }}>⚠ {unslotted.length} job(s) with no time slot</div>
                )}
                {hour === 7 && unslotted.map(job => <JobCard key={job.id} job={job} />)}
              </div>
              {[8, 12].includes(hour) && (
                <div style={{ width: 80, background: hour === 8 ? C.accentSoft : C.amberSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: hour === 8 ? C.accent : C.amber, padding: '0 8px', textAlign: 'center', borderLeft: `1px solid ${C.border}` }}>
                  {hour === 8 ? 'MORNING\n8am–12pm' : 'AFTERNOON\n12pm–6pm'}
                </div>
              )}
            </div>
          )
        })}
        {dayJobs.length === 0 && (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>No jobs scheduled for this day.</div>
        )}
      </div>
    )
  }

  // ── WEEK VIEW ────────────────────────────────────────────────
  const WeekView = () => {
    const monday = getMonday(current)
    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
    const today = new Date()

    return (
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${C.border}` }}>
          {weekDays.map((day, i) => {
            const isToday = sameDay(day, today)
            const dayJobs = jobsOnDate(day)
            return (
              <div key={i} style={{
                padding: '10px 8px', textAlign: 'center',
                borderRight: i < 6 ? `1px solid ${C.border}` : 'none',
                background: isToday ? C.accentSoft : C.surface,
              }}>
                <div style={{ fontSize: 11, color: isToday ? C.accent : C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {DAYS[i]}
                </div>
                <div style={{
                  fontSize: 20, fontWeight: 800, marginTop: 2,
                  color: isToday ? '#fff' : C.text,
                  background: isToday ? C.accent : 'transparent',
                  borderRadius: '50%', width: 32, height: 32,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '4px auto 0',
                }}>
                  {day.getDate()}
                </div>
                {dayJobs.length > 0 && (
                  <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, marginTop: 4 }}>
                    {dayJobs.length} job{dayJobs.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Slot rows */}
        {['Morning (8am–12pm)', 'Afternoon (12pm–6pm)'].map(slot => (
          <div key={slot} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${C.border}` }}>
            {weekDays.map((day, i) => {
              const slotJobs = jobsOnDate(day).filter(j =>
                slot.toLowerCase().includes('morning')
                  ? j.scheduled_slot?.toLowerCase().includes('morning') || !j.scheduled_slot
                  : j.scheduled_slot?.toLowerCase().includes('afternoon')
              )
              const isToday = sameDay(day, today)
              return (
                <div key={i} style={{
                  minHeight: 100, padding: '6px 6px',
                  borderRight: i < 6 ? `1px solid ${C.border}` : 'none',
                  background: isToday ? '#FAFBFF' : '#fff',
                }}>
                  {i === 0 && (
                    <div style={{ fontSize: 10, color: slot.includes('Morning') ? C.accent : C.amber, fontWeight: 700, marginBottom: 4 }}>
                      {slot.includes('Morning') ? '☀ AM' : '🌤 PM'}
                    </div>
                  )}
                  {slotJobs.map(job => <JobCard key={job.id} job={job} compact />)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  // ── MONTH VIEW ───────────────────────────────────────────────
  const MonthView = () => {
    const year  = current.getFullYear()
    const month = current.getMonth()
    const first = new Date(year, month, 1)
    const last  = new Date(year, month + 1, 0)
    const today = new Date()

    // Pad to start on Monday
    const startPad = first.getDay() === 0 ? 6 : first.getDay() - 1
    const cells = []
    for (let i = 0; i < startPad; i++) {
      const d = new Date(first); d.setDate(d.getDate() - (startPad - i))
      cells.push({ date: d, thisMonth: false })
    }
    for (let d = 1; d <= last.getDate(); d++) {
      cells.push({ date: new Date(year, month, d), thisMonth: true })
    }
    // Pad end to complete grid
    while (cells.length % 7 !== 0) {
      const d = new Date(last); d.setDate(last.getDate() + (cells.length - last.getDate() - startPad + 1))
      cells.push({ date: d, thisMonth: false })
    }

    return (
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: '10px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
          ))}
        </div>

        {/* Weeks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {cells.map((cell, i) => {
            const dayJobs = jobsOnDate(cell.date)
            const isToday = sameDay(cell.date, today)
            const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6

            return (
              <div key={i} style={{
                minHeight: 100,
                padding: '4px 6px',
                borderRight: (i + 1) % 7 !== 0 ? `1px solid ${C.border}` : 'none',
                borderBottom: `1px solid ${C.border}`,
                background: !cell.thisMonth ? C.surface : isWeekend ? '#FAFBFF' : '#fff',
                opacity: cell.thisMonth ? 1 : 0.5,
              }}>
                <div style={{
                  fontSize: 13, fontWeight: isToday ? 800 : 400,
                  color: isToday ? '#fff' : cell.thisMonth ? C.text : C.dim,
                  background: isToday ? C.accent : 'transparent',
                  borderRadius: '50%', width: 24, height: 24,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 4,
                }}>
                  {cell.date.getDate()}
                </div>
                {dayJobs.slice(0, 3).map(job => <JobCard key={job.id} job={job} compact />)}
                {dayJobs.length > 3 && (
                  <div style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginTop: 2 }}>+{dayJobs.length - 3} more</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Job detail panel ─────────────────────────────────────────
  const JobPanel = ({ job }) => {
    if (!job) return null
    const sc = STATUS_COLORS[job.status] || { color: C.muted, bg: C.surface }
    return (
      <div style={{
        position: 'fixed', right: 0, top: 0, bottom: 0, width: 360,
        background: '#fff', borderLeft: `1px solid ${C.border}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
        zIndex: 300, display: 'flex', flexDirection: 'column',
        padding: 24, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.color}33`, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
            {job.status}
          </span>
          <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, marginBottom: 4 }}>{job.job_number}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>{job.title}</div>
        <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>{clientName(job.clients)}</div>

        {[
          { label: 'Date',       value: job.scheduled_date },
          { label: 'Time Slot',  value: job.scheduled_slot },
          { label: 'Address',    value: job.site_address },
          { label: 'Engineer',   value: job.profiles?.full_name },
          { label: 'Services',   value: (job.service_types || []).join(', ') },
        ].map(f => f.value && (
          <div key={f.label} style={{ padding: '8px 0', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 12 }}>
            <span style={{ color: C.muted, fontSize: 13, minWidth: 80, flexShrink: 0 }}>{f.label}</span>
            <span style={{ color: C.text, fontSize: 13 }}>{f.value}</span>
          </div>
        ))}

        <button
          onClick={() => navigate(`/jobs/${job.id}`)}
          style={{ marginTop: 24, background: C.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 14, cursor: 'pointer', width: '100%' }}>
          Open Full Job →
        </button>
      </div>
    )
  }

  return (
    <div style={{ paddingRight: selected ? 360 : 0, transition: 'padding-right 0.2s' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Job Calendar</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{filteredJobs.length} jobs scheduled</div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Engineer filter */}
          {isAdmin && (
            <select value={filterEng} onChange={e => setFilterEng(e.target.value)}
              style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '7px 12px', fontSize: 13 }}>
              <option value="all">All Engineers</option>
              {engineers.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          )}

          {/* View toggle */}
          <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 2 }}>
            {[['day','Day'],['week','Week'],['month','Month']].map(([v,l]) => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: view === v ? 700 : 400, background: view === v ? C.accent : 'transparent', color: view === v ? '#fff' : C.muted }}>
                {l}
              </button>
            ))}
          </div>

          {/* Navigation — shows the period you are viewing */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={prev} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16, color: C.text }}>‹</button>
            <span style={{ padding: '7px 14px', fontSize: 13, fontWeight: 700, color: C.accent, minWidth: 160, textAlign: 'center' }}>{title()}</span>
            <button onClick={next} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 16, color: C.text }}>›</button>
            <button onClick={goToday} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: C.muted, marginLeft: 6 }}>Go to today</button>
          </div>
        </div>
      </div>

      {/* Status legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([status, sc]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: sc.dot }} />
            {status}
          </div>
        ))}
      </div>

      {/* Calendar */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading calendar…</div>
      ) : view === 'day' ? (
        <DayView />
      ) : view === 'week' ? (
        <WeekView />
      ) : (
        <MonthView />
      )}

      {/* Job detail side panel */}
      {selected && <JobPanel job={selected} />}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setSelected(null)} />
      )}
    </div>
  )
}
