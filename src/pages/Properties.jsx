const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  amber: '#D97706', amberSoft: '#FEF3C7',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

export default function Properties() {
  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Properties</h1>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>Property management — coming soon</div>
      </div>

      {/* Under construction notice */}
      <div style={{ background: C.amberSoft, border: `1px solid ${C.amber}44`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.amber, marginBottom: 8 }}>🚧 Under Development</div>
        <div style={{ color: C.text, fontSize: 14, lineHeight: 1.7 }}>
          This section is planned for a future update. It will allow you to manage individual properties linked to clients,
          track compliance status per property, and view all jobs associated with each address.
        </div>
      </div>

      {/* Planned features */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 16 }}>Planned Features</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { icon: '🏠', title: 'Property Profiles',      desc: 'Full address, type, bedrooms, access notes per property' },
            { icon: '🔗', title: 'Client Linking',          desc: 'Each property linked to a landlord or estate agent client' },
            { icon: '📋', title: 'Compliance Dashboard',    desc: 'EICR, GSC, EPC, FRA status and expiry per property' },
            { icon: '🔧', title: 'Linked Jobs',             desc: 'All past and upcoming jobs visible per property' },
            { icon: '📅', title: 'Renewal Tracking',        desc: 'Auto-alerts when certificates are due for renewal' },
            { icon: '📄', title: 'Document Storage',        desc: 'Certificates and photos stored against the property' },
            { icon: '🗺',  title: 'Map View',               desc: 'View all managed properties on a map' },
            { icon: '📊', title: 'Portfolio Reports',       desc: 'Compliance summary reports for landlords and agents' },
          ].map(f => (
            <div key={f.title} style={{ display: 'flex', gap: 12, padding: '12px 16px', background: C.surface, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{f.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: C.text, marginBottom: 3 }}>{f.title}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
