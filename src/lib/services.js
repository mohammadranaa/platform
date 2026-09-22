// Canonical services list — single source of truth for Jobs, JobDetail, certificates, Properties page
// Format: { label, group, cert_type, expiry_years }
// cert_type is what gets inserted into the certificates table
// expiry_years is used to calculate expiry date

export const SERVICES = [
  // Electrical
  { label: 'EICR',                         group: 'Electrical', cert_type: 'EICR',                              expiry_years: 5  },
  { label: 'Commercial EICR',              group: 'Electrical', cert_type: 'Commercial EICR',                   expiry_years: 5  },
  { label: 'Consumer Unit Replacement',    group: 'Electrical', cert_type: null,                                expiry_years: null },
  { label: 'Electrical Diagnostics',       group: 'Electrical', cert_type: null,                                expiry_years: null },
  // Gas
  { label: 'GSC (CP12)',                   group: 'Gas',        cert_type: 'GSC (CP12)',                        expiry_years: 1  },
  { label: 'Commercial Gas (CP42)',        group: 'Gas',        cert_type: 'Commercial Gas (CP42)',             expiry_years: 1  },
  { label: 'Boiler Service',               group: 'Gas',        cert_type: null,                                expiry_years: null },
  // Energy
  { label: 'EPC',                          group: 'Energy',     cert_type: 'EPC',                               expiry_years: 10 },
  { label: 'Commercial EPC',               group: 'Energy',     cert_type: 'Commercial EPC',                    expiry_years: 10 },
  // Fire
  { label: 'Fire Risk Assessment (FRA)',   group: 'Fire',       cert_type: 'Fire Risk Assessment (FRA)',        expiry_years: 1  },
  { label: 'Fire Safety Certificate (FSC)',group: 'Fire',       cert_type: 'Fire Safety Certificate (FSC)',     expiry_years: 1  },
  { label: 'Fire Door Certificate',        group: 'Fire',       cert_type: 'Fire Door Certificate',             expiry_years: 1  },
  { label: 'Emergency Lights Certificate (ELC)', group: 'Fire', cert_type: 'Emergency Lights Certificate (ELC)', expiry_years: 1 },
  // Other compliance
  { label: 'PAT Testing',                  group: 'Other',      cert_type: 'PAT Testing',                       expiry_years: 1  },
  { label: 'Asbestos Survey',              group: 'Other',      cert_type: 'Asbestos Survey',                   expiry_years: 2  },
  { label: 'Legionella Risk Assessment',   group: 'Other',      cert_type: 'Legionella Risk Assessment',        expiry_years: 2  },
  // Remedial / Other
  { label: 'Remedial Works',              group: 'Remedial',   cert_type: null,                                expiry_years: null },
  { label: 'Other',                        group: 'Remedial',   cert_type: null,                                expiry_years: null },
]

export const SERVICE_LABELS = SERVICES.map(s => s.label)

export const SERVICE_GROUPS = ['Electrical', 'Gas', 'Energy', 'Fire', 'Other', 'Remedial']

export function getServiceMeta(label) {
  return SERVICES.find(s => s.label === label) || null
}

// Expiry years map for the certificate upload modal (keyed by cert_type)
export const CERT_EXPIRY_YEARS = Object.fromEntries(
  SERVICES.filter(s => s.cert_type && s.expiry_years)
    .map(s => [s.cert_type, s.expiry_years])
)
