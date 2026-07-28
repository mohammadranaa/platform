import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast, Toast } from '../hooks/useToast.jsx'

const C = {
  bg:'#FFFFFF',surface:'#F5F7FA',border:'#E5E7EB',
  accent:'#0093DB',accentSoft:'#E6F4FC',
  green:'#80D100',greenSoft:'#F0FAE0',greenDark:'#3d7a00',
  amber:'#D97706',amberSoft:'#FEF3C7',
  red:'#DC2626',redSoft:'#FEE2E2',
  purple:'#7C3AED',
  teal:'#0D9488',tealSoft:'#CCFBF1',
  text:'#1F2937',muted:'#6B7280',dim:'#9CA3AF',
}
const JOB_STATUSES=['New','In Progress','Confirmed','Completed','Declined']
const STATUS_STYLE={'New':{color:'#6B7280',bg:'#F5F7FA'},'In Progress':{color:'#0284C7',bg:'#DBEAFE'},'Confirmed':{color:C.accent,bg:C.accentSoft},'Completed':{color:C.greenDark,bg:C.greenSoft},'Declined':{color:C.red,bg:C.redSoft}}
const MLC_SERVICES=['EICR','GSC (CP12)','EPC','FRA','FSC','PAT Testing','Remedial Works','Consumer Unit','Diagnostics','Asbestos Survey','Fire Alarm','Boiler Installation','Other']
const fmt=v=>'£'+Number(v||0).toLocaleString('en-GB',{minimumFractionDigits:2})
const fmtDate=d=>d?new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}):'—'
const clientName=c=>c?.company_name||[c?.first_name,c?.last_name].filter(Boolean).join(' ')||'—'

export default function Jobs() {
  const {profile,isAdmin}=useAuth()
  const navigate=useNavigate()
  const {toast,showToast}=useToast()
  const [jobs,setJobs]=useState([])
  const [clients,setClients]=useState([])
  const [profiles,setProfiles]=useState([])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [viewMode,setViewMode]=useState('list')
  const [activeTab,setActiveTab]=useState('list')
  const [filterStatus,setFilterStatus]=useState('All')
  const [filterMonth,setFilterMonth]=useState('all')
  const [search,setSearch]=useState('')
  const [sortField,setSortField]=useState('created_at')
  const [sortDir,setSortDir]=useState('desc')
  const [showNew,setShowNew]=useState(false)
  const blank={title:'',service_types:[],scheduled_date:'',scheduled_slot:'',site_address:'',detail_of_service:'',tenant_name:'',tenant_phone:'',job_source_type:'inbound',client_id:'',assigned_to:''}
  const [form,setForm]=useState(blank)
  const set=(k,v)=>setForm(p=>({...p,[k]:v}))
  const toggleSvc=s=>set('service_types',form.service_types.includes(s)?form.service_types.filter(x=>x!==s):[...form.service_types,s])

  useEffect(()=>{fetchAll()},[])

  async function fetchAll(){
    setLoading(true)
    const [{data:j,error:je},{data:c},{data:p}]=await Promise.all([
      supabase.from('jobs').select('id,job_number,title,status,priority,scheduled_date,invoice_amount,payment_status,amount_received,service_types,client_id,assigned_to,auto_generated,engineer_name,engineer_paid_amount,gross_profit,certificate_status,certificate_sent,remedial_quotation_sent,google_review_requested,work_done,detail_of_service,job_source_type,site_address,created_at,clients(first_name,last_name,company_name),profiles(full_name)').order('created_at',{ascending:false}),
      supabase.from('clients').select('id,first_name,last_name,company_name,street_address,city,postcode').eq('is_active',true).order('company_name'),
      supabase.from('profiles').select('id,full_name').eq('is_active',true)
    ])
    if(je)console.error('Jobs error:',je)
    setJobs(j||[]);setClients(c||[]);setProfiles(p||[]);setLoading(false)
  }

  const monthlyStats=useMemo(()=>{
    const m={}
    jobs.forEach(j=>{
      const d=j.scheduled_date||j.created_at?.slice(0,10)
      if(!d)return
      const key=d.slice(0,7)
      const label=new Date(d+'T12:00:00').toLocaleDateString('en-GB',{month:'short',year:'numeric'})
      if(!m[key])m[key]={key,label,total:0,completed:0,confirmed:0,inProgress:0,declined:0,new:0,revenue:0,profit:0}
      m[key].total++
      if(j.status==='Completed')m[key].completed++
      if(j.status==='Confirmed')m[key].confirmed++
      if(j.status==='In Progress')m[key].inProgress++
      if(j.status==='Declined')m[key].declined++
      if(j.status==='New')m[key].new++
      m[key].revenue+=Number(j.amount_received||0)
      m[key].profit+=Number(j.gross_profit||0)
    })
    return Object.values(m).sort((a,b)=>b.key.localeCompare(a.key))
  },[jobs])

  const bdlSummary=useMemo(()=>{
    const s={}
    jobs.forEach(j=>{
      const n=j.profiles?.full_name||'Unassigned'
      if(!s[n])s[n]={jobs:0,revenue:0,profit:0}
      s[n].jobs++;s[n].revenue+=Number(j.amount_received||0);s[n].profit+=Number(j.gross_profit||0)
    })
    return Object.entries(s).sort((a,b)=>b[1].profit-a[1].profit)
  },[jobs])

  const filtered=useMemo(()=>{
    let r=[...jobs]
    if(filterStatus!=='All')r=r.filter(j=>j.status===filterStatus)
    if(filterMonth!=='all')r=r.filter(j=>{const d=j.scheduled_date||j.created_at?.slice(0,10);return d&&d.startsWith(filterMonth)})
    if(search){const q=search.toLowerCase();r=r.filter(j=>(j.title||'').toLowerCase().includes(q)||(j.job_number||'').toLowerCase().includes(q)||clientName(j.clients).toLowerCase().includes(q)||(j.site_address||'').toLowerCase().includes(q)||(j.engineer_name||'').toLowerCase().includes(q))}
    r.sort((a,b)=>{
      let av,bv
      if(sortField==='client'){av=clientName(a.clients);bv=clientName(b.clients)}
      else if(sortField==='bdl'){av=a.profiles?.full_name||'';bv=b.profiles?.full_name||''}
      else{av=a[sortField]??'';bv=b[sortField]??''}
      if(typeof av==='string')return sortDir==='asc'?av.localeCompare(bv):bv.localeCompare(av)
      return sortDir==='asc'?av-bv:bv-av
    })
    return r
  },[jobs,filterStatus,filterMonth,search,sortField,sortDir])

  function SortTh({label,field}){
    const active=sortField===field
    return <th onClick={()=>active?setSortDir(d=>d==='asc'?'desc':'asc'):(setSortField(field),setSortDir('asc'))} style={{cursor:'pointer',textAlign:'left',padding:'8px 12px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',borderBottom:`1px solid ${C.border}`,background:C.surface,color:active?C.accent:C.muted,whiteSpace:'nowrap',userSelect:'none'}}>{label} <span style={{color:active?C.accent:C.border}}>{active?(sortDir==='asc'?'▲':'▼'):'↕'}</span></th>
  }

  async function createJob(){
    if(!form.title){showToast('Title required','error');return}
    setSaving(true)
    const payload={title:form.title,source:'manual'}
    if(form.client_id)payload.client_id=form.client_id
    if(form.assigned_to)payload.assigned_to=form.assigned_to;else payload.assigned_to=profile.id
    if(form.service_types?.length)payload.service_types=form.service_types
    if(form.scheduled_date)payload.scheduled_date=form.scheduled_date
    if(form.scheduled_slot)payload.scheduled_slot=form.scheduled_slot
    if(form.site_address)payload.site_address=form.site_address
    if(form.detail_of_service)payload.detail_of_service=form.detail_of_service
    if(form.tenant_name)payload.tenant_name=form.tenant_name
    if(form.tenant_phone)payload.tenant_phone=form.tenant_phone
    if(form.job_source_type)payload.job_source_type=form.job_source_type
    const {data:job,error}=await supabase.from('jobs').insert(payload).select('id,job_number').single()
    if(error){setSaving(false);showToast(error.message,'error');return}
    setSaving(false);setShowNew(false);setForm(blank);await fetchAll()
    showToast('Job '+job.job_number+' created ✓')
  }

  const inp={background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,color:C.text,padding:'8px 12px',fontSize:13,width:'100%'}
  const lbl={color:C.muted,fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:4}
  const tdStyle={padding:'9px 12px',borderBottom:`1px solid ${C.border}`,fontSize:12,verticalAlign:'middle'}
  const thStyle={padding:'8px 12px',fontSize:10,fontWeight:700,textTransform:'uppercase',borderBottom:`1px solid ${C.border}`,background:C.surface,color:C.muted}

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:C.text}}>Jobs</h1>
          <div style={{color:C.muted,fontSize:13,marginTop:2}}>{jobs.length} total · {filtered.length} shown</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <div style={{display:'flex',background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
            {[['list','☰ List'],['board','▦ Board'],['monthly','📅 Monthly']].map(([m,l])=>(
              <button key={m} onClick={()=>{setViewMode(m==='monthly'?'list':m);setActiveTab(m)}} style={{padding:'7px 14px',border:'none',background:activeTab===m?C.accent:'transparent',color:activeTab===m?'#fff':C.muted,cursor:'pointer',fontSize:12,fontWeight:activeTab===m?700:400}}>{l}</button>
            ))}
          </div>
          <button onClick={()=>setShowNew(true)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px 18px',fontWeight:700,fontSize:13,cursor:'pointer'}}>+ New Job</button>
        </div>
      </div>

      {isAdmin&&bdlSummary.length>0&&activeTab!=='monthly'&&(
        <div style={{display:'flex',gap:10,marginBottom:16,overflowX:'auto'}}>
          {bdlSummary.map(([bdl,d])=>(
            <div key={bdl} style={{background:'#fff',border:`1px solid ${C.border}`,borderTop:`3px solid ${C.accent}`,borderRadius:10,padding:'10px 16px',minWidth:140,flexShrink:0}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bdl}</div>
              <div style={{fontSize:16,fontWeight:800,color:C.greenDark}}>{fmt(d.profit)}</div>
              <div style={{fontSize:11,color:C.dim}}>{d.jobs} jobs · {fmt(d.revenue)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab==='monthly'&&(
        <div>
          {monthlyStats.map(m=>(
            <div key={m.key} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,marginBottom:12,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:C.surface,borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontWeight:800,color:C.text,fontSize:15}}>{m.label}</span>
                  <span style={{background:C.accentSoft,color:C.accent,borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:700}}>{m.total} jobs</span>
                </div>
                <div style={{display:'flex',gap:16}}>
                  <span style={{fontSize:13,color:C.greenDark,fontWeight:700}}>Revenue: {fmt(m.revenue)}</span>
                  <span style={{fontSize:13,color:C.teal,fontWeight:700}}>Profit: {fmt(m.profit)}</span>
                </div>
              </div>
              <div style={{display:'flex'}}>
                {[{l:'Completed',v:m.completed,c:C.greenDark,bg:C.greenSoft,s:'Completed'},{l:'Confirmed',v:m.confirmed,c:C.accent,bg:C.accentSoft,s:'Confirmed'},{l:'In Progress',v:m.inProgress,c:'#0284C7',bg:'#DBEAFE',s:'In Progress'},{l:'New',v:m.new,c:C.muted,bg:C.surface,s:'New'},{l:'Declined',v:m.declined,c:C.red,bg:C.redSoft,s:'Declined'}].map(s=>(
                  <div key={s.l} onClick={()=>{setFilterMonth(m.key);setFilterStatus(s.s);setActiveTab('list');setViewMode('list')}}
                    style={{flex:1,padding:'10px 0',textAlign:'center',cursor:'pointer',background:s.v>0?s.bg:'#fff',borderRight:`1px solid ${C.border}`}}>
                    <div style={{fontSize:20,fontWeight:800,color:s.v>0?s.c:C.dim}}>{s.v}</div>
                    <div style={{fontSize:10,color:s.v>0?s.c:C.dim,textTransform:'uppercase',letterSpacing:'0.04em'}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab!=='monthly'&&(
        <>
          <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs…" style={{...inp,flex:1,minWidth:180,width:'auto',padding:'8px 12px'}}/>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="All">All Statuses</option>
              {JOB_STATUSES.map(s=><option key={s}>{s}</option>)}
            </select>
            <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp,width:'auto'}}>
              <option value="all">All Months</option>
              {monthlyStats.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            {(filterStatus!=='All'||filterMonth!=='all'||search)&&(
              <button onClick={()=>{setFilterStatus('All');setFilterMonth('all');setSearch('')}} style={{background:C.redSoft,color:C.red,border:`1px solid ${C.red}44`,borderRadius:8,padding:'8px 14px',fontWeight:600,fontSize:12,cursor:'pointer'}}>✕ Clear</button>
            )}
          </div>

          {loading?<div style={{padding:48,textAlign:'center',color:C.muted}}>Loading jobs…</div>:
          viewMode==='board'?(
            <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:16,alignItems:'flex-start'}}>
              {JOB_STATUSES.map(status=>{
                const ss=STATUS_STYLE[status]||{color:C.muted,bg:C.surface}
                const sj=filtered.filter(j=>j.status===status)
                return(
                  <div key={status} style={{minWidth:220,flex:'0 0 220px'}}>
                    <div style={{background:ss.bg,border:`1px solid ${ss.color}33`,borderLeft:`4px solid ${ss.color}`,borderRadius:8,padding:'8px 12px',marginBottom:10,display:'flex',justifyContent:'space-between'}}>
                      <span style={{color:ss.color,fontWeight:700,fontSize:13}}>{status}</span>
                      <span style={{background:'#fff',color:ss.color,border:`1px solid ${ss.color}44`,borderRadius:20,padding:'1px 8px',fontSize:12,fontWeight:700}}>{sj.length}</span>
                    </div>
                    {sj.map(job=>(
                      <div key={job.id} onClick={()=>navigate('/jobs/'+job.id)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8,cursor:'pointer'}}>
                        <div style={{fontSize:11,color:C.accent,fontWeight:700,marginBottom:3}}>{job.job_number}{job.auto_generated&&<span style={{background:C.tealSoft,color:C.teal,borderRadius:4,padding:'1px 4px',fontSize:9,marginLeft:5}}>AUTO</span>}</div>
                        <div style={{fontWeight:600,fontSize:13,color:C.text,marginBottom:2}}>{clientName(job.clients)}</div>
                        <div style={{color:C.muted,fontSize:11,marginBottom:4}}>{job.title}</div>
                        <div style={{display:'flex',justifyContent:'space-between',fontSize:11}}>
                          <span style={{color:C.greenDark,fontWeight:600}}>{job.amount_received>0?fmt(job.amount_received):''}</span>
                          <span style={{color:C.dim}}>{fmtDate(job.scheduled_date)}</span>
                        </div>
                      </div>
                    ))}
                    {sj.length===0&&<div style={{textAlign:'center',padding:'16px 0',color:C.dim,fontSize:12,background:C.surface,borderRadius:8,border:`1px dashed ${C.border}`}}>Empty</div>}
                  </div>
                )
              })}
            </div>
          ):(
            <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'auto'}}>
              {filtered.length===0?<div style={{padding:48,textAlign:'center',color:C.muted}}>No jobs found.</div>:(
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:1600}}>
                  <thead>
                    <tr>
                      <SortTh label="Job #"    field="job_number"/>
                      <SortTh label="Date"     field="scheduled_date"/>
                      <SortTh label="Client"   field="client"/>
                      <th style={thStyle}>Service</th>
                      <SortTh label="BDL"      field="bdl"/>
                      <th style={thStyle}>Detail</th>
                      <SortTh label="Status"   field="status"/>
                      <SortTh label="Received" field="amount_received"/>
                      <th style={thStyle}>Payment</th>
                      <th style={thStyle}>Work Done</th>
                      <th style={thStyle}>Cert</th>
                      <th style={thStyle}>Cert Status</th>
                      <th style={thStyle}>Remedial</th>
                      <th style={thStyle}>⭐</th>
                      <th style={thStyle}>Engineer</th>
                      <SortTh label="Eng Paid" field="engineer_paid_amount"/>
                      <SortTh label="GP"       field="gross_profit"/>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(job=>{
                      const ss=STATUS_STYLE[job.status]||{color:C.muted,bg:C.surface}
                      return(
                        <tr key={job.id} onClick={()=>navigate('/jobs/'+job.id)} style={{cursor:'pointer'}}
                          onMouseEnter={e=>e.currentTarget.style.background=C.surface}
                          onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                          <td style={tdStyle}><span style={{color:C.accent,fontWeight:700,fontSize:11}}>{job.job_number}</span>{job.auto_generated&&<span style={{background:C.tealSoft,color:C.teal,borderRadius:3,padding:'1px 3px',fontSize:8,marginLeft:4}}>AUTO</span>}</td>
                          <td style={tdStyle}><span style={{color:C.dim,fontSize:11}}>{fmtDate(job.scheduled_date)}</span></td>
                          <td style={tdStyle}><span style={{fontWeight:600,color:C.text,fontSize:12}}>{clientName(job.clients)}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11,color:C.muted}}>{(job.service_types||[]).join(', ')||'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11}}>{job.profiles?.full_name?.split(' ')[0]||'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11,color:C.muted}}>{job.detail_of_service||'—'}</span></td>
                          <td style={tdStyle}><span style={{background:ss.bg,color:ss.color,borderRadius:5,padding:'2px 7px',fontSize:10,fontWeight:600}}>{job.status}</span></td>
                          <td style={tdStyle}><span style={{color:C.greenDark,fontWeight:700,fontSize:12}}>{job.amount_received>0?fmt(job.amount_received):'—'}</span></td>
                          <td style={tdStyle}><span style={{background:job.payment_status==='Paid'?C.greenSoft:C.amberSoft,color:job.payment_status==='Paid'?C.greenDark:C.amber,borderRadius:5,padding:'2px 6px',fontSize:10,fontWeight:600}}>{job.payment_status||'Unpaid'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11,color:C.muted}}>{job.work_done||'—'}</span></td>
                          <td style={{...tdStyle,textAlign:'center'}}><span style={{color:job.certificate_sent?C.greenDark:C.dim}}>{job.certificate_sent?'✓':'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11,color:C.muted}}>{job.certificate_status||'—'}</span></td>
                          <td style={{...tdStyle,textAlign:'center'}}><span style={{color:job.remedial_quotation_sent?C.greenDark:C.dim}}>{job.remedial_quotation_sent?'✓':'—'}</span></td>
                          <td style={{...tdStyle,textAlign:'center'}}><span style={{color:job.google_review_requested?C.amber:C.dim}}>{job.google_review_requested?'⭐':'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11,color:C.muted}}>{job.engineer_name||'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:11}}>{job.engineer_paid_amount>0?fmt(job.engineer_paid_amount):'—'}</span></td>
                          <td style={tdStyle}><span style={{fontSize:12,fontWeight:700,color:Number(job.gross_profit)>0?C.greenDark:Number(job.gross_profit)<0?C.red:C.dim}}>{job.gross_profit!=null?fmt(job.gross_profit):'—'}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {showNew&&(
        <div style={{position:'fixed',inset:0,background:'#00000066',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={()=>setShowNew(false)}>
          <div style={{background:'#fff',borderRadius:16,padding:32,width:640,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:C.text,marginBottom:20}}>New Job</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Client</label><select value={form.client_id} onChange={e=>{set('client_id',e.target.value);const c=clients.find(cl=>cl.id===e.target.value);if(c)set('site_address',[c.street_address,c.city,c.postcode].filter(Boolean).join(', '))}} style={inp}><option value="">— Select client —</option>{clients.map(c=><option key={c.id} value={c.id}>{clientName(c)}</option>)}</select></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Job Title *</label><input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. EICR + GSC — 2-bed flat" style={inp}/></div>
              <div style={{gridColumn:'span 2'}}>
                <label style={lbl}>Services</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {MLC_SERVICES.map(s=><button key={s} type="button" onClick={()=>toggleSvc(s)} style={{padding:'5px 12px',borderRadius:6,border:`1px solid ${form.service_types.includes(s)?C.accent:C.border}`,background:form.service_types.includes(s)?C.accentSoft:'#fff',color:form.service_types.includes(s)?C.accent:C.muted,cursor:'pointer',fontSize:12,fontWeight:form.service_types.includes(s)?700:400}}>{s}</button>)}
                </div>
              </div>
              <div><label style={lbl}>Assign BDL</label><select value={form.assigned_to} onChange={e=>set('assigned_to',e.target.value)} style={inp}><option value="">— Select —</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
              <div><label style={lbl}>Type</label><select value={form.job_source_type} onChange={e=>set('job_source_type',e.target.value)} style={inp}><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></div>
              <div><label style={lbl}>Scheduled Date</label><input type="date" value={form.scheduled_date} onChange={e=>set('scheduled_date',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Time Slot</label><select value={form.scheduled_slot} onChange={e=>set('scheduled_slot',e.target.value)} style={inp}><option value="">—</option><option>Morning (8am–12pm)</option><option>Afternoon (12pm–6pm)</option></select></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Site Address</label><input value={form.site_address} onChange={e=>set('site_address',e.target.value)} style={inp}/></div>
              <div style={{gridColumn:'span 2'}}><label style={lbl}>Detail of Service</label><input value={form.detail_of_service} onChange={e=>set('detail_of_service',e.target.value)} placeholder="Additional details…" style={inp}/></div>
              <div><label style={lbl}>Tenant Name</label><input value={form.tenant_name} onChange={e=>set('tenant_name',e.target.value)} style={inp}/></div>
              <div><label style={lbl}>Tenant Phone</label><input value={form.tenant_phone} onChange={e=>set('tenant_phone',e.target.value)} style={inp}/></div>
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
