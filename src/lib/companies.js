// ── Single source of truth for the two legal entities MLC trades as ──
// Every place that used to hardcode "My Landlord Certificate LTD" bank
// details (generatePdf.js, JobDetail.jsx, InvoiceDetail.jsx, QuoteDetail.jsx,
// DocumentGenerator.jsx) now imports from here instead. If a bank detail
// ever changes, it changes in exactly one place.
export const COMPANIES = {
  standard: {
    key: 'standard',
    name: 'My Landlord Certificate LTD',
    address: '134 Merton High Street, London, SW19 1BA',
    phone: '+44 020 3996 1070',
    email: 'info@mylandlordcertificate.co.uk',
    regNumber: '17265132',
    bankAccountName: 'My Landlord Certificate LTD',
    sortCode: '60-83-71',
    accountNumber: '83356126',
  },
  remedials: {
    key: 'remedials',
    name: 'My Landlord Certificate Remedials LTD',
    address: '134 Merton High Street, London, SW19 1BA',
    phone: '+44 020 3996 1070',
    email: 'info@mylandlordcertificate.co.uk',
    regNumber: '17289041',
    bankAccountName: 'My Landlord Certificate Remedials LTD',
    sortCode: '04-06-05',
    accountNumber: '32356220',
  },
}

export function getCompany(key) {
  return COMPANIES[key] || COMPANIES.standard
}

// Best-effort auto-detect: if any service/line-item text mentions
// "remedial", assume the Remedials LTD entity should be used. Callers
// should still let the user override this with a toggle -- this is a
// sensible default, not a guarantee.
export function detectCompanyKey({ serviceTypes, lineItems, title } = {}) {
  const haystack = [
    ...(Array.isArray(serviceTypes) ? serviceTypes : [serviceTypes]),
    ...(Array.isArray(lineItems) ? lineItems.map(l => l?.description) : []),
    title,
  ].filter(Boolean).join(' ').toLowerCase()

  return haystack.includes('remedial') ? 'remedials' : 'standard'
}
