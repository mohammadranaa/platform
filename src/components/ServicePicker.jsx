import { SERVICES, SERVICE_GROUPS } from '../lib/services.js'

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

export default function ServicePicker({ selected = [], onChange, compact = false }) {
  function toggle(label) {
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SERVICES.map(s => {
          const on = selected.includes(s.label)
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
              {s.label}
            </button>
          )
        })}
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
                const on = selected.includes(s.label)
                return (
                  <button key={s.label} type="button" onClick={() => toggle(s.label)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: on ? 700 : 400,
                      background: on ? gc.active : '#fff',
                      color: on ? gc.activeText : C.muted,
                      border: `1px solid ${on ? gc.border : C.border}`,
                      transition: 'all 0.12s',
                    }}>
                    {on ? '✓ ' : ''}{s.label}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

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
