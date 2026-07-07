import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const SMTP_PRESETS = [
  { label: 'Gmail', host: 'smtp.gmail.com',        port: 587 },
  { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587 },
  { label: 'Yahoo', host: 'smtp.mail.yahoo.com',   port: 587 },
  { label: 'Custom / Other', host: '',             port: 587 },
]

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: '#0093DB', color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB' },
    danger:  { background: '#FEE2E2', color: '#DC2626', border: '1px solid #DC262644' },
    success: { background: '#F0FAE0', color: '#3d7a00', border: '1px solid #80D10066' },
    amber:   { background: '#FEF3C7', color: '#D97706', border: '1px solid #D9770666' },
    teal:    { background: '#CCFBF1', color: '#0D9488', border: '1px solid #0D948866' },
    purple:  { background: '#EDE9FE', color: '#7C3AED', border: '1px solid #7C3AED66' },
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

const Field = ({ label, value, onChange, type = 'text', placeholder, hint, password }) => {
  const [show, setShow] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>}
      {hint && <div style={{ color: C.dim, fontSize: 12 }}>{hint}</div>}
      <div style={{ position: 'relative' }}>
        <input
          type={password && !show ? 'password' : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: '100%', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: `9px ${password ? '40px' : '12px'} 9px 12px`, fontSize: 14 }}
        />
        {password && (
          <button type="button" onClick={() => setShow(p => !p)}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>
            {show ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  )
}

// Warm-up progress bar
function WarmupBar({ inbox }) {
  const daysSince = Math.floor((Date.now() - new Date(inbox.warmup_started_at).getTime()) / 86400000)
  const intervals = Math.floor(daysSince / (inbox.warmup_interval_days || 3))
  const current   = Math.min((inbox.warmup_start_limit || 10) + intervals * (inbox.warmup_step || 5), inbox.warmup_max_limit || 50)
  const pct       = Math.round(current / (inbox.warmup_max_limit || 50) * 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: C.muted }}>Warm-up progress</span>
        <span style={{ color: C.amber, fontWeight: 600 }}>{current} / {inbox.warmup_max_limit} emails/day</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 6, height: 6 }}>
        <div style={{ width: pct + '%', background: C.amber, borderRadius: 6, height: '100%', transition: 'width .3s' }} />
      </div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
        {pct < 100 ? `Increases by ${inbox.warmup_step} every ${inbox.warmup_interval_days} days` : 'At maximum limit'}
      </div>
    </div>
  )
}

export default function Inboxes() {
  const { profile } = useAuth()
  const { toast, showToast } = useToast()

  const [inboxes, setInboxes]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showAdd, setShowAdd]   = useState(false)

  const blank = {
    label: '', email: '', smtp_host: 'smtp.gmail.com', smtp_port: '587',
    smtp_user: '', smtp_pass: '',
    warmup_enabled: true, warmup_start_limit: '10', warmup_step: '5',
    warmup_interval_days: '3', warmup_max_limit: '50',
  }
  const [form, setForm] = useState(blank)
  const [preset, setPreset] = useState(0)

  useEffect(() => { fetchInboxes() }, [])

  async function fetchInboxes() {
    setLoading(true)
    const { data } = await supabase.from('inboxes').select('*').order('created_at', { ascending: false })
    setInboxes(data || [])
    setLoading(false)
  }

  async function createInbox() {
    if (!form.email || !form.smtp_host || !form.smtp_user || !form.smtp_pass) {
      showToast('Email, SMTP host, username and password are required', 'error')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('inboxes').insert({
      ...form,
      smtp_port: Number(form.smtp_port),
      warmup_start_limit: Number(form.warmup_start_limit),
      warmup_step: Number(form.warmup_step),
      warmup_interval_days: Number(form.warmup_interval_days),
      warmup_max_limit: Number(form.warmup_max_limit),
      owner_id: profile.id,
      label: form.label || form.email,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchInboxes()
    setShowAdd(false)
    setForm(blank)
    showToast('Inbox connected ✓')
  }

  async function toggleInbox(id, is_active) {
    await supabase.from('inboxes').update({ is_active: !is_active }).eq('id', id)
    setInboxes(p => p.map(i => i.id === id ? { ...i, is_active: !is_active } : i))
    showToast(is_active ? 'Inbox paused' : 'Inbox activated')
  }

  async function deleteInbox(id) {
    if (!window.confirm('Remove this inbox?')) return
    await supabase.from('inboxes').delete().eq('id', id)
    setInboxes(p => p.filter(i => i.id !== id))
    showToast('Inbox removed')
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const applyPreset = (i) => {
    const p = SMTP_PRESETS[i]
    setPreset(i)
    setForm(prev => ({ ...prev, smtp_host: p.host, smtp_port: String(p.port) }))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sending Inboxes</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
            {inboxes.filter(i => i.is_active).length} active · {inboxes.length} total
          </div>
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Connect Inbox</Btn>
      </div>

      {/* Info banner */}
      <div style={{ background: '#FEF3C7', border: '1px solid #D9770644', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: C.amber, lineHeight: 1.7 }}>
        <strong>Gmail users:</strong> You must use an <strong>App Password</strong>, not your normal password.
        Go to: Google Account → Security → 2-Step Verification → App Passwords → Select Mail → Copy the 16-character code.
      </div>

      {loading ? (
        <div style={{ color: C.muted, textAlign: 'center', padding: 48 }}>Loading inboxes…</div>
      ) : inboxes.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No inboxes connected</div>
          <div style={{ color: C.muted, fontSize: 14, marginBottom: 20 }}>Connect your 5 sending email accounts to start warm-up and enable campaigns.</div>
          <Btn onClick={() => setShowAdd(true)}>Connect First Inbox</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {inboxes.map(inbox => {
            const daysSince = Math.floor((Date.now() - new Date(inbox.warmup_started_at).getTime()) / 86400000)
            const intervals = Math.floor(daysSince / (inbox.warmup_interval_days || 3))
            const todayLimit = Math.min((inbox.warmup_start_limit || 10) + intervals * (inbox.warmup_step || 5), inbox.warmup_max_limit || 50)

            return (
              <div key={inbox.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {/* Inbox header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{inbox.label}</div>
                    <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>{inbox.email}</div>
                    <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>{inbox.smtp_host}:{inbox.smtp_port}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      background: inbox.is_active ? C.greenSoft : C.redSoft,
                      color: inbox.is_active ? C.green : C.red,
                      border: `1px solid ${inbox.is_active ? C.green : C.red}44`,
                      borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600,
                    }}>
                      {inbox.is_active ? '● Active' : '● Paused'}
                    </span>
                    <Btn small variant="ghost" onClick={() => toggleInbox(inbox.id, inbox.is_active)}>
                      {inbox.is_active ? 'Pause' : 'Activate'}
                    </Btn>
                    <Btn small variant="danger" onClick={() => deleteInbox(inbox.id)}>Remove</Btn>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Sent Today',   value: inbox.sent_today,                     sub: `/ ${todayLimit} limit`, color: C.text },
                    { label: 'Daily Max',    value: inbox.warmup_max_limit + '/day',       sub: 'final target',          color: C.accent },
                    { label: 'Current Limit', value: todayLimit + '/day',                  sub: 'today',                 color: C.amber },
                    { label: 'Warm-up',      value: inbox.warmup_enabled ? 'Enabled' : 'Off', sub: inbox.warmup_enabled ? `+${inbox.warmup_step} every ${inbox.warmup_interval_days}d` : 'manual', color: inbox.warmup_enabled ? C.amber : C.dim },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#F5F7FA', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ color: C.muted, fontSize: 11, marginBottom: 4 }}>{s.label}</div>
                      <div style={{ color: s.color, fontWeight: 700, fontSize: 18 }}>{s.value}</div>
                      <div style={{ color: C.dim, fontSize: 11 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Warm-up progress */}
                {inbox.warmup_enabled && <WarmupBar inbox={inbox} />}
              </div>
            )
          })}
        </div>
      )}

      {/* Add Inbox Modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: 600, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>Connect Inbox</div>

            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {SMTP_PRESETS.map((p, i) => (
                <button key={p.label} onClick={() => applyPreset(i)}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${preset === i ? C.accent : C.border}`, background: preset === i ? C.accentSoft : 'transparent', color: preset === i ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontWeight: preset === i ? 700 : 400 }}>
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Label (display name)" value={form.label} onChange={v => set('label', v)} placeholder="outreach-01@mlcservices.co.uk" />
              <Field label="Email Address" value={form.email} onChange={v => set('email', v)} placeholder="outreach-01@mlcservices.co.uk" type="email" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SMTP Host</label>
                <input value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.gmail.com"
                  style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ color: C.muted, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SMTP Port</label>
                <select value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)}
                  style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14 }}>
                  <option value="587">587 — TLS (recommended)</option>
                  <option value="465">465 — SSL</option>
                  <option value="25">25</option>
                </select>
              </div>
              <Field label="SMTP Username" value={form.smtp_user} onChange={v => set('smtp_user', v)} placeholder="outreach-01@mlcservices.co.uk" />
              <Field label="Password / App Password" value={form.smtp_pass} onChange={v => set('smtp_pass', v)} placeholder="••••••••••••••••" password />
            </div>

            {/* Warm-up settings */}
            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 20, marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Warm-up Settings</div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, color: C.muted }}>
                  <input type="checkbox" checked={form.warmup_enabled} onChange={e => set('warmup_enabled', e.target.checked)} />
                  Enable warm-up
                </label>
              </div>
              {form.warmup_enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Start Limit (emails/day)" value={form.warmup_start_limit} onChange={v => set('warmup_start_limit', v)} type="number" hint="How many to send on day 1" />
                  <Field label="Increase By" value={form.warmup_step} onChange={v => set('warmup_step', v)} type="number" hint="Add this many each interval" />
                  <Field label="Increase Every (days)" value={form.warmup_interval_days} onChange={v => set('warmup_interval_days', v)} type="number" />
                  <Field label="Maximum Limit (emails/day)" value={form.warmup_max_limit} onChange={v => set('warmup_max_limit', v)} type="number" hint="Never exceed this" />
                </div>
              )}
              {!form.warmup_enabled && (
                <div style={{ background: '#F5F7FA', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: C.muted }}>
                  Warm-up disabled. The inbox will send up to{' '}
                  <strong style={{ color: C.text }}>{form.warmup_max_limit || 50} emails/day</strong> immediately.
                  Only disable this for already-warmed inboxes.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <Btn onClick={createInbox} disabled={saving}>{saving ? 'Connecting…' : 'Connect Inbox'}</Btn>
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
