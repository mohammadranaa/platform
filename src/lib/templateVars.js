// Shared template filling for every email the platform sends from a template.
//
// Templates are written by different people in different styles, so all of these
// are treated the same:  {Name}  {{name}}  {First Name}  {{first_name}}  {Company Name}
// {{company_name}}  {company}  …  (any brace count, any case, spaces or underscores).

// Different words people use for the same thing -> one canonical key
const ALIASES = {
  name: 'first_name', firstname: 'first_name', first_name: 'first_name', contact_name: 'first_name',
  lastname: 'last_name', last_name: 'last_name', surname: 'last_name',
  full_name: 'full_name', fullname: 'full_name',
  company: 'company_name', company_name: 'company_name', companyname: 'company_name', agency: 'company_name', agency_name: 'company_name',
  rep: 'rep_name', rep_name: 'rep_name', sender_name: 'rep_name', my_name: 'rep_name',
}
const canon = raw => {
  const k = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
  return ALIASES[k] || k
}

// What a placeholder becomes when the record doesn't have that detail, so the
// sentence still reads naturally ("Hi there,", "services for your team").
const FALLBACKS = { first_name: 'there', company_name: 'your team', full_name: 'there' }

const firstWord = s => (s || '').trim().split(/\s+/)[0] || ''
const tidyName = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s

// Pull first name / company etc. out of a lead row (handles inbound + cold agent shapes)
export function varsFromLead(lead = {}) {
  const company = lead.cold_company_name || lead.company_name || ''
  const contactFull = lead.cold_contact_name || [lead.contact_first, lead.contact_last].filter(Boolean).join(' ') || lead.inbound_name || ''
  // Some imported rows repeat the company in the contact field (e.g. "Re/max Central") -
  // that's not a person's name, so don't greet "Hi Re/max,".
  const isPerson = contactFull && contactFull.trim().toLowerCase() !== company.trim().toLowerCase()
  const first = lead.contact_first || (isPerson ? firstWord(contactFull) : '')
  return {
    first_name: tidyName(first),
    last_name: lead.contact_last || (isPerson ? contactFull.trim().split(/\s+/).slice(1).join(' ') : ''),
    full_name: isPerson ? contactFull.trim() : '',
    company_name: company,
  }
}

export function varsFromClient(client = {}) {
  return {
    first_name: tidyName(client.first_name || firstWord(client.billing_name)),
    last_name: client.last_name || '',
    full_name: [client.first_name, client.last_name].filter(Boolean).join(' ') || client.billing_name || '',
    company_name: client.company_name || '',
  }
}

// Fill every {placeholder} in `text`. `vars` keys can be in any style (they're canonicalised).
// Unknown placeholders are left in [BRACKETS] so the rep can see something needs filling.
export function fillTemplate(text, vars = {}, { removeUnknown = false } = {}) {
  if (!text) return text || ''
  const v = {}
  Object.entries(vars).forEach(([k, val]) => {
    if (val !== undefined && val !== null && val !== '') v[canon(k)] = String(val)
  })
  let out = text.replace(/\{+\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*\}+/g, (match, key) => {
    const k = canon(key)
    if (v[k]) return v[k]
    if (FALLBACKS[k]) return FALLBACKS[k]
    return removeUnknown ? '' : `[${k.toUpperCase().replace(/_/g, ' ')}]`
  })
  out = out.replace(/\bDear there\b/g, 'Dear Sir/Madam')
  const h = new Date().getHours()
  out = out.replace(/Good Morning\/Afternoon/g, h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening')
  return out
}
