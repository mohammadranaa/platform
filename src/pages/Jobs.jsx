import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'
import { parseLocalDate } from '../lib/dateUtils'

const C = { surface:'#F5F7FA',border:'#E5E7EB',accent:'#0093DB',accentSoft:'#E6F4FC',green:'#80D100',greenSoft:'#F0FAE0',greenDark:'#3d7a00',amber:'#D97706',amberSoft:'#FEF3C7',red:'#DC2626',redSoft:'#FEE2E2',teal:'#0D9488',tealSoft:'#CCFBF1',text:'#1F2937',muted:'#6B7280',dim:'#9CA3AF' }
const STATUSES = ['New','In Progress','Confirmed','Completed','Declined']
const SS = { 'New':{color:'#6B7280',bg:'#F5F7FA'},'In Progress':{color:'#0284C7',bg:'#DBEAFE'},'Confirmed':{color:'#0093DB',bg:'#E6F4FC'},'Completed':{color:'#3d7a00',bg:'#F0FAE0'},'Declined':{color:'#DC2626',bg:'#FEE2E2'} }
const SVCS = ['EICR','GSC (CP12)','EPC','FRA','FSC','PAT Testing','Remedial Works','Consumer Unit','Diagnostics','Asbestos Survey','Fire Alarm','Boiler Installation','Other']
const fmt = v => '£'+Number(v||0).toLocaleString('en-GB',{minimumFractionDigits:2})
const fmtD = d => d ? parseLocalDate(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}) : '—'
const cName = c => c?.company_name||[c?.first_name,c?.last_name].filter(Boolean).join(' ')||'—'

export default function Jobs() {
  const { profile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('list')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date()
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  })
  const [search, setSearch] = useState('')
  const [filterPayment, setFilterPayment] = useState('All')
  const [filterSource, setFilterSource] = useState('All')
  const [filterService, setFilterService] = useState('All')
  const [filterCertStatus, setFilterCertStatus] = useState('All')
  const [sortField, setSortField] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [showNew, setShowNew] = useState(false)
  const blank = { title:'',service_types:[],scheduled_date:'',scheduled_slot:'',site_address:'',detail_of_service:'',tenant_name:'',tenant_phone:'',job_source_type:'inbound',client_id:'',assigned_to:'',engineer_name:'' }
  const [form, setForm] = useState(blank)
  const sf = (k,v) => setForm(p=>({...p,[k]:v}))
  const tog = s => sf('service_types', form.service_types.includes(s) ? form.service_types.filter(x=>x!==s) : [...form.service_types,s])

  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showAddClient, setShowAddClient] = useState(false)
  const [nc, setNc] = useState({ first_name:'', last_name:'', company_name:'', email:'', phone:'', street_address:'', city:'', postcode:'', client_type:'Landlord' })

  async function createQuickClient() {
    if (!nc.first_name && !nc.company_name) { showToast('Name or company required', 'error'); return }
    const { data: c, error } = await supabase.from('clients').insert({
      ...nc, is_active: true, source: 'manual-from-job'
    }).select().single()
    if (error) { showToast(error.message, 'error'); return }
    setClients(prev => [c, ...prev])
    sf('client_id', c.id)
    sf('site_address', [c.street_address, c.city, c.postcode].filter(Boolean).join(', '))
    setShowAddClient(false)
    setClientSearch(cName(c))
    setNc({ first_name:'', last_name:'', company_name:'', email:'', phone:'', street_address:'', city:'', postcode:'', client_type:'Landlord' })
    showToast('Client created ✓')
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: j, error: je } = await supabase
      .from('jobs')
      .select('id, job_number, title, status, scheduled_date, payment_status, amount_received, service_types, client_id, assigned_to, auto_generated, engineer_name, engineer_paid_amount, gross_profit, certificate_status, certificate_sent, remedial_quotation_sent, google_review_requested, work_done, detail_of_service, job_source_type, site_address, created_at, clients(first_name, last_name, company_name), profiles!jobs_assigned_to_fkey(full_name)')
      .order('created_at', { ascending: false })

    if (je) console.error('JOBS FETCH ERROR:', JSON.stringify(je))
    setJobs(j || [])

    const [r2, r3] = await Promise.all([
      supabase.from('clients').select('id,first_name,last_name,company_name,street_address,city,postcode').eq('is_active',true).order('company_name'),
      supabase.from('profiles').select('id,full_name').eq('is_active',true)
    ])
    setClients(r2.data||[])
    setProfiles(r3.data||[])
    setLoading(false)
  }

  const monthly = useMemo(() => {
    const m = {}
    jobs.forEach(j => {
      const d = j.scheduled_date||j.created_at?.slice(0,10); if(!d) return
      const key = d.slice(0,7)
      const label = new Date(d+'T12:00:00').toLocaleDateString('en-GB',{month:'short',year:'numeric'})
      if(!m[key]) m[key]={key,label,total:0,Completed:0,Confirmed:0,'In Progress':0,New:0,Declined:0,revenue:0,profit:0}
      m[key].total++
      m[key][j.status]=(m[key][j.status]||0)+1
      m[key].revenue+=Number(j.amount_received||0)
      m[key].profit+=Number(j.gross_profit||0)
    })
    return Object.values(m).sort((a,b)=>b.key.localeCompare(a.key))
  }, [jobs])

  const bdl = useMemo(() => {
    const s = {}
    jobs.forEach(j => {
      const n = j.profiles?.full_name||'Unassigned'
      if(!s[n]) s[n]={jobs:0,revenue:0,profit:0}
      s[n].jobs++; s[n].revenue+=Number(j.amount_received||0); s[n].profit+=Number(j.gross_profit||0)
    })
    return Object.entries(s).sort((a,b)=>b[1].profit-a[1].profit)
  }, [jobs])

  const rows = useMemo(() => {
    let r = [...jobs]
    if(filterStatus!=='All') r=r.filter(j=>j.status===filterStatus)
    if(filterMonth!=='all') r=r.filter(j=>{const d=j.scheduled_date||j.created_at?.slice(0,10);return d&&d.startsWith(filterMonth)})
    if(search){const q=search.toLowerCase();r=r.filter(j=>(j.title||'').toLowerCase().includes(q)||(j.job_number||'').toLowerCase().includes(q)||cName(j.clients).toLowerCase().includes(q)||(j.site_address||'').toLowerCase().includes(q))}
    if(filterPayment!=='All') r=r.filter(j=>(j.payment_status||'Unpaid')===filterPayment)
    if(filterSource!=='All') r=r.filter(j=>(j.job_source_type||'inbound')===filterSource)
    if(filterService!=='All') r=r.filter(j=>(j.service_types||[]).some(s=>s.toLowerCase().includes(filterService.toLowerCase())))
    if(filterCertStatus!=='All') r=r.filter(j=>(j.certificate_status||'Not Issued')===filterCertStatus)
    r.sort((a,b)=>{
      let av,bv
      if(sortField==='client'){av=cName(a.clients);bv=cName(b.clients)}
      else if(sortField==='bdl'){av=a.profiles?.full_name||'';bv=b.profiles?.full_name||''}
      else{av=a[sortField]??'';bv=b[sortField]??''}
      if(typeof av==='string') return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av)
      return sortDir==='asc'?av-bv:bv-av
    })
    return r
  }, [jobs,filterStatus,filterMonth,search,filterPayment,filterSource,filterService,filterCertStatus,sortField,sortDir])

  function Th({label,field}) {
    const on = sortField===field
    return <th onClick={()=>on?setSortDir(d=>d==='asc'?'desc':'asc'):(setSortField(field),setSortDir('asc'))} style={{cursor:'pointer',padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:`1px solid ${C.border}`,background:C.surface,color:on?C.accent:C.muted,whiteSpace:'nowrap',userSelect:'none'}}>{label} <span style={{opacity:0.5}}>{on?(sortDir==='asc'?'▲':'▼'):'↕'}</span></th>
  }
  const Td = ({children,style:s={}}) => <td style={{padding:'9px 12px',borderBottom:`1px solid ${C.border}`,fontSize:12,verticalAlign:'middle',...s}}>{children}</td>
  const badge = (text,color,bg) => <span style={{background:bg,color,borderRadius:5,padding:'2px 7px',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>{text}</span>
  const inp = {background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:'8px 12px',fontSize:13,width:'100%'}
  const lbl = {color:C.muted,fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}

  async function deleteJob(jobId) {
    if (!window.confirm('Delete this job? This cannot be undone.')) return
    const { error } = await supabase.from('jobs').delete().eq('id', jobId)
    if (error) { showToast(error.message, 'error'); return }
    setJobs(p => p.filter(j => j.id !== jobId))
    showToast('Job deleted')
  }

  async function createJob() {
    if(!form.title){showToast('Title required','error');return}
    setSaving(true)
    const p={title:form.title,source:'manual'}
    if(form.client_id) p.client_id=form.client_id
    p.assigned_to=form.assigned_to||profile.id
    if(form.service_types?.length) p.service_types=form.service_types
    if(form.scheduled_date) p.scheduled_date=form.scheduled_date
    if(form.scheduled_slot) p.scheduled_slot=form.scheduled_slot
    if(form.site_address) p.site_address=form.site_address
    if(form.detail_of_service) p.detail_of_service=form.detail_of_service
    if(form.tenant_name) p.tenant_name=form.tenant_name
    if(form.tenant_phone) p.tenant_phone=form.tenant_phone
    if(form.job_source_type) p.job_source_type=form.job_source_type
    if(form.engineer_name) p.engineer_name=form.engineer_name
    const {data:job,error}=await supabase.from('jobs').insert(p).select('id,job_number').single()
    if(error){setSaving(false);showToast(error.message,'error');return}
    setSaving(false);setShowNew(false);setForm(blank);await load()
    showToast('Job '+job.job_number+' created ✓')
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:C.text}}>Jobs</h1>
          <div style={{color:C.muted,fontSize:13,marginTop:2}}>{jobs.length} total · {rows.length} shown</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <div style={{display:'flex',background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
            {[['list','☰ List'],['board','▦ Board'],['monthly','📅 Monthly']].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{padding:'7px 14px',border:'none',background:tab===k?C.accent:'transparent',color:tab===k?'#fff':C.muted,cursor:'pointer',fontSize:12,fontWeight:tab===k?700:400}}>{l}</button>
            ))}
          </div>
          <button onClick={()=>setShowNew(true)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontWeight:700,fontSize:13,cursor:'pointer'}}>+ New Job</button>
        </div>
      </div>

      {isAdmin&&bdl.length>0&&tab!=='monthly'&&(
        <div style={{display:'flex',gap:10,marginBottom:16,overflowX:'auto'}}>
          {bdl.map(([name,d])=>(
            <div key={name} style={{background:'#fff',border:`1px solid ${C.border}`,borderTop:`3px solid ${C.accent}`,borderRadius:10,padding:'10px 16px',minWidth:140,flexShrink:0}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4}}>{name.split(' ')[0]}</div>
              <div style={{fontSize:16,fontWeight:800,color:C.greenDark}}>{fmt(d.profit)}</div>
              <div style={{fontSize:11,color:C.dim}}>{d.jobs} jobs · {fmt(d.revenue)}</div>
            </div>
          ))}
        </div>
      )}

      {tab==='monthly'&&(
        <div>
          {monthly.map(m=>(
            <div key={m.key} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,marginBottom:12,overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',background:C.surface,borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:'flex',gap:12,alignItems:'center'}}>
                  <span style={{fontWeight:800,color:C.text,fontSize:15}}>{m.label}</span>
                  <span style={{background:C.accentSoft,color:C.accent,borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:700}}>{m.total} jobs</span>
                </div>
                <div style={{display:'flex',gap:16}}>
                  <span style={{fontSize:13,color:C.greenDark,fontWeight:700}}>Revenue: {fmt(m.revenue)}</span>
                  <span style={{fontSize:13,color:C.teal,fontWeight:700}}>Profit: {fmt(m.profit)}</span>
                </div>
              </div>
              <div style={{display:'flex'}}>
                {[['Completed',C.greenDark,C.greenSoft],['Confirmed',C.accent,C.accentSoft],['In Progress','#0284C7','#DBEAFE'],['New',C.muted,C.surface],['Declined',C.red,C.redSoft]].map(([s,c,bg])=>(
                  <div key={s} onClick={()=>{setFilterMonth(m.key);setFilterStatus(s);setTab('list')}} style={{flex:1,padding:'10px 0',textAlign:'center',cursor:'pointer',background:m[s]>0?bg:'#fff',borderRight:`1px solid ${C.border}`}}>
                    <div style={{fontSize:20,fontWeight:800,color:m[s]>0?c:C.dim}}>{m[s]||0}</div>
                    <div style={{fontSize:10,color:m[s]>0?c:C.dim,textTransform:'uppercase',letterSpacing:'0.04em'}}>{s}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab!=='monthly'&&(
        <>
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs…" style={{...inp,flex:1,minWidth:180,width:'auto',padding:'8px 12px'}}/>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Statuses</option>
              {STATUSES.map(s=><option key={s}>{s}</option>)}
            </select>
            <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="all">All Months</option>
              {monthly.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={filterPayment} onChange={e=>setFilterPayment(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Payments</option>
              <option value="Paid">Paid</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
            </select>
            <select value={filterSource} onChange={e=>setFilterSource(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Sources</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select value={filterService} onChange={e=>setFilterService(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Services</option>
              <option value="EICR">EICR</option>
              <option value="Gas Safety">Gas Safety (CP12)</option>
              <option value="EPC">EPC</option>
              <option value="FRA">Fire Risk Assessment</option>
              <option value="FSC">Fire Safety Certificate</option>
              <option value="PAT">PAT Testing</option>
              <option value="Asbestos">Asbestos Survey</option>
              <option value="Fuse Box">Fuse Box</option>
              <option value="Remedial">Remedial Works</option>
            </select>
            <select value={filterCertStatus} onChange={e=>setFilterCertStatus(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Certificates</option>
              <option value="Not Issued">Not Issued</option>
              <option value="Issued">Issued</option>
              <option value="Delivered">Delivered</option>
            </select>
            {(filterStatus!=='All'||filterMonth!=='all'||search||filterPayment!=='All'||filterSource!=='All'||filterService!=='All'||filterCertStatus!=='All')&&<button onClick={()=>{setFilterStatus('All');setFilterMonth('all');setSearch('');setFilterPayment('All');setFilterSource('All');setFilterService('All');setFilterCertStatus('All')}} style={{background:C.redSoft,color:C.red,border:`1px solid ${C.red}44`,borderRadius:8,padding:'8px 12px',fontWeight:600,fontSize:12,cursor:'pointer'}}>✕ Clear Filters</button>}
            <span style={{fontSize:12,color:C.dim}}>Showing {rows.length} of {jobs.length} jobs</span>
          </div>

          {loading ? <div style={{padding:48,textAlign:'center',color:C.muted}}>Loading jobs…</div> :
          tab==='board' ? (
            <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:16,alignItems:'flex-start'}}>
              {STATUSES.map(status=>{
                const ss=SS[status]; const sj=rows.filter(j=>j.status===status)
                return <div key={status} style={{minWidth:220,flex:'0 0 220px'}}>
                  <div style={{background:ss.bg,borderLeft:`4px solid ${ss.color}`,borderRadius:8,padding:'8px 12px',marginBottom:10,display:'flex',justifyContent:'space-between'}}>
                    <span style={{color:ss.color,fontWeight:700,fontSize:13}}>{status}</span>
                    <span style={{background:'#fff',color:ss.color,border:`1px solid ${ss.color}44`,borderRadius:20,padding:'1px 8px',fontSize:12,fontWeight:700}}>{sj.length}</span>
                  </div>
                  {sj.map(j=><div key={j.id} onClick={()=>navigate('/jobs/'+j.id)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8,cursor:'pointer'}}>
                    <div style={{fontSize:11,color:C.accent,fontWeight:700,marginBottom:3}}>{j.job_number}</div>
                    <div style={{fontWeight:600,fontSize:13,color:C.text,marginBottom:2}}>{cName(j.clients)}</div>
                    <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{j.title}</div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}>
                      <span style={{color:C.greenDark,fontWeight:600}}>{j.amount_received>0?fmt(j.amount_received):''}</span>
                      <span style={{color:C.dim}}>{fmtD(j.scheduled_date)}</span>
                    </div>
                  </div>)}
                  {sj.length===0&&<div style={{textAlign:'center',padding:'16px 0',color:C.dim,fontSize:12,background:C.surface,borderRadius:8,border:`1px dashed ${C.border}`}}>Empty</div>}
                </div>
              })}
            </div>
          ) : (
            <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'auto'}}>
              {rows.length===0 ? <div style={{padding:48,textAlign:'center',color:C.muted}}>No jobs found.</div> : (
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:1600}}>
                  <thead>
                    <tr>
                      <Th label="Job #" field="job_number"/>
                      <Th label="Date" field="scheduled_date"/>
                      <Th label="Client" field="client"/>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Service</th>
                      <Th label="BDL" field="bdl"/>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Detail</th>
                      <Th label="Status" field="status"/>
                      <Th label="Received" field="amount_received"/>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Payment</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Work Done</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Cert</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Cert Status</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Remedial</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>⭐</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}}>Engineer</th>
                      <Th label="Eng Paid" field="engineer_paid_amount"/>
                      <Th label="Profit" field="gross_profit"/>
                      <th style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', borderBottom:'1px solid #E5E7EB', background:'#F5F7FA', color:'#6B7280' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(j=>{
                      const ss=SS[j.status]||{color:C.muted,bg:C.surface}
                      return <tr key={j.id} onClick={()=>navigate('/jobs/'+j.id)} style={{cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background=C.surface} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                        <Td><span style={{color:C.accent,fontWeight:700,fontSize:11}}>{j.job_number}</span>{j.auto_generated&&<span style={{background:C.tealSoft,color:C.teal,borderRadius:3,padding:'1px 3px',fontSize:8,marginLeft:4}}>AUTO</span>}</Td>
                        <Td><span style={{color:C.dim,fontSize:11}}>{fmtD(j.scheduled_date)}</span></Td>
                        <Td><span style={{fontWeight:600,color:C.text}}>{cName(j.clients)}</span></Td>
                        <Td><span style={{fontSize:11,color:C.muted}}>{(j.service_types||[]).join(', ')||'—'}</span></Td>
                        <Td><span style={{fontSize:11}}>{j.profiles?.full_name||'—'}</span></Td>
                        <Td><span style={{fontSize:11,color:C.muted}}>{j.detail_of_service||'—'}</span></Td>
                        <Td>{badge(j.status,ss.color,ss.bg)}</Td>
                        <Td><span style={{color:C.greenDark,fontWeight:700}}>{j.amount_received>0?fmt(j.amount_received):'—'}</span></Td>
                        <Td>{badge(j.payment_status||'Unpaid',j.payment_status==='Paid'?C.greenDark:C.amber,j.payment_status==='Paid'?C.greenSoft:C.amberSoft)}</Td>
                        <Td><span style={{fontSize:11,color:C.muted}}>{j.work_done||'—'}</span></Td>
                        <Td style={{textAlign:'center'}}><span style={{color:j.certificate_sent?C.greenDark:C.dim}}>{j.certificate_sent?'✓':'—'}</span></Td>
                        <Td><span style={{fontSize:11,color:C.muted}}>{j.certificate_status||'—'}</span></Td>
                        <Td style={{textAlign:'center'}}><span style={{color:j.remedial_quotation_sent?C.greenDark:C.dim}}>{j.remedial_quotation_sent?'✓':'—'}</span></Td>
                        <Td style={{textAlign:'center'}}><span style={{color:j.google_review_requested?C.amber:C.dim}}>{j.google_review_requested?'⭐':'—'}</span></Td>
                        <Td><span style={{fontSize:11,color:C.muted}}>{j.engineer_name||'—'}</span></Td>
                        <Td><span style={{fontSize:11}}>{j.engineer_paid_amount>0?fmt(j.engineer_paid_amount):'—'}</span></Td>
                        <Td><span style={{fontWeight:700,color:Number(j.gross_profit)>0?C.greenDark:Number(j.gross_profit)<0?C.red:C.dim}}>{j.gross_profit!=null?fmt(j.gross_profit):'—'}</span></Td>
                        <td style={{ padding:'9px 12px', borderBottom:'1px solid #E5E7EB' }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteJob(j.id)}
                            style={{ background:'#FEE2E2', color:'#DC2626', border:'1px solid #DC262644', borderRadius:6, padding:'4px 8px', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {showNew&&(
        <div style={{position:'fixed',inset:0,background:'#00000066',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={()=>{setShowNew(false);setShowClientDrop(false)}}>
          <div style={{background:'#fff',borderRadius:16,padding:32,width:640,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:20}}>New Job</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
              <div style={{ gridColumn:'span 2', position:'relative' }}>
                <label style={lbl}>Client</label>
                <input
                  value={clientSearch || (form.client_id ? cName(clients.find(c=>c.id===form.client_id)) : '')}
                  onChange={e => { setClientSearch(e.target.value); setShowClientDrop(true); if(!e.target.value) sf('client_id','') }}
                  onFocus={() => setShowClientDrop(true)}
                  placeholder="Search or add new client…"
                  style={inp}
                />
                {showClientDrop && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid #E5E7EB', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:50, maxHeight:240, overflowY:'auto', marginTop:4 }}>
                    <button type="button" onClick={() => { setShowAddClient(true); setShowClientDrop(false) }}
                      style={{ display:'block', width:'100%', textAlign:'left', padding:'10px 14px', border:'none', borderBottom:'2px solid #E5E7EB', background:'#E6F4FC', cursor:'pointer', fontSize:13, fontWeight:700, color:'#0093DB' }}>
                      + Add New Client
                    </button>
                    {clients
                      .filter(c => { if(!clientSearch) return true; const q=clientSearch.toLowerCase(); return (c.company_name||'').toLowerCase().includes(q)||(c.first_name||'').toLowerCase().includes(q)||(c.last_name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q) })
                      .slice(0,20)
                      .map(c => (
                        <button key={c.id} type="button"
                          onClick={() => { sf('client_id',c.id); sf('site_address',[c.street_address,c.city,c.postcode].filter(Boolean).join(', ')); setClientSearch(cName(c)); setShowClientDrop(false) }}
                          style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 14px', border:'none', borderBottom:'1px solid #F5F7FA', background:'none', cursor:'pointer', fontSize:13 }}
                          onMouseEnter={e=>e.currentTarget.style.background='#F5F7FA'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <div style={{ fontWeight:600, color:'#1F2937' }}>{cName(c)}</div>
                          {c.email && <div style={{ fontSize:11, color:'#9CA3AF' }}>{c.email}</div>}
                        </button>
                      ))
                    }
                    {clients.filter(c => { if(!clientSearch) return true; const q=clientSearch.toLowerCase(); return (c.company_name||'').toLowerCase().includes(q)||(c.first_name||'').toLowerCase().includes(q) }).length === 0 && (
                      <div style={{ padding:14, textAlign:'center', color:'#9CA3AF', fontSize:13 }}>
                        No match — <button type="button" onClick={() => { setShowAddClient(true); setShowClientDrop(false) }}
                          style={{ background:'none', border:'none', color:'#0093DB', cursor:'pointer', fontWeight:700, fontSize:13 }}>create new client</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {showAddClient && (
                <div style={{ gridColumn:'span 2', background:'#F5F7FA', border:'1px solid #E5E7EB', borderRadius:12, padding:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:'#1F2937' }}>Quick Add Client</span>
                    <button type="button" onClick={() => setShowAddClient(false)} style={{ background:'none', border:'none', color:'#9CA3AF', cursor:'pointer', fontSize:18 }}>✕</button>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div><label style={lbl}>First Name *</label><input value={nc.first_name} onChange={e=>setNc(p=>({...p,first_name:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>Last Name</label><input value={nc.last_name} onChange={e=>setNc(p=>({...p,last_name:e.target.value}))} style={inp}/></div>
                    <div style={{gridColumn:'span 2'}}><label style={lbl}>Company</label><input value={nc.company_name} onChange={e=>setNc(p=>({...p,company_name:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>Email</label><input value={nc.email} onChange={e=>setNc(p=>({...p,email:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>Phone</label><input value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))} style={inp}/></div>
                    <div style={{gridColumn:'span 2'}}><label style={lbl}>Address</label><input value={nc.street_address} onChange={e=>setNc(p=>({...p,street_address:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>City</label><input value={nc.city} onChange={e=>setNc(p=>({...p,city:e.target.value}))} style={inp}/></div>
                    <div><label style={lbl}>Postcode</label><input value={nc.postcode} onChange={e=>setNc(p=>({...p,postcode:e.target.value}))} style={inp}/></div>
                  </div>
                  <button type="button" onClick={createQuickClient}
                    style={{ marginTop:12, background:'#0093DB', color:'#fff', border:'none', borderRadius:8, padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                    ✓ Create & Select
                  </button>
                </div>
              )}
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Job Title *</label><input value={form.title} onChange={e=>sf('title',e.target.value)} placeholder="e.g. EICR + GSC — 2-bed flat" style={inp}/></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Services</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {SVCS.map(s=><button key={s} type="button" onClick={()=>tog(s)} style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${form.service_types.includes(s)?C.accent:C.border}`,background:form.service_types.includes(s)?C.accentSoft:'#fff',color:form.service_types.includes(s)?C.accent:C.muted,cursor:'pointer',fontSize:12,fontWeight:form.service_types.includes(s)?700:400}}>{s}</button>)}
                </div></div>
              <div><label style={lbl}>Assigned BDL</label><select value={form.assigned_to} onChange={e=>sf('assigned_to',e.target.value)} style={inp}><option value="">— Select —</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
              <div><label style={lbl}>Type</label><select value={form.job_source_type} onChange={e=>sf('job_source_type',e.target.value)} style={inp}><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
              <div style={{gridColumn:'span 2'}}>
                <label style={lbl}>Engineer Name</label>
                <input value={form.engineer_name} onChange={e=>sf('engineer_name',e.target.value)} placeholder="Enter engineer name (not the BDL)…" style={inp}/>
                <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>The person who physically does the inspection (not the assigned BDL) — leave blank until known</div>
              </div>
              <div><label style={lbl}>Scheduled Date</label><input type="date" value={form.scheduled_date} onChange={e=>sf('scheduled_date',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Time Slot</label><select value={form.scheduled_slot} onChange={e=>sf('scheduled_slot',e.target.value)} style={inp}><option value="">—</option><option>Morning (8am–12pm)</option><option>Afternoon (12pm–6pm)</option></select></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Site Address</label><input value={form.site_address} onChange={e=>sf('site_address',e.target.value)} style={inp}/></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Detail of Service</label><input value={form.detail_of_service} onChange={e=>sf('detail_of_service',e.target.value)} placeholder="Additional details…" style={inp}/></div>
              <div><label style={lbl}>Tenant Name</label><input value={form.tenant_name} onChange={e=>sf('tenant_name',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Tenant Phone</label><input value={form.tenant_phone} onChange={e=>sf('tenant_phone',e.target.value)} style={inp}/></div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:24}}>
              <button onClick={createJob} disabled={saving} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'10px 24px',fontWeight:700,fontSize:14,cursor:'pointer',opacity:saving?0.7:1}}>{saving?'Creating…':'Create Job'}</button>
              <button onClick={()=>setShowNew(false)} style={{background:'#fff',color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 18px',fontWeight:600,fontSize:14,cursor:'pointer'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <Toast toast={toast}/>
    </div>
  )
}
