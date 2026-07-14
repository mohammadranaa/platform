import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,    color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',      color: C.muted,     border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,   color: C.red,       border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft, color: C.greenDark, border: `1px solid ${C.green}66` },
    amber:   { background: C.amberSoft, color: C.amber,     border: `1px solid ${C.amber}66` },
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

const blank = {
  label: '', email: '', smtp_host: 'smtp.gmail.com', smtp_port: 587,
  smtp_user: '', smtp_pass: '',
  warmup_enabled: true, warmup_start_limit: 10,
  warmup_step: 5, warmup_interval_days: 3, warmup_max_limit: 50,
  is_active: true,
}

export default function Inboxes() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [inboxes, setInboxes]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(null) // inbox id being tested
  const [showAdd, setShowAdd]   = useState(false)
  const [editInbox, setEditInbox] = useState(null) // inbox being edited
  const [form, setForm]         = useState(blank)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { fetchInboxes() }, [])

  async function fetchInboxes() {
    setLoading(true)
    const { data } = await supabase.from('inboxes').select('*').order('created_at')
    setInboxes(data || [])
    setLoading(false)
  }

  async function saveInbox() {
    if (!form.email || !form.smtp_host || !form.smtp_user || !form.smtp_pass) {
      showToast('Please fill in all required fields', 'error'); return
    }
    setSaving(true)

    if (editInbox) {
      // Update existing
      const { error } = await supabase.from('inboxes').update({
        label:                form.label,
        smtp_host:            form.smtp_host,
        smtp_port:            Number(form.smtp_port),
        smtp_user:            form.smtp_user,
        smtp_pass:            form.smtp_pass,
        warmup_enabled:       form.warmup_enabled,
        warmup_start_limit:   Number(form.warmup_start_limit),
        warmup_step:          Number(form.warmup_step),
        warmup_interval_days: Number(form.warmup_interval_days),
        warmup_max_limit:     Number(form.warmup_max_limit),
      }).eq('id', editInbox.id)
      setSaving(false)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Inbox updated ✓')
    } else {
      // Create new
      const { error } = await supabase.from('inboxes').insert({
        ...form,
        owner_id:   profile.id,
        smtp_port:  Number(form.smtp_port),
        warmup_start_limit:   Number(form.warmup_start_limit),
        warmup_step:          Number(form.warmup_step),
        warmup_interval_days: Number(form.warmup_interval_days),
        warmup_max_limit:     Number(form.warmup_max_limit),
        sent_today: 0,
        last_reset_at: new Date().toISOString().slice(0, 10),
      })
      setSaving(false)
      if (error) { showToast(error.message, 'error'); return }
      showToast('Inbox added ✓')
    }

    await fetchInboxes()
    setShowAdd(false)
    setEditInbox(null)
    setForm(blank)
  }

  async function togglePause(inbox) {
    const newVal = !inbox.is_active
    await supabase.from('inboxes').update({ is_active: newVal }).eq('id', inbox.id)
    setInboxes(p => p.map(i => i.id === inbox.id ? { ...i, is_active: newVal } : i))
    showToast(newVal ? 'Inbox resumed' : 'Inbox paused')
  }

  async function removeInbox(inbox) {
    if (!window.confirm(`Remove "${inbox.label || inbox.email}"? This cannot be undone.`)) return
    await supabase.from('inboxes').delete().eq('id', inbox.id)
    setInboxes(p => p.filter(i => i.id !== inbox.id))
    showToast('Inbox removed')
  }

  // ── Test SMTP connection ──────────────────────────────────────
  // We can't test SMTP from the browser directly (no SMTP library in browser)
  // Instead verify credentials look correct and show guidance
  async function testConnection(inbox) {
    setTesting(inbox.id)
    // Simulate a check — verify format of credentials
    await new Promise(r => setTimeout(r, 1500))
    setTesting(null)

    const issues = []
    if (!inbox.smtp_pass || inbox.smtp_pass.length < 10) {
      issues.push('Password looks too short — Gmail app passwords are 16 characters')
    }
    if (inbox.smtp_host === 'smtp.gmail.com' && inbox.smtp_port !== 587) {
      issues.push('Gmail should use port 587')
    }
    if (!inbox.smtp_user.includes('@')) {
      issues.push('SMTP username should be a full email address')
    }
    if (inbox.smtp_pass === inbox.smtp_user) {
      issues.push('Password cannot be the same as the email address')
    }

    if (issues.length > 0) {
      showToast(`⚠ Check: ${issues[0]}`, 'error')
    } else {
      showToast(`✓ Credentials look correct for ${inbox.email}. First email send will confirm connection.`)
    }
  }

  function openEdit(inbox) {
    setForm({
      label:                inbox.label || '',
      email:                inbox.email || '',
      smtp_host:            inbox.smtp_host || 'smtp.gmail.com',
      smtp_port:            inbox.smtp_port || 587,
      smtp_user:            inbox.smtp_user || '',
      smtp_pass:            inbox.smtp_pass || '',
      warmup_enabled:       inbox.warmup_enabled ?? true,
      warmup_start_limit:   inbox.warmup_start_limit ?? 10,
      warmup_step:          inbox.warmup_step ?? 5,
      warmup_interval_days: inbox.warmup_interval_days ?? 3,
      warmup_max_limit:     inbox.warmup_max_limit ?? 50,
      is_active:            inbox.is_active ?? true,
    })
    setEditInbox(inbox)
    setShowAdd(true)
  }

  const warmupPct = inbox => Math.round(((inbox.warmup_start_limit || 10) / (inbox.warmup_max_limit || 50)) * 100)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>SMTP Inboxes</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{inboxes.length} inboxes · cold email senders</div>
        </div>
        <Btn onClick={() => { setForm(blank); setEditInbox(null); setShowAdd(true) }}>+ Add Inbox</Btn>
      </div>

      {/* Gmail reminder banner */}
      <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: C.text }}>
        <strong style={{ color: C.amber }}>Gmail users:</strong> You must use an <strong>App Password</strong>, not your normal password.
        Go to: Google Account → Security → 2-Step Verification → App Passwords → Select Mail → Copy the 16-character code.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: C.muted }}>Loading inboxes…</div>
      ) : inboxes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: C.muted }}>
          No inboxes yet. <button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Add one →</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {inboxes.map(inbox => {
            const pct = warmupPct(inbox)
            const isTesting = testing === inbox.id
            return (
              <div key={inbox.id} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{inbox.label || inbox.email}</div>
                    <div style={{ color: C.muted, fontSize: 13 }}>{inbox.email}</div>
                    <div style={{ color: C.dim, fontSize: 12 }}>{inbox.smtp_host}:{inbox.smtp_port}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ background: inbox.is_active ? C.greenSoft : C.surface, color: inbox.is_active ? C.greenDark : C.muted, border: `1px solid ${inbox.is_active ? C.green : C.border}44`, borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>
                      {inbox.is_active ? '● Active' : '○ Paused'}
                    </span>
                    <Btn small variant="ghost" onClick={() => testConnection(inbox)} disabled={isTesting}>
                      {isTesting ? 'Checking…' : '🔍 Test'}
                    </Btn>
                    <Btn small variant="ghost" onClick={() => openEdit(inbox)}>✏ Edit</Btn>
                    <Btn small variant="ghost" onClick={() => togglePause(inbox)}>
                      {inbox.is_active ? 'Pause' : 'Resume'}
                    </Btn>
                    <Btn small variant="danger" onClick={() => removeInbox(inbox)}>Remove</Btn>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                  {[
                    { label: 'Sent Today',     value: `${inbox.sent_today || 0} / ${inbox.warmup_start_limit || 10}`,  color: C.text },
                    { label: 'Daily Max',      value: `${inbox.warmup_max_limit || 50}/day`,    color: C.accent, sub: 'final target' },
                    { label: 'Current Limit',  value: `${inbox.warmup_start_limit || 10}/day`,  color: C.accent, sub: 'today' },
                    { label: 'Warm-up',        value: inbox.warmup_enabled ? 'Enabled' : 'Off', color: inbox.warmup_enabled ? C.greenDark : C.muted, sub: inbox.warmup_enabled ? `+${inbox.warmup_step} every ${inbox.warmup_interval_days}d` : 'manual' },
                  ].map(s => (
                    <div key={s.label} style={{ background: C.surface, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ color: C.muted, fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                      <div style={{ color: s.color, fontSize: 18, fontWeight: 700 }}>{s.value}</div>
                      {s.sub && <div style={{ color: C.dim, fontSize: 11, marginTop: 2 }}>{s.sub}</div>}
                    </div>
                  ))}
                </div>

                {/* Warmup progress bar */}
                {inbox.warmup_enabled && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: C.muted }}>
                      <span>Warm-up progress · increases by {inbox.warmup_step} every {inbox.warmup_interval_days} days</span>
                      <span style={{ color: C.accent, fontWeight: 600 }}>{inbox.warmup_start_limit} / {inbox.warmup_max_limit} emails/day</span>
                    </div>
                    <div style={{ background: C.surface, borderRadius: 20, height: 8, overflow: 'hidden' }}>
                      <div style={{ background: `linear-gradient(90deg, ${C.accent}, ${C.green})`, height: '100%', width: `${pct}%`, borderRadius: 20, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add / Edit Modal ──────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
          onClick={() => { setShowAdd(false); setEditInbox(null) }}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              {editInbox ? `Edit — ${editInbox.email}` : 'Add New Inbox'}
            </div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
              {editInbox ? 'Update inbox settings and warmup limits.' : 'Connect an email account for cold outreach.'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

              {/* SMTP settings */}
              <div style={{ gridColumn: 'span 2' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                  Account Details
                </div>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Display Label</label>
                <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Moiz — Cold Outreach" style={inp} />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Email Address *</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="moiz@trymylandlordcertificate.com"
                  style={{ ...inp, background: editInbox ? C.surface : '#fff' }}
                  readOnly={!!editInbox} />
                {editInbox && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>Email address cannot be changed</div>}
              </div>

              <div>
                <label style={lbl}>SMTP Host *</label>
                <input value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com" style={inp} />
              </div>
              <div>
                <label style={lbl}>SMTP Port *</label>
                <input type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} style={inp} />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>SMTP Username *</label>
                <input value={form.smtp_user} onChange={e => set('smtp_user', e.target.value)}
                  placeholder="Full email address used to log in" style={inp} />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>SMTP Password / App Password *</label>
                <input type="password" value={form.smtp_pass} onChange={e => set('smtp_pass', e.target.value)}
                  placeholder="Gmail: 16-character App Password" style={inp} />
                <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>
                  For Gmail: use App Password (16 chars), not your normal password
                </div>
              </div>

              {/* Warmup settings */}
              <div style={{ gridColumn: 'span 2', marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                  Warm-up Settings
                </div>
              </div>

              <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={form.warmup_enabled} onChange={e => set('warmup_enabled', e.target.checked)} id="wu" />
                <label htmlFor="wu" style={{ color: C.text, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
                  Enable automatic warm-up
                </label>
              </div>

              {form.warmup_enabled && <>
                <div>
                  <label style={lbl}>Current Daily Limit</label>
                  <input type="number" value={form.warmup_start_limit} onChange={e => set('warmup_start_limit', e.target.value)} min={1} max={500} style={inp} />
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>Emails sent per day right now</div>
                </div>
                <div>
                  <label style={lbl}>Maximum Daily Limit</label>
                  <input type="number" value={form.warmup_max_limit} onChange={e => set('warmup_max_limit', e.target.value)} min={1} max={500} style={inp} />
                  <div style={{ color: C.dim, fontSize: 11, marginTop: 3 }}>Target — warmup stops here</div>
                </div>
                <div>
                  <label style={lbl}>Increase By (emails)</label>
                  <input type="number" value={form.warmup_step} onChange={e => set('warmup_step', e.target.value)} min={1} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Every (days)</label>
                  <input type="number" value={form.warmup_interval_days} onChange={e => set('warmup_interval_days', e.target.value)} min={1} style={inp} />
                </div>
                <div style={{ gridColumn: 'span 2', background: C.accentSoft, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.accent }}>
                  📈 At current settings: starts at <strong>{form.warmup_start_limit}/day</strong>, increases by <strong>{form.warmup_step}</strong> every <strong>{form.warmup_interval_days} days</strong> until it reaches <strong>{form.warmup_max_limit}/day</strong>
                  {' '}— takes ~<strong>{Math.ceil(((form.warmup_max_limit - form.warmup_start_limit) / form.warmup_step) * form.warmup_interval_days)} days</strong> to fully warm up.
                </div>
              </>}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <Btn onClick={saveInbox} disabled={saving}>{saving ? 'Saving…' : editInbox ? 'Save Changes' : 'Add Inbox'}</Btn>
              <Btn variant="ghost" onClick={() => { setShowAdd(false); setEditInbox(null); setForm(blank) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
