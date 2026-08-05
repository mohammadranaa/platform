// Plain "YYYY-MM-DD" strings (Postgres `date` columns) must never pass
// through `new Date(str)` — that parses as UTC midnight, which shifts to
// the previous/next day once formatted in a non-UTC timezone (e.g. UK BST).

export function parseLocalDate(dateStr) {
  if (!dateStr) return null
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day) // local midnight, no UTC shift
}

export function toDateString(date) {
  if (!date) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
