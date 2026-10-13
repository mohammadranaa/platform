import { useEffect, useState } from 'react'

// Standard appointment windows. Anything else is a custom window stored as
// e.g. "Custom (10:30am–12pm)". Older values ("Morning (8am–12pm)") still parse.
export const SLOT_MORNING   = 'Morning (8am–1pm)'
export const SLOT_AFTERNOON = 'Afternoon (1pm–6pm)'
export const SLOT_PRESETS   = [SLOT_MORNING, SLOT_AFTERNOON]

const pad = n => String(n).padStart(2, '0')

// "13:30" -> "1:30pm", "09:00" -> "9am"
export function fmt12(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`
}

// Parse any slot string into { start: 'HH:MM', end: 'HH:MM' } (24h). Returns null if unknown.
export function parseSlot(slot) {
  if (!slot) return null
  const s = String(slot).toLowerCase()
  const times = [...s.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g)]
    .filter(m => m[3] || m[2])                     // needs am/pm or minutes to be a time
    .map(m => {
      let h = Number(m[1]); const mi = Number(m[2] || 0)
      if (m[3] === 'pm' && h < 12) h += 12
      if (m[3] === 'am' && h === 12) h = 0
      return `${pad(h)}:${pad(mi)}`
    })
  if (times.length >= 2) return { start: times[0], end: times[1] }
  if (s.includes('morning'))   return { start: '08:00', end: '13:00' }
  if (s.includes('afternoon')) return { start: '13:00', end: '18:00' }
  return null
}

// true when the window starts before 1pm (used for calendar Morning/Afternoon rows)
export const isMorningSlot = slot => {
  const p = parseSlot(slot)
  return p ? p.start < '13:00' : false
}

export const customSlotLabel = (start, end) => `Custom (${fmt12(start)}–${fmt12(end)})`

// Drop-in replacement for the old Morning/Afternoon <select>.
// Reps pick a standard window or "Custom time…" and enter start/end times.
export function TimeSlotPicker({ value, onChange, style }) {
  const isCustom = v => !!v && String(v).startsWith('Custom (')
  const parsed = parseSlot(value)
  const [mode, setMode] = useState(isCustom(value) ? 'custom' : 'preset')
  const [start, setStart] = useState(parsed?.start || '09:00')
  const [end, setEnd] = useState(parsed?.end || '11:00')

  useEffect(() => {
    const p = parseSlot(value)
    if (isCustom(value)) { setMode('custom'); if (p) { setStart(p.start); setEnd(p.end) } }
    else if (value) setMode('preset')
  }, [value])

  const commit = (s, e) => { if (s && e && e > s) onChange(customSlotLabel(s, e)) }
  const legacy = value && !SLOT_PRESETS.includes(value) && !String(value).startsWith('Custom (')

  return (
    <div>
      <select style={style}
        value={mode === 'custom' ? '__custom' : (value || '')}
        onChange={e => {
          const v = e.target.value
          if (v === '__custom') { setMode('custom'); commit(start, end) }
          else { setMode('preset'); onChange(v) }
        }}>
        <option value="">—</option>
        {SLOT_PRESETS.map(s => <option key={s} value={s}>{s}</option>)}
        {legacy && <option value={value}>{value}</option>}
        <option value="__custom">Custom time…</option>
      </select>
      {mode === 'custom' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input type="time" value={start} step={900} style={{ ...style, width: 'auto', flex: 1 }}
            onChange={e => { setStart(e.target.value); commit(e.target.value, end) }} />
          <span style={{ color: '#6B7280', fontSize: 12 }}>to</span>
          <input type="time" value={end} step={900} style={{ ...style, width: 'auto', flex: 1 }}
            onChange={e => { setEnd(e.target.value); commit(start, e.target.value) }} />
        </div>
      )}
      {mode === 'custom' && end <= start && (
        <div style={{ color: '#DC2626', fontSize: 11, marginTop: 4 }}>End time must be after start time</div>
      )}
    </div>
  )
}
