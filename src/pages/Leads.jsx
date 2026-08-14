import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import { fixUrl } from '../lib/url'

const C = {
  bg: '#FFFFFF', surface: '#F5F7FA', border: '#E5E7EB',
  accent: '#0093DB', accentSoft: '#E6F4FC',
  green: '#80D100', greenSoft: '#F0FAE0', greenDark: '#3d7a00',
  amber: '#D97706', amberSoft: '#FEF3C7',
  red: '#DC2626', redSoft: '#FEE2E2',
  purple: '#7C3AED', purpleSoft: '#EDE9FE',
  teal: '#0D9488', tealSoft: '#CCFBF1',
  text: '#1F2937', muted: '#6B7280', dim: '#9CA3AF',
}

const LEAD_STATUSES = ['New','Contacted','In Discussion','Declined','Accepted']

const TYPE_META = {
  inbound:    { label: 'Inbound',        color: C.accent,  bg: C.accentSoft },
  verified:   { label: 'Verified',       color: C.purple,  bg: C.purpleSoft },
  cold_agent: { label: 'Estate Agents',  color: C.amber,   bg: C.amberSoft  },
}

const RENEWAL_YEARS = { 'FRA': 1, 'GSC': 1, 'CP12': 1, 'Gas Safety': 1, 'PAT': 1, 'FSC': 1, 'EICR': 5, 'EPC': 10 }

function calcRenewal(workDone, jobDate) {
  if (!workDone || !jobDate) return null
  let earliest = null
  Object.entries(RENEWAL_YEARS).forEach(([svc, years]) => {
    if (workDone.toLowerCase().includes(svc.toLowerCase())) {
      const d = new Date(jobDate)
      d.setFullYear(d.getFullYear() + years)
      if (!earliest || d < earliest) earliest = d
    }
  })
  return earliest ? earliest.toISOString().slice(0, 10) : null
}

// Parse services string from inbound form e.g. "EICR Certificate — 1–3 Bedrooms (£94.99), Gas Safety..."
function parseServices(servicesStr) {
  if (!servicesStr) return []
  return servicesStr.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const priceMatch = s.match(/\(£([\d.]+)\)/)
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0
    const name = s.replace(/\s*\(£[\d.]+\)/, '').trim()
    return { name, price }
  })
}

const Btn = ({ children, onClick, variant = 'primary', small, disabled, style: sx = {} }) => {
  const v = {
    primary: { background: C.accent,     color: '#fff',      border: 'none' },
    ghost:   { background: '#fff',       color: C.muted,     border: `1px solid ${C.border}` },
    danger:  { background: C.redSoft,    color: C.red,       border: `1px solid ${C.red}44` },
    success: { background: C.greenSoft,  color: C.greenDark, border: `1px solid ${C.green}66` },
    purple:  { background: C.purpleSoft, color: C.purple,    border: `1px solid ${C.purple}44` },
    amber:   { background: C.amberSoft,  color: C.amber,     border: `1px solid ${C.amber}66` },
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

const TypeChip = ({ type }) => {
  const m = TYPE_META[type] || { label: type, color: C.muted, bg: C.surface }
  return <span style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}44`, borderRadius: 6, padding: '2px 9px', fontSize: 11, fontWeight: 700 }}>{m.label}</span>
}

const inp = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 12px', fontSize: 14, width: '100%' }
const lbl = { color: C.muted, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 5 }

const TABS = [
  { key: 'all', label: 'All Leads' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'cold_agent', label: 'Estate Agents' },
]

export default function Leads() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast, showToast } = useToast()
  const fileRef = useRef()

  const [leads, setLeads]         = useState([])
  const [profiles, setProfiles]   = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [tabCounts, setTabCounts] = useState({ all: 0, inbound: 0, verified: 0, cold_agent: 0 })
  const [page, setPage]           = useState(Number(searchParams.get('page')) || 0)
  const PAGE_SIZE = 100
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [tab, setTab]             = useState(searchParams.get('type') || 'all')
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')
  const [search, setSearch]       = useState(searchParams.get('q') || '')
  const searchTimer = useRef(null)
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'All')
  const [renewalFilter, setRenewalFilter] = useState(searchParams.get('renewal') || 'All')
  const [sortField, setSortField]       = useState(searchParams.get('sort') || 'created_at')
  const [sortDir, setSortDir]           = useState(searchParams.get('dir') || 'desc')
  const [filterVerified, setFilterVerified] = useState(searchParams.get('verified') || 'All')
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [bulkAssignTo, setBulkAssignTo] = useState('')
  const [showBulkBar, setShowBulkBar]   = useState(false)
  const [editingField, setEditingField] = useState(null) // { id, field }
  const [editingValue, setEditingValue] = useState('')
  const [selected, setSelected]   = useState(null) // lead detail panel
  const [showAdd, setShowAdd]     = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importType, setImportType] = useState('inbound')
  const [csvText, setCsvText]     = useState('')
  const [csvPreview, setCsvPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [addType, setAddType]     = useState('inbound')
  const [form, setForm]           = useState({ status: 'New', email_verified: 'Unknown' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      // First render: respect whatever page came from the URL (e.g. the
      // user hit "back" after paging through the list) instead of forcing
      // page 0.
      didMountRef.current = true
      fetchLeads(page)
      return
    }
    setPage(0)
    fetchLeads(0) // explicit 0, not the (still-stale) `page` state
  }, [tab, profile, filterStatus, search, renewalFilter, sortField, sortDir, filterVerified])

  useEffect(() => {
    const params = {}
    if (tab !== 'all') params.type = tab
    if (search) params.q = search
    if (filterStatus !== 'All') params.status = filterStatus
    if (renewalFilter !== 'All') params.renewal = renewalFilter
    if (filterVerified !== 'All') params.verified = filterVerified
    if (sortField !== 'created_at') params.sort = sortField
    if (sortDir !== 'desc') params.dir = sortDir
    if (page > 0) params.page = String(page)
    setSearchParams(params, { replace: true })
  }, [tab, search, filterStatus, renewalFilter, filterVerified, sortField, sortDir, page])

  async function fetchLeads(p = page) {
    setLoading(true)
    const from = p * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    // Build query with server-side filters
    let q = supabase.from('leads').select('*', { count: 'exact' })
      .order(sortField || 'created_at', { ascending: sortDir === 'asc' })
      .range(from, to)

    if (tab !== 'all') q = q.eq('lead_type', tab)
    if (filterStatus !== 'All') q = q.eq('status', filterStatus)
    if (filterVerified !== 'All') q = q.eq('email_verified', filterVerified)

    // Server-side search — search across key fields
    if (search.trim()) {
      const s = '%' + search.trim() + '%'
      q = q.or('inbound_name.ilike.' + s + ',inbound_email.ilike.' + s + ',company_name.ilike.' + s + ',cold_company_name.ilike.' + s + ',cold_contact_name.ilike.' + s + ',cold_email.ilike.' + s + ',email_address.ilike.' + s)
    }

    // Renewal filter
    if (renewalFilter !== 'All') {
      const today = new Date().toISOString().slice(0, 10)
      if (renewalFilter === '0') {
        q = q.lt('renewal_due_date', today)
      } else {
        const future = new Date()
        future.setDate(future.getDate() + parseInt(renewalFilter))
        q = q.lte('renewal_due_date', future.toISOString().slice(0, 10))
      }
    }

    const [leadsRes, profilesRes, countsRes] = await Promise.all([
      q,
      supabase.from('profiles').select('id, full_name').eq('is_active', true),
      // Get counts per type (one lightweight query)
      supabase.from('leads').select('lead_type', { count: 'exact', head: false })
        .then(async () => {
          const [a, b, c, d] = await Promise.all([
            supabase.from('leads').select('id', { count: 'exact', head: true }),
            supabase.from('leads').select('id', { count: 'exact', head: true }).eq('lead_type', 'inbound'),
            supabase.from('leads').select('id', { count: 'exact', head: true }).eq('lead_type', 'verified'),
            supabase.from('leads').select('id', { count: 'exact', head: true }).eq('lead_type', 'cold_agent'),
          ])
          return { all: a.count || 0, inbound: b.count || 0, verified: c.count || 0, cold_agent: d.count || 0 }
        })
    ])

    setLeads(leadsRes.data || [])
    setTotalCount(leadsRes.count || 0)
    setProfiles(profilesRes.data || [])
    setTabCounts(countsRes)
    setLoading(false)
  }

  function goPage(newPage) {
    setPage(newPage)
    fetchLeads(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  // ── Update lead status ─────────────────────────────────────
  async function updateStatus(leadId, status) {
    await supabase.from('leads').update({ status }).eq('id', leadId)
    setLeads(p => p.map(l => l.id === leadId ? { ...l, status } : l))
    if (selected?.id === leadId) setSelected(p => ({ ...p, status }))

    // Auto-conversion to client (+ job if paid inbound) now happens
    // automatically via database trigger — no frontend action needed
    if (status === 'Accepted') {
      showToast('✓ Accepted — client auto-created by system')
    } else {
      showToast(`Status → ${status}`)
    }
  }

  async function deleteLead(leadId) {
    if (!window.confirm('Delete this lead permanently?')) return
    await supabase.from('leads').delete().eq('id', leadId)
    await fetchLeads()
    showToast('Lead deleted')
  }

  async function deleteAllShown() {
    if (!window.confirm('Delete all ' + totalCount + ' leads shown? This cannot be undone.')) return
    const allIds = []
    let p = 0
    while (true) {
      let q = supabase.from('leads').select('id')
      if (tab !== 'all') q = q.eq('lead_type', tab)
      if (filterStatus !== 'All') q = q.eq('status', filterStatus)
      const { data } = await q.range(p * 500, (p + 1) * 500 - 1)
      if (!data || data.length === 0) break
      allIds.push(...data.map(l => l.id))
      p++
    }
    for (let i = 0; i < allIds.length; i += 100) {
      await supabase.from('leads').delete().in('id', allIds.slice(i, i + 100))
    }
    await fetchLeads()
    showToast(allIds.length + ' leads deleted')
  }

  async function assignToMe(leadId) {
    await supabase.from('leads').update({ assigned_to: profile.id }).eq('id', leadId)
    setLeads(p => p.map(l => l.id === leadId ? { ...l, assigned_to: profile.id } : l))
    showToast('Assigned to you')
  }

  async function unassignLead(leadId) {
    await supabase.from('leads').update({ assigned_to: null }).eq('id', leadId)
    setLeads(p => p.map(l => l.id === leadId ? { ...l, assigned_to: null } : l))
    showToast('Unassigned')
  }

  async function bulkAssign() {
    if (!bulkAssignTo || selectedIds.size === 0) return
    const ids = [...selectedIds]
    const { error } = await supabase.from('leads')
      .update({ assigned_to: bulkAssignTo || null })
      .in('id', ids)
    if (error) { showToast(error.message, 'error'); return }
    showToast(ids.length + ' leads assigned')
    setSelectedIds(new Set())
    setBulkAssignTo('')
    await fetchLeads()
  }

  async function bulkUnassign() {
    if (selectedIds.size === 0) return
    if (!window.confirm('Unassign ' + selectedIds.size + ' leads?')) return
    await supabase.from('leads').update({ assigned_to: null }).in('id', [...selectedIds])
    showToast(selectedIds.size + ' leads unassigned')
    setSelectedIds(new Set())
    await fetchLeads()
  }

  // ── Convert lead to client ─────────────────────────────────
  async function convertToClient(lead) {
    if (!lead) return
    const clientName = lead.inbound_name || lead.company_name || `${lead.contact_first || ''} ${lead.contact_last || ''}`.trim()
    const email = lead.inbound_email || lead.email_address || lead.cold_email
    const phone = lead.inbound_phone || lead.job_telephone || lead.job_mobile || lead.direct_number

    // Create client
    const { data: client, error } = await supabase.from('clients').insert({
      client_type: lead.lead_type === 'cold_agent' ? 'Estate Agent' : 'Landlord',
      company_name: lead.company_name || lead.cold_company_name || null,
      first_name: lead.contact_first || (lead.inbound_name ? lead.inbound_name.split(' ')[0] : null),
      last_name: lead.contact_last || (lead.inbound_name ? lead.inbound_name.split(' ').slice(1).join(' ') : null),
      email,
      phone,
      street_address: lead.street_address || lead.address || lead.cold_address,
      city: lead.city,
      postcode: lead.postcode,
      source: 'converted-lead',
      lead_id: lead.id,
      assigned_to: lead.assigned_to || profile.id,
      status: 'Active',
    }).select().single()

    if (error) { showToast('Client created but error: ' + error.message, 'error'); return }

    showToast(`✓ ${clientName} added to clients`)

    // For inbound leads that are paid → also create jobs automatically
    if (lead.lead_type === 'inbound' && lead.payment_status?.toLowerCase() === 'paid') {
      await autoCreateJobs(lead, client.id)
    }
  }

  // ── Auto-create jobs from inbound lead ────────────────────
  async function autoCreateJobs(lead, clientId) {
    const services = parseServices(lead.services_requested)
    if (!services.length) return

    const siteAddress = [lead.street_address, lead.city, lead.postcode].filter(Boolean).join(', ')

    // Group by address — since it's one form entry, all services go to one job
    const { data: job } = await supabase.from('jobs').insert({
      client_id: clientId,
      lead_id: lead.id,
      title: services.map(s => s.name.split('—')[0].trim()).join(' + '),
      service_types: services.map(s => s.name),
      site_address: siteAddress,
      site_postcode: lead.postcode,
      scheduled_date: lead.appointment_date,
      scheduled_slot: lead.time_slot,
      status: lead.payment_status?.toLowerCase() === 'paid' ? 'Scheduled' : 'Quote',
      payment_status: lead.payment_status?.toLowerCase() === 'paid' ? 'Paid' : 'Unpaid',
      payment_amount: lead.payment_status?.toLowerCase() === 'paid' ? lead.total_price : 0,
      invoice_amount: lead.total_price || 0,
      quoted_amount: lead.total_price || 0,
      source: 'inbound-form',
      assigned_to: lead.assigned_to || profile.id,
    }).select().single()

    if (job) {
      // Insert line items per service
      await supabase.from('job_line_items').insert(
        services.map(s => ({
          job_id: job.id,
          description: s.name,
          item_type: 'certificate',
          quantity: 1,
          unit: 'ea',
          unit_price: s.price,
        }))
      )
      showToast(`✓ Job created: ${job.job_number}`)
    }
  }

  // ── CSV parsing — handles \r\n, multiline quoted fields ────
  function parseCSV(text) {
    // Normalise line endings
    const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    if (!normalised) return []

    const rows = []
    let row = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < normalised.length; i++) {
      const ch = normalised[i]
      const next = normalised[i + 1]

      if (ch === '"') {
        if (inQuotes && next === '"') {
          // Escaped quote inside quoted field
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        row.push(current.trim())
        current = ''
      } else if (ch === '\n' && !inQuotes) {
        row.push(current.trim())
        current = ''
        if (row.some(v => v !== '')) rows.push(row)
        row = []
      } else {
        current += ch
      }
    }
    // Last field/row
    row.push(current.trim())
    if (row.some(v => v !== '')) rows.push(row)

    if (rows.length < 2) return []

    // First row = headers
    const headers = rows[0].map(h =>
      h.replace(/"/g, '').trim().toLowerCase().replace(/[\s\-\/]+/g, '_')
    )

    return rows.slice(1).map(vals => {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = (vals[i] || '').replace(/^"|"$/g, '') })
      return obj
    }).filter(row => Object.values(row).some(v => v && v.trim()))
  }

  function handleCSVFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setCsvText(ev.target.result); setCsvPreview(parseCSV(ev.target.result).slice(0, 3)) }
    reader.readAsText(file)
  }

  async function importCSV() {
    if (!csvText) return
    const rows = parseCSV(csvText)
    if (!rows.length) { showToast('No valid rows found', 'error'); return }
    setImporting(true)

    const toInsert = rows.map(row => {
      if (importType === 'inbound') {
        const services = row.services_readable || row['services_(readable)'] || row.services || ''
        const payStatus = (row.payment_status || '').toLowerCase()
        const autoStatus = payStatus === 'paid' ? 'Accepted' : 'New'
        return {
          lead_type: 'inbound',
          form_timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
          inbound_name: row.name || '',
          inbound_email: row.email || '',
          inbound_phone: row.phone || '',
          tenant_phone: row.tenant_phone || '',
          street_address: row.street_address || row.address || '',
          city: row.city || '',
          postcode: row.postcode || '',
          property_type: row.property_type || '',
          property_subtype: row.property_sub_type || row.property_subtype || '',
          services_requested: services,
          additional_charges: row.additional_charges || '',
          appointment_date: row.appointment_date || null,
          time_slot: row.time_slot || '',
          total_price: parseFloat(row.total_price) || null,
          payment_status: row.payment_status || '',
          status: autoStatus,
          assigned_to: profile.id,
        }
      } else if (importType === 'verified') {
        const workDone = row.previous_job || row.work_done || ''
        const jobDate = row.date || row.previous_job_date || null
        return {
          lead_type: 'verified',
          form_timestamp: jobDate ? new Date(jobDate).toISOString() : null,
          previous_job_date: jobDate || null,
          company_name: row.company || '',
          contact_first: row.contact_first || '',
          contact_last: row.contact_last || '',
          email_address: row.email_address || row.email || '',
          job_telephone: row.telephone_number || row.job_telephone || '',
          job_mobile: row.mobile_number || row.job_mobile || '',
          address: row.address || '',
          work_done: workDone,
          last_payment_amount: parseFloat(row.payment_amount) || null,
          last_invoice_amount: parseFloat(row.total_invoice_amount) || null,
          notes: (row.notes || '').slice(0, 400),
          renewal_due_date: calcRenewal(workDone, jobDate),
          renewal_services: workDone,
          status: 'New',
          assigned_to: profile.id,
        }
      } else {
        return {
          lead_type: 'cold_agent',
          cold_company_name: row.company_name || '',
          cold_address: row.address || '',
          cold_contact_name: row.name || '',
          zoopla_number: row.zoopla_number || row.zoople_number || '',
          landline_number: row.landline_number || '',
          direct_number: row.direct_number || '',
          cold_email: row.email || '',
          email_verified: row.email_verified === 'Verified' ? 'Verified' : row.email_verified === 'Unverified' ? 'Unverified' : 'Unknown',
          website: row.website || '',
          status: 'New',
          assigned_to: profile.id,
        }
      }
    }).filter(Boolean)

    // ── Duplicate detection ──────────────────────────────────────
    // Reliable key per lead type differs (each type stores its contact
    // email under a different column), plus a phone fallback for rows
    // that have no email at all (mainly "verified" leads, which are
    // often phone-first).
    const EMAIL_FIELD = { inbound: 'inbound_email', verified: 'email_address', cold_agent: 'cold_email' }
    const PHONE_FIELDS = {
      inbound: ['inbound_phone', 'tenant_phone'],
      verified: ['job_telephone', 'job_mobile'],
      cold_agent: ['landline_number', 'direct_number'],
    }
    const emailField = EMAIL_FIELD[importType]
    const phoneFields = PHONE_FIELDS[importType]
    const normEmail = v => (v || '').trim().toLowerCase()
    const normPhone = v => (v || '').replace(/[^\d]/g, '') // digits only, ignores spacing/formatting differences

    function keyFor(row) {
      const email = normEmail(row[emailField])
      if (email) return `e:${email}`
      for (const f of phoneFields) {
        const p = normPhone(row[f])
        if (p) return `p:${p}`
      }
      return null // nothing to dedupe on -- let it through
    }

    // 1. Collapse duplicates within the file itself (keep first occurrence)
    const seenInFile = new Set()
    let withinFileDupes = 0
    const deduped = toInsert.filter(row => {
      const key = keyFor(row)
      if (!key) return true
      if (seenInFile.has(key)) { withinFileDupes++; return false }
      seenInFile.add(key)
      return true
    })

    // 2. Check against leads already in the database (same lead type only)
    const emailKeys = [...new Set(deduped.map(r => normEmail(r[emailField])).filter(Boolean))]
    const phoneKeys = [...new Set(deduped.flatMap(r => phoneFields.map(f => normPhone(r[f]))).filter(Boolean))]

    const existingKeys = new Set()
    if (emailKeys.length) {
      const { data: existingByEmail } = await supabase.from('leads').select(emailField)
        .eq('lead_type', importType).in(emailField, emailKeys)
      for (const r of (existingByEmail || [])) existingKeys.add(`e:${normEmail(r[emailField])}`)
    }
    if (phoneKeys.length) {
      const orClause = phoneFields.map(f => phoneKeys.map(p => `${f}.eq.${p}`).join(',')).join(',')
      const { data: existingByPhone } = await supabase.from('leads').select(phoneFields.join(','))
        .eq('lead_type', importType).or(orClause)
      for (const r of (existingByPhone || [])) {
        for (const f of phoneFields) { const p = normPhone(r[f]); if (p) existingKeys.add(`p:${p}`) }
      }
    }

    let alreadyExisted = 0
    const finalRows = deduped.filter(row => {
      const key = keyFor(row)
      if (key && existingKeys.has(key)) { alreadyExisted++; return false }
      return true
    })

    const skippedTotal = withinFileDupes + alreadyExisted

    // Batch insert in chunks of 500 to handle large files
    const BATCH_SIZE = 500
    let inserted = 0
    let errors = 0

    for (let i = 0; i < finalRows.length; i += BATCH_SIZE) {
      const batch = finalRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('leads').insert(batch)
      if (error) {
        console.error('Batch error:', error)
        errors++
      } else {
        inserted += batch.length
      }
      // Update progress
      showToast(`Importing… ${inserted} / ${finalRows.length}`)
    }

    setImporting(false)

    const dupeNote = skippedTotal > 0 ? ` · ${skippedTotal} duplicate${skippedTotal === 1 ? '' : 's'} skipped` : ''
    if (errors > 0) {
      showToast(`${inserted} imported, ${errors} batches failed — check console${dupeNote}`, 'error')
    } else if (importType === 'inbound') {
      const paid = finalRows.filter(r => r.status === 'Accepted').length
      showToast(`✓ ${inserted} leads imported · ${paid} auto-converted (paid)${dupeNote}`)
    } else {
      showToast(`✓ ${inserted} leads imported${dupeNote}`)
    }

    await fetchLeads()
    setShowImport(false)
    setCsvText('')
    setCsvPreview([])
  }

  // ── Add single lead ────────────────────────────────────────
  async function addLead() {
    setSaving(true)
    const payload = { ...form, lead_type: addType, assigned_to: profile.id }
    if (addType === 'verified' && payload.work_done && payload.previous_job_date) {
      payload.renewal_due_date = calcRenewal(payload.work_done, payload.previous_job_date)
    }
    const { error } = await supabase.from('leads').insert(payload)
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    await fetchLeads()
    setShowAdd(false)
    setForm({ status: 'New', email_verified: 'Unknown' })
    showToast('Lead added ✓')
  }

  // ── Display helpers ────────────────────────────────────────
  const displayName = l => {
    if (l.lead_type === 'inbound')    return l.inbound_name || l.inbound_email || '—'
    if (l.lead_type === 'verified')   return l.company_name || `${l.contact_first || ''} ${l.contact_last || ''}`.trim() || l.email_address || '—'
    return l.cold_company_name || l.cold_contact_name || l.cold_email || '—'
  }
  const displayEmail = l => l.inbound_email || l.email_address || l.cold_email || '—'
  const displayPhone = l => l.inbound_phone || l.job_telephone || l.job_mobile || l.direct_number || l.landline_number || '—'

  function displayEmailField(l) {
    if (l.lead_type === 'inbound') return 'inbound_email'
    if (l.lead_type === 'cold_agent') return 'cold_email'
    return 'email_address'
  }

  function displayPhoneField(l) {
    if (l.lead_type === 'inbound') return 'inbound_phone'
    if (l.lead_type === 'cold_agent') return 'landline_number'
    return 'job_telephone'
  }

  function timeAgo(ts) {
    if (!ts) return null
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
    if (mins < 60)    return mins + 'm ago'
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)     return hrs + 'h ago'
    const days = Math.floor(hrs / 24)
    if (days < 30)    return days + 'd ago'
    return Math.floor(days / 30) + 'mo ago'
  }

  async function saveInlineEdit() {
    if (!editingField) return
    await supabase.from('leads').update({ [editingField.field]: editingValue }).eq('id', editingField.id)
    setLeads(p => p.map(l => l.id === editingField.id ? { ...l, [editingField.field]: editingValue } : l))
    setEditingField(null)
  }

  const counts = tabCounts

  // No client-side filtering needed — server handles it all
  const filtered = leads

  const th = { textAlign: 'left', padding: '10px 14px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, background: C.surface }
  const td = { padding: '11px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 14, verticalAlign: 'middle' }

  function SortTh({ label, field, style: sx = {} }) {
    const on = sortField === field
    return (
      <th onClick={() => on ? setSortDir(d => d === 'asc' ? 'desc' : 'asc') : (setSortField(field), setSortDir('asc'))}
        style={{ cursor: 'pointer', padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA', color: on ? '#0093DB' : '#6B7280', whiteSpace: 'nowrap', userSelect: 'none', ...sx }}>
        {label} <span style={{ opacity: 0.5 }}>{on ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  // ── Render columns per tab ─────────────────────────────────
  const renderRow = (l) => {
    const days = l.renewal_due_date ? Math.floor((new Date(l.renewal_due_date) - new Date()) / 86400000) : null
    const renewColor = days === null ? C.dim : days < 0 ? C.red : days <= 14 ? C.amber : C.greenDark

    return (
      <tr key={l.id}
        onMouseEnter={e => e.currentTarget.style.background = C.surface}
        onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
        {/* Select */}
        <td style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB' }} onClick={e => e.stopPropagation()}>
          <input type="checkbox"
            checked={selectedIds.has(l.id)}
            onChange={e => {
              const next = new Set(selectedIds)
              if (e.target.checked) next.add(l.id)
              else next.delete(l.id)
              setSelectedIds(next)
            }}
          />
        </td>

        {/* Date */}
        <td style={td}><span style={{ color: C.dim, fontSize: 12 }}>{l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB') : '—'}</span></td>

        {/* Name — clickable */}
        <td style={td}>
          <div style={{ fontWeight: 600, color: C.accent, cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.id}`)}>
            {displayName(l)}
          </div>
          {l.lead_type === 'verified' && l.company_name && <div style={{ fontSize: 12, color: C.muted }}>{l.contact_first} {l.contact_last}</div>}
          {l.form_timestamp && <div style={{ fontSize: 11, color: C.dim }}>{new Date(l.form_timestamp).toLocaleDateString('en-GB')}</div>}
        </td>
        {/* Type chip — only on all tab */}
        {tab === 'all' && <td style={td}><TypeChip type={l.lead_type} /></td>}

        {/* Email — double-click to edit */}
        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB', fontSize:12, maxWidth:160 }} onClick={e => e.stopPropagation()}>
          {editingField?.id === l.id && editingField?.field === displayEmailField(l) ? (
            <input autoFocus value={editingValue}
              onChange={e => setEditingValue(e.target.value)}
              onBlur={saveInlineEdit}
              onKeyDown={e => e.key === 'Enter' ? saveInlineEdit() : e.key === 'Escape' ? setEditingField(null) : null}
              style={{ width:'100%', border:'1px solid #0093DB', borderRadius:4, padding:'2px 6px', fontSize:11 }}
            />
          ) : (
            <span
              onDoubleClick={() => { setEditingField({ id: l.id, field: displayEmailField(l) }); setEditingValue(displayEmail(l)) }}
              title="Double-click to edit"
              style={{ color:'#6B7280', fontSize:11, cursor:'text', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {displayEmail(l) || <span style={{ color:'#D1D5DB' }}>—</span>}
            </span>
          )}
        </td>

        {/* Phone — double-click to edit */}
        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB', fontSize:12, maxWidth:160 }} onClick={e => e.stopPropagation()}>
          {editingField?.id === l.id && editingField?.field === displayPhoneField(l) ? (
            <input autoFocus value={editingValue}
              onChange={e => setEditingValue(e.target.value)}
              onBlur={saveInlineEdit}
              onKeyDown={e => e.key === 'Enter' ? saveInlineEdit() : e.key === 'Escape' ? setEditingField(null) : null}
              style={{ width:'100%', border:'1px solid #0093DB', borderRadius:4, padding:'2px 6px', fontSize:11 }}
            />
          ) : (
            <span
              onDoubleClick={() => { setEditingField({ id: l.id, field: displayPhoneField(l) }); setEditingValue(displayPhone(l)) }}
              title="Double-click to edit"
              style={{ color:'#6B7280', fontSize:11, cursor:'text', display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {displayPhone(l) || <span style={{ color:'#D1D5DB' }}>—</span>}
            </span>
          )}
        </td>

        {/* Type-specific columns */}
        {(tab === 'inbound') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.street_address}{l.city ? `, ${l.city}` : ''} {l.postcode}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.property_type} {l.property_subtype ? `· ${l.property_subtype}` : ''}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.services_requested ? l.services_requested.split(',').length + ' services' : '—'}</span></td>
          <td style={td}><span style={{ fontSize: 13, fontWeight: 600, color: C.greenDark }}>{l.total_price ? `£${l.total_price}` : '—'}</span></td>
          <td style={td}><span style={{ background: l.payment_status?.toLowerCase() === 'paid' ? C.greenSoft : C.amberSoft, color: l.payment_status?.toLowerCase() === 'paid' ? C.greenDark : C.amber, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>{l.payment_status || '—'}</span></td>
        </>}

        {(tab === 'verified') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.address}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.work_done}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.greenDark }}>{l.last_payment_amount ? `£${l.last_payment_amount}` : '—'}</span></td>
          <td style={td}>
            {l.renewal_due_date ? (
              <span style={{ color: renewColor, fontSize: 12, fontWeight: 600 }}>
                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d — ${l.renewal_due_date}`}
              </span>
            ) : <span style={{ color: C.dim }}>—</span>}
          </td>
        </>}

        {(tab === 'cold_agent') && <>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.cold_address}</span></td>
          <td style={td}><span style={{ fontSize: 12, color: C.muted }}>{l.direct_number || l.landline_number}</span></td>
          <td style={td}>
            <span style={{
              background: l.email_verified === 'Verified' ? C.greenSoft : l.email_verified === 'Unverified' ? C.redSoft : C.surface,
              color: l.email_verified === 'Verified' ? C.greenDark : l.email_verified === 'Unverified' ? C.red : C.muted,
              borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600,
            }}>{l.email_verified || 'Unknown'}</span>
          </td>
          <td style={td}>{l.website ? <a href={fixUrl(l.website)} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 12 }}>Visit</a> : <span style={{ color: C.dim }}>—</span>}</td>
        </>}

        {/* Assigned to */}
        <td style={td} onClick={e => e.stopPropagation()}>
          {isAdmin ? (
            <select
              value={l.assigned_to || ''}
              onChange={async e => {
                const newAssignee = e.target.value || null
                await supabase.from('leads').update({ assigned_to: newAssignee }).eq('id', l.id)
                setLeads(p => p.map(x => x.id === l.id ? { ...x, assigned_to: newAssignee } : x))
              }}
              style={{ background: 'transparent', border: '1px solid #E5E7EB', borderRadius: 6, padding: '3px 6px', fontSize: 11, cursor: 'pointer', color: l.assigned_to ? C.text : C.dim, maxWidth: 130 }}>
              <option value="">Unassigned</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: C.muted }}>
              {l.assigned_to ? profiles?.find?.(p => p.id === l.assigned_to)?.full_name || '—' : '—'}
            </span>
          )}
        </td>

        {/* Status — inline editable */}
        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB' }} onClick={e => e.stopPropagation()}>
          <select
            value={l.status}
            onChange={async e => {
              const newStatus = e.target.value
              await supabase.from('leads').update({ status: newStatus }).eq('id', l.id)
              setLeads(p => p.map(x => x.id === l.id ? { ...x, status: newStatus } : x))
            }}
            style={{
              background: 'transparent',
              border: '1px solid #E5E7EB',
              borderRadius: 6,
              padding: '3px 6px',
              fontSize: 11,
              cursor: 'pointer',
              color: l.status === 'Accepted' ? '#3d7a00' : l.status === 'Declined' ? '#DC2626' : l.status === 'Contacted' ? '#0093DB' : '#6B7280'
            }}>
            {['New','Contacted','In Discussion','Accepted','Declined'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </td>

        {/* Engagement */}
        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB', whiteSpace:'nowrap' }}>
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            {l.email_reply_count > 0 ? (
              <span title={'Replied ' + new Date(l.last_email_replied_at).toLocaleDateString('en-GB')}
                style={{ background:'#F0FAE0', color:'#3d7a00', borderRadius:5, padding:'2px 6px', fontSize:10, fontWeight:700 }}>
                ↩ Replied
              </span>
            ) : l.email_open_count > 0 ? (
              <span title={'Opened ' + new Date(l.last_email_opened_at).toLocaleDateString('en-GB')}
                style={{ background:'#FEF3C7', color:'#D97706', borderRadius:5, padding:'2px 6px', fontSize:10, fontWeight:700 }}>
                👁 Opened{l.email_open_count > 1 ? ' ×' + l.email_open_count : ''}
              </span>
            ) : l.email_send_count > 0 ? (
              <span title={'Sent ' + new Date(l.last_email_sent_at).toLocaleDateString('en-GB')}
                style={{ background:'#E6F4FC', color:'#0093DB', borderRadius:5, padding:'2px 6px', fontSize:10, fontWeight:600 }}>
                ✉ Sent{l.email_send_count > 1 ? ' ×' + l.email_send_count : ''}
              </span>
            ) : (
              <span style={{ color:'#D1D5DB', fontSize:11 }}>—</span>
            )}
            {l.in_campaign && (
              <span title="In an active campaign"
                style={{ background:'#EDE9FE', color:'#7C3AED', borderRadius:5, padding:'2px 5px', fontSize:9, fontWeight:700 }}>
                CAMP
              </span>
            )}
          </div>
        </td>

        {/* Last Contact */}
        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB', fontSize:11, whiteSpace:'nowrap' }}>
          {l.last_contacted_at
            ? <span style={{ color: (Date.now() - new Date(l.last_contacted_at)) > 2592000000 ? '#D97706' : '#6B7280' }}>
                {timeAgo(l.last_contacted_at)}
              </span>
            : <span style={{ color:'#D1D5DB' }}>Never</span>}
        </td>

        {/* Actions */}
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={l.status} onChange={e => updateStatus(l.id, e.target.value)}
              style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, color: '#1F2937', padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}>
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {!l.assigned_to && (
              <button onClick={e => { e.stopPropagation(); assignToMe(l.id) }}
                style={{ background: '#E6F4FC', color: '#0093DB', border: '1px solid #0093DB44', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Claim
              </button>
            )}
            {l.assigned_to === profile?.id && (
              <button onClick={e => { e.stopPropagation(); unassignLead(l.id) }}
                style={{ background: '#F5F7FA', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Release
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); deleteLead(l.id) }}
              style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #DC262644', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
              ✕
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const renderHeaders = () => {
    const typeSpecific = {
      inbound:    [{ label: 'Address' }, { label: 'Property' }, { label: 'Services' }, { label: 'Price', field: 'total_price' }, { label: 'Payment' }],
      verified:   [{ label: 'Address' }, { label: 'Work Done' }, { label: 'Last Payment' }, { label: 'Renewal Due' }],
      cold_agent: [{ label: 'Address' }, { label: 'Phone' }, { label: 'Email Verified' }, { label: 'Website' }],
    }
    const headers = [
      { label: 'Date', field: 'created_at' },
      { label: 'Name', field: 'inbound_name' },
      ...(tab === 'all' ? [{ label: 'Type' }] : []),
      { label: 'Email' }, { label: 'Phone' },
      ...(tab !== 'all' ? (typeSpecific[tab] || []) : []),
      { label: 'Assigned To' }, { label: 'Status', field: 'status' },
      { label: 'Engagement' }, { label: 'Last Contact', field: 'last_contacted_at' },
      { label: 'Change Status' },
    ]
    return (
      <>
        <th style={{ width: 36, padding: '8px 12px', borderBottom: '1px solid #E5E7EB', background: '#F5F7FA' }}>
          <input type="checkbox"
            checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
            onChange={e => setSelectedIds(e.target.checked ? new Set(filtered.map(l => l.id)) : new Set())}
          />
        </th>
        {headers.map(h => h.field
          ? <SortTh key={h.label} label={h.label} field={h.field} />
          : <th key={h.label} style={th}>{h.label}</th>
        )}
      </>
    )
  }

  return (
    <div>
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Leads</h1>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{totalCount} found · page {page + 1} of {totalPages || 1}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn small variant="danger" onClick={deleteAllShown}>🗑 Delete Shown</Btn>
          {isAdmin && <Btn small variant="ghost" onClick={() => setShowImport(true)}>⬆ Import CSV</Btn>}
          <Btn small onClick={() => setShowAdd(true)}>+ Add Lead</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, marginBottom: 16, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setRenewalFilter('All') }}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 400, background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? C.accent : C.muted }}>
            {t.label} <span style={{ color: tab === t.key ? C.accent : C.dim, fontSize: 12 }}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={searchInput} onChange={e => {
            setSearchInput(e.target.value)
            clearTimeout(searchTimer.current)
            searchTimer.current = setTimeout(() => setSearch(e.target.value), 400)
          }} placeholder="Search name, email, company…"
          style={{ ...inp, flex: 1, minWidth: 200, width: 'auto', padding: '8px 14px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
          <option value="All">All Statuses</option>
          {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterVerified} onChange={e => setFilterVerified(e.target.value)}
          style={{ background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, padding:'8px 10px', fontSize:13 }}>
          <option value="All">All Emails</option>
          <option value="Verified">✓ Verified only</option>
          <option value="Unverified">Unverified</option>
          <option value="Unknown">Unknown</option>
        </select>
        {(tab === 'verified' || tab === 'all') && (
          <select value={renewalFilter} onChange={e => setRenewalFilter(e.target.value)}
            style={{ ...inp, width: 'auto', padding: '8px 12px' }}>
            <option value="All">All Renewals</option>
            <option value="14">Due in 14 days</option>
            <option value="30">Due in 30 days</option>
            <option value="60">Due in 60 days</option>
            <option value="0">Overdue</option>
          </select>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#E6F4FC', border: '1px solid #0093DB44', borderRadius: 10, marginBottom: 12 }}>
          <span style={{ fontWeight: 700, color: '#0093DB', fontSize: 13 }}>{selectedIds.size} selected</span>
          <select value={bulkAssignTo} onChange={e => setBulkAssignTo(e.target.value)}
            style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, padding: '5px 10px', fontSize: 13, minWidth: 160 }}>
            <option value="">— Assign to rep —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <button onClick={bulkAssign} disabled={!bulkAssignTo}
            style={{ background: '#0093DB', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: bulkAssignTo ? 1 : 0.5 }}>
            ✓ Assign
          </button>
          <button onClick={bulkUnassign}
            style={{ background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 7, padding: '6px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Unassign
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 18, marginLeft: 'auto' }}>✕</button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted }}>
            No leads found.{' '}
            {isAdmin && <button onClick={() => setShowImport(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Import CSV</button>}
            {' or '}<button onClick={() => setShowAdd(true)} style={{ color: C.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Add one →</button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead><tr>{renderHeaders()}</tr></thead>
            <tbody>{filtered.map(renderRow)}</tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16, padding: '12px 0' }}>
          <button onClick={() => goPage(0)} disabled={page === 0}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', color: page === 0 ? C.dim : C.text, opacity: page === 0 ? 0.5 : 1 }}>
            « First
          </button>
          <button onClick={() => goPage(page - 1)} disabled={page === 0}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', color: page === 0 ? C.dim : C.text, opacity: page === 0 ? 0.5 : 1 }}>
            ‹ Prev
          </button>
          {/* Page numbers — show current ± 2 */}
          {Array.from({ length: totalPages }, (_, i) => i)
            .filter(i => Math.abs(i - page) <= 2)
            .map(i => (
            <button key={i} onClick={() => goPage(i)}
              style={{ background: i === page ? C.accent : '#fff', color: i === page ? '#fff' : C.text, border: `1px solid ${i === page ? C.accent : C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: i === page ? 700 : 400, cursor: 'pointer', minWidth: 36 }}>
              {i + 1}
            </button>
          ))}
          <button onClick={() => goPage(page + 1)} disabled={page >= totalPages - 1}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', color: page >= totalPages - 1 ? C.dim : C.text, opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Next ›
          </button>
          <button onClick={() => goPage(totalPages - 1)} disabled={page >= totalPages - 1}
            style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', color: page >= totalPages - 1 ? C.dim : C.text, opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Last »
          </button>
          <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
        </div>
      )}

      {/* ── Import Modal ─────────────────────────────────────── */}
      {showImport && isAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowImport(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 680, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>Import Leads — CSV</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Admin only. First row must be column headers.</div>

            {/* Type */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => setImportType(key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${importType === key ? meta.color : C.border}`, background: importType === key ? meta.bg : '#fff', color: importType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: importType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            {/* Column guide */}
            <div style={{ background: C.surface, borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 12, color: C.muted }}>
              <strong style={{ color: C.text }}>Expected columns ({TYPE_META[importType]?.label}):</strong><br /><br />
              {importType === 'inbound' && 'Timestamp, Name, Email, Phone, Tenant Phone, Street Address, City, Postcode, Property Type, Property Sub-Type, Services (Readable), Additional Charges, Appointment Date, Time Slot, Total Price, Payment Status, Status'}
              {importType === 'verified' && 'Date, Company, Contact First, Contact Last, Email Address, Telephone Number, Mobile Number, Address, Previous Job, Payment Amount, Total Invoice Amount, Notes'}
              {importType === 'cold_agent' && 'Company Name, Address, Name, Zoopla Number, Landline Number, Direct Number, Email, Email Verified, Website'}
            </div>

            {/* Notes for inbound */}
            {importType === 'inbound' && (
              <div style={{ background: C.accentSoft, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.accent }}>
                ℹ Paid inbound leads will be automatically converted to clients and jobs on import.
              </div>
            )}
            {importType === 'cold_agent' && (
              <div style={{ background: C.greenSoft, border: `1px solid ${C.green}44`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.greenDark }}>
                ℹ Only leads with Email Verified = "Verified" will be available for email campaigns.
              </div>
            )}

            <label style={{ ...lbl, marginBottom: 6 }}>Upload CSV File</label>
            <input type="file" accept=".csv" onChange={handleCSVFile}
              style={{ display: 'block', padding: '8px', border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', fontSize: 13, marginBottom: 14, cursor: 'pointer' }} />

            <label style={{ ...lbl, marginBottom: 6 }}>Or Paste CSV Content</label>
            <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setCsvPreview(parseCSV(e.target.value).slice(0, 3)) }} rows={5}
              placeholder="Paste CSV here…"
              style={{ ...inp, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, marginBottom: 14 }} />

            {csvPreview.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Preview (first {csvPreview.length} rows)</label>
                <div style={{ background: C.surface, borderRadius: 8, padding: 12, fontSize: 11, color: C.muted, maxHeight: 120, overflowY: 'auto', fontFamily: 'monospace' }}>
                  {csvPreview.map((row, i) => (
                    <div key={i} style={{ padding: '3px 0', borderBottom: `1px solid ${C.border}` }}>
                      {Object.entries(row).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                    </div>
                  ))}
                </div>
                <div style={{ color: C.accent, fontSize: 13, marginTop: 6 }}>{parseCSV(csvText).length} rows ready to import</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={importCSV} disabled={importing || !csvText.trim()}>{importing ? 'Importing…' : `Import ${parseCSV(csvText).length || 0} Leads`}</Btn>
              <Btn variant="ghost" onClick={() => { setShowImport(false); setCsvText(''); setCsvPreview([]) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Lead Modal ───────────────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 20 }}>Add New Lead</div>

            {/* Type selector */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {Object.entries(TYPE_META).map(([key, meta]) => (
                <button key={key} onClick={() => setAddType(key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${addType === key ? meta.color : C.border}`, background: addType === key ? meta.bg : '#fff', color: addType === key ? meta.color : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: addType === key ? 700 : 400 }}>
                  {meta.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {/* Status always shown */}
              <div><label style={lbl}>Status</label>
                <select value={form.status || 'New'} onChange={e => set('status', e.target.value)} style={inp}>
                  {LEAD_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {addType === 'inbound' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Full Name</label><input value={form.inbound_name || ''} onChange={e => set('inbound_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.inbound_email || ''} onChange={e => set('inbound_email', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Phone</label><input value={form.inbound_phone || ''} onChange={e => set('inbound_phone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Tenant Phone</label><input value={form.tenant_phone || ''} onChange={e => set('tenant_phone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Property Type</label><input value={form.property_type || ''} onChange={e => set('property_type', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Street Address</label><input value={form.street_address || ''} onChange={e => set('street_address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>City</label><input value={form.city || ''} onChange={e => set('city', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Postcode</label><input value={form.postcode || ''} onChange={e => set('postcode', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Services Requested</label><input value={form.services_requested || ''} onChange={e => set('services_requested', e.target.value)} placeholder="EICR Certificate — 1–3 Bedrooms (£94.99), Gas Safety (£84.99)" style={inp} /></div>
                <div><label style={lbl}>Appointment Date</label><input type="date" value={form.appointment_date || ''} onChange={e => set('appointment_date', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Time Slot</label>
                  <select value={form.time_slot || ''} onChange={e => set('time_slot', e.target.value)} style={inp}>
                    <option value="">—</option><option>Morning (8am–12pm)</option><option>Afternoon (12pm–6pm)</option>
                  </select>
                </div>
                <div><label style={lbl}>Total Price (£)</label><input type="number" value={form.total_price || ''} onChange={e => set('total_price', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Payment Status</label>
                  <select value={form.payment_status || ''} onChange={e => set('payment_status', e.target.value)} style={inp}>
                    <option value="">—</option><option>Paid</option><option>Unpaid</option><option>Partial</option>
                  </select>
                </div>
              </>}

              {addType === 'verified' && <>
                <div><label style={lbl}>Company</label><input value={form.company_name || ''} onChange={e => set('company_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact First</label><input value={form.contact_first || ''} onChange={e => set('contact_first', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact Last</label><input value={form.contact_last || ''} onChange={e => set('contact_last', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.email_address || ''} onChange={e => set('email_address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Telephone</label><input value={form.job_telephone || ''} onChange={e => set('job_telephone', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Mobile</label><input value={form.job_mobile || ''} onChange={e => set('job_mobile', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Address</label><input value={form.address || ''} onChange={e => set('address', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Job Date</label><input type="date" value={form.previous_job_date || ''} onChange={e => set('previous_job_date', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Previous Job / Work Done</label><input value={form.work_done || ''} onChange={e => set('work_done', e.target.value)} placeholder="EICR, GSC, FRA…" style={inp} /></div>
                <div><label style={lbl}>Payment Amount (£)</label><input type="number" value={form.last_payment_amount || ''} onChange={e => set('last_payment_amount', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Invoice Amount (£)</label><input type="number" value={form.last_invoice_amount || ''} onChange={e => set('last_invoice_amount', e.target.value)} style={inp} /></div>
                {form.previous_job_date && form.work_done && (
                  <div style={{ gridColumn: 'span 2', background: C.purpleSoft, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.purple }}>
                    📅 Renewal due: <strong>{calcRenewal(form.work_done, form.previous_job_date)}</strong>
                  </div>
                )}
              </>}

              {addType === 'cold_agent' && <>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Company Name</label><input value={form.cold_company_name || ''} onChange={e => set('cold_company_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Contact Name</label><input value={form.cold_contact_name || ''} onChange={e => set('cold_contact_name', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email</label><input type="email" value={form.cold_email || ''} onChange={e => set('cold_email', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Email Verified</label>
                  <select value={form.email_verified || 'Unknown'} onChange={e => set('email_verified', e.target.value)} style={inp}>
                    <option>Unknown</option><option>Verified</option><option>Unverified</option>
                  </select>
                </div>
                <div><label style={lbl}>Direct Number</label><input value={form.direct_number || ''} onChange={e => set('direct_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Landline</label><input value={form.landline_number || ''} onChange={e => set('landline_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Zoopla Number</label><input value={form.zoopla_number || ''} onChange={e => set('zoopla_number', e.target.value)} style={inp} /></div>
                <div><label style={lbl}>Website</label><input value={form.website || ''} onChange={e => set('website', e.target.value)} style={inp} /></div>
                <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Address</label><input value={form.cold_address || ''} onChange={e => set('cold_address', e.target.value)} style={inp} /></div>
              </>}

              <div style={{ gridColumn: 'span 2' }}><label style={lbl}>Notes</label>
                <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
                  style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Btn onClick={addLead} disabled={saving}>{saving ? 'Saving…' : 'Add Lead'}</Btn>
              <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}
