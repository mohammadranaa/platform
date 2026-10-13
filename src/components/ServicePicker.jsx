import { useState } from 'react'
import { SERVICES, SERVICE_GROUPS, SERVICE_LABELS } from '../lib/services.js'

const C = {
  accent: '#0093DB', accentSoft: '#E6F4FC',
  border: '#E5E7EB', muted: '#6B7280', surface: '#F5F7FA',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  text: '#1F2937',
}

const GROUP_COLOR = {
  Electrical: { active: '#EDE9FE', activeText: '#7C3AED', border: '#7C3AED' },
  Gas:        { active: '#FEF3C7', activeText: '#B45309', border: '#D97706' },
  Energy:     { active: '#DCFCE7', activeText: '#15803D', border: '#16A34A' },
  Fire:       { active: '#FEE2E2', activeText: '#DC2626', border: '#DC2626' },
  Other:      { active: '#E6F4FC', activeText: '#0093DB', border: '#0093DB' },
  Remedial:   { active: '#F3F4F6', activeText: '#6B7280', border: '#9CA3AF' },
}

// "Other": reps type the name of any service that isn't in the list (e.g. "Damp & Mould Survey").
// Typed services are saved on the job exactly as written and shown as removable chips.
function OtherServices({ selected, onChange, open, setOpen }) {
  const [name, setName] = useState('')
  const custom = selected.filter(s => !SERVICE_LABELS.includes(s))
  const add = () => {
    const v = name.trim().replace(/\s+/g, ' ')
    if (!v) return
    const exists = [...selected].some(s => s.toLowerCase() === v.toLowerCase())
    if (!exists) onChange([...selected.filter(s => s !== 'Other'), v])
    setName('')
  }
  return (
    <>
      {custom.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {custom.map(s => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#F3F4F6', color: '#374151', border: '1px solid #9CA3AF' }}>
              ✓ {s}
              <button type="button" onClick={() => onChange(selected.filter(x => x !== s))} title="Remove"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') setOpen(false) }}
            placeholder="Type the service name, e.g. Damp & Mould Survey"
            style={{ flex: 1, border: '1px solid #0093DB', borderRadius: 6, padding: '6px 10px', fontSize: 12 }} />
          <button type="button" onClick={add} disabled={!name.trim()}
            style={{ background: '#0093DB', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: name.trim() ? 1 : 0.5 }}>Add</button>
          <button type="button" onClick={() => setOpen(false)}
            style={{ background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Done</button>
        </div>
      )}
    </>
  )
}

export default function ServicePicker({ selected = [], onChange, compact = false }) {
  const [otherOpen, setOtherOpen] = useState(false)
  function toggle(label) {
    if (label === 'Other') { setOtherOpen(o => !o); if (!selected.includes('Other')) return }
    if (selected.includes(label)) {
      onChange(selected.filter(s => s !== label))
    } else {
      onChange([...selected, label])
    }
  }

  const groups = SERVICE_GROUPS.map(g => ({
    name: g,
    services: SERVICES.filter(s => s.group === g),
  }))

  if (compact) {
    // Compact mode: flat grid of toggle chips (for new job modal)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SERVICES.map(s => {
          const on = selected.includes(s.label) || (s.label === 'Other' && otherOpen)
          const gc = GROUP_COLOR[s.group] || GROUP_COLOR.Other
          return (
            <button key={s.label} type="button" onClick={() => toggle(s.label)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: on ? 700 : 400,
                background: on ? gc.active : '#fff',
                color: on ? gc.activeText : C.muted,
                border: `1px solid ${on ? gc.border : C.border}`,
                transition: 'all 0.12s',
              }}>
              {s.label === 'Other' ? 'Other (type name)…' : s.label}
            </button>
          )
        })}
      </div>
      <OtherServices selected={selected} onChange={onChange} open={otherOpen} setOpen={setOtherOpen} />
      </div>
    )
  }

  // Full mode: grouped sections (for JobDetail edit)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map(g => {
        const gc = GROUP_COLOR[g.name] || GROUP_COLOR.Other
        return (
          <div key={g.name}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
              {g.name}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {g.services.map(s => {
                const on = selected.includes(s.label) || (s.label === 'Other' && otherOpen)
                return (
                  <button key={s.label} type="button" onClick={() => toggle(s.label)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: on ? 700 : 400,
                      background: on ? gc.active : '#fff',
                      color: on ? gc.activeText : C.muted,
                      border: `1px solid ${on ? gc.border : C.border}`,
                      transition: 'all 0.12s',
                    }}>
                    {on && s.label !== 'Other' ? '✓ ' : ''}{s.label === 'Other' ? 'Other (type name)…' : s.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <OtherServices selected={selected} onChange={onChange} open={otherOpen} setOpen={setOtherOpen} />

      {/* Selected summary */}
      {selected.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
          <span style={{ color: C.muted, fontWeight: 600 }}>Selected: </span>
          <span style={{ color: C.text }}>{selected.join(' · ')}</span>
        </div>
      )}
    </div>
  )
}
