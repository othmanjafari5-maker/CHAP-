import {useEffect,useState} from 'react';
import {request} from '../api';
import {useAuth} from '../auth-context';
const send=(path,body,method='POST')=>request(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const stamp=v=>v?new Date(v).toLocaleString():'Not set';
function useRows(path,version=0){
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();let timer;async function load(){try{const data=await request(path,{signal:c.signal});if(!c.signal.aborted){setRows(data);setError('');}}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(!c.signal.aborted)timer=setTimeout(load,10000);}}load();return()=>{c.abort();clearTimeout(timer);};},[path,version]);
  return [rows,error];
}
function Form({children,submit,label='Save',onDone}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function save(e){e.preventDefault();setBusy(true);setMessage('');const form=e.currentTarget;try{const result=await submit(Object.fromEntries(new FormData(form)));setMessage(result?.message||'Saved.');form.reset();onDone?.(result);}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  return <form onSubmit={save} className="workflow-form"><fieldset disabled={busy}>{children}<button className="primary-button">{busy?'Saving…':label}</button></fieldset>{message&&<p className="notice" role="status">{message}</p>}</form>;
}
const Field=({label,name,type='text',required=true,value,...props})=><label>{label}<input name={name} type={type} defaultValue={value} required={required} {...props}/></label>;
function Select({label,name,items,value,required=true}){return <label>{label}<select aria-label={label} name={name} defaultValue={value??''} required={required}><option value="">Choose…</option>{items.map(([v,title])=><option key={v} value={v}>{title}</option>)}</select></label>;}
const roles=['admin','dispatcher','mechanic','viewer'];

export function Administration({vehicles,onChange}){
  const [version,setVersion]=useState(0),[selected,setSelected]=useState(''),[issued,setIssued]=useState(null);
  const [users,error]=useRows('/api/users',version),[devices,deviceError]=useRows('/api/devices',version);
  const reload=()=>{setVersion(v=>v+1);onChange();};
  const a=vehicles.find(v=>v.id===Number(selected));
  return <><section className="panel"><h2>Fleet administration</h2><details><summary>Register ambulance</summary><Form submit={b=>send('/api/ambulances',b)} onDone={reload} label="Register vehicle"><Field name="code" label="Vehicle code" maxLength="50"/><Field name="registration" label="Registration" maxLength="100"/><Field name="hospital" label="Hospital / service area" maxLength="200"/></Form></details>
    <label>Manage vehicle<select value={selected} onChange={e=>{setSelected(e.target.value);setIssued(null);}}><option value="">Choose vehicle…</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.ambulance_code}</option>)}</select></label>
    {a&&<div key={a.id}><Form submit={b=>send(`/api/ambulances/${a.id}`,{...b,...(b.status?{}:{status:undefined})},'PATCH')} onDone={reload} label="Update vehicle"><Field name="registration" label="Registration" value={a.registration_number}/><Field name="hospital" label="Hospital" value={a.hospital_name}/><Select label="Operational status (optional)" name="status" required={false} items={['available','maintenance','retired'].map(v=>[v,v])}/></Form><p>Current state: {a.status}. Mission and workshop restrictions are checked before status changes.</p>
    <h3>Device access</h3><p>Device: {devices.find(d=>d.ambulance_id===a.id)?.name||'Not enrolled'} · {devices.find(d=>d.ambulance_id===a.id)?.active?'Enabled':'Disabled'}</p>
    <Form label="Issue / rotate device key" submit={b=>send(`/api/ambulances/${a.id}/device`,b)} onDone={result=>{setIssued(result.token);reload();}}><Field name="name" label="Device name"/></Form>
    {issued&&<div className="notice"><strong>Copy this key to the device now. It is shown once.</strong><textarea readOnly aria-label="New device key" value={issued}/><button className="secondary-button" onClick={()=>setIssued(null)}>Hide key</button></div>}
    <Form label="Revoke device access" submit={()=>send(`/api/ambulances/${a.id}/device/revoke`,{})} onDone={()=>{setIssued(null);reload();}}><p>Revoking stops new telemetry uploads from this device.</p></Form></div>}
    {(error||deviceError)&&<p role="alert">{error||deviceError}</p>}</section>
    <section className="panel"><h2>User accounts</h2><details><summary>Create account</summary><Form submit={b=>send('/api/users',b)} onDone={reload} label="Create account"><Field label="Username" name="username" autoComplete="off"/><Field label="Full name" name="displayName"/><Field label="Initial password" name="password" type="password" minLength="12" maxLength="128" autoComplete="new-password"/><Select label="Role" name="role" items={roles.map(r=>[r,r])}/></Form></details>
    {users.map(u=><details key={u.id}><summary>{u.display_name} · {u.role} · {u.active?'Active':'Disabled'}</summary><Form label="Update account" submit={b=>send(`/api/users/${u.id}`,{role:b.role,active:b.active==='true',...(b.password?{password:b.password}:{})},'PATCH')} onDone={reload}><Select name="role" label="Role" value={u.role} items={roles.map(r=>[r,r])}/><Select name="active" label="Account status" value={String(u.active)} items={[["true","Active"],["false","Disabled"]]}/><Field name="password" label="Reset password (optional)" type="password" minLength="12" maxLength="128" required={false} autoComplete="new-password"/><p>Updating an account ends its existing sessions.</p></Form></details>)}</section></>;
}

export function WorkOrderBoard({vehicles,onChange,onVehicle}){
  const {can}=useAuth();const [version,setVersion]=useState(0);
  const [jobs,error]=useRows('/api/work-orders',version),[users]=useRows('/api/users');
  const reload=()=>{setVersion(v=>v+1);onChange();};
  return <section className="panel"><h2>Maintenance jobs</h2><p>Open → in progress → completed. Record the service before closing a job; inspection holds remain independent.</p>
    {can('admin','mechanic')&&<details><summary>Create work order</summary><Form label="Create work order" submit={b=>send('/api/work-orders',{...b,ambulanceId:Number(b.ambulanceId),technicianId:b.technicianId?Number(b.technicianId):null})} onDone={reload}><Select label="Ambulance" name="ambulanceId" items={vehicles.map(a=>[a.id,a.ambulance_code])}/><Field label="Work required" name="title" maxLength="200"/><Select label="Assigned technician" name="technicianId" required={false} items={users.filter(u=>u.active&&['admin','mechanic'].includes(u.role)).map(u=>[u.id,u.display_name])}/><Field label="Expected completion" name="expectedCompletion" type="datetime-local" required={false}/><Field label="Notes" name="notes" required={false} maxLength="3000"/></Form></details>}
    {error&&<p role="alert">{error}</p>}{!jobs.length&&<p>No work orders yet.</p>}
    {jobs.map(j=><details key={j.id}><summary>#{j.id} · {j.ambulance_code} · {j.title} · {j.status.replaceAll('_',' ')}</summary><p>Technician: {j.technician||'Unassigned'} · Expected return: {stamp(j.expected_completion)}</p><p>{j.notes}</p><button className="secondary-button" onClick={()=>onVehicle(j.ambulance_id)}>Service records & inspection</button>
      {can('admin','mechanic')&&['open','in_progress'].includes(j.status)&&<Form label="Update work order" submit={b=>send(`/api/work-orders/${j.id}/transition`,{...b,serviceRecordId:b.serviceRecordId?Number(b.serviceRecordId):undefined})} onDone={reload}><Select label="Next status" name="status" items={(j.status==='open'?['in_progress','cancelled']:['completed','cancelled']).map(s=>[s,s.replaceAll('_',' ')])}/><Field label="Work / cancellation notes" name="notes" maxLength="3000"/><Field label="Service record ID (required to complete)" name="serviceRecordId" type="number" min="1" required={false}/></Form>}
      {can('admin','mechanic')&&['open','in_progress'].includes(j.status)&&<details><summary>Change technician / expected completion</summary><Form label="Update schedule" submit={b=>send(`/api/work-orders/${j.id}`,{technicianId:b.technicianId?Number(b.technicianId):null,expectedCompletion:b.expectedCompletion||null},'PATCH')} onDone={reload}><Select name="technicianId" label="Technician" value={j.technician_id||''} required={false} items={users.filter(u=>u.active&&['admin','mechanic'].includes(u.role)).map(u=>[u.id,u.display_name])}/><Field name="expectedCompletion" label="New expected completion (blank removes estimate)" type="datetime-local" required={false}/></Form></details>}
      {j.completion_notes&&<p>{j.completion_notes}</p>}
    </details>)}</section>;
}

export function IncidentBoard({onChange,onVehicle}){
  const {can}=useAuth();const [version,setVersion]=useState(0),[selected,setSelected]=useState(null),[recommendation,setRecommendation]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [incidents,error]=useRows('/api/incidents',version);
  const reload=()=>{setVersion(v=>v+1);onChange();setRecommendation(null);};
  const active=incidents.find(i=>i.id===selected);
  async function recommend(i){setBusy(true);setMessage('');setRecommendation(null);try{const result=await send('/api/dispatch/recommendations',{latitude:Number(i.latitude),longitude:Number(i.longitude)});setRecommendation({...result,incidentId:i.id});}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function assign(ambulanceId){setBusy(true);try{await send(`/api/incidents/${active.id}/assign`,{ambulanceId});setMessage('Vehicle assigned. Mission is now active.');reload();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  const flow={open:['cancelled'],assigned:['en_route','cancelled'],en_route:['on_scene','cancelled'],on_scene:['transporting','completed','cancelled'],transporting:['completed'],completed:[],cancelled:[]};
  return <section className="panel"><h2>Incidents & missions</h2><p>Create an incident, review suitable vehicles, assign a resource and track the mission through completion.</p>
    {can('admin','dispatcher')&&<details><summary>Create incident</summary><Form label="Create incident" submit={b=>send('/api/incidents',{...b,latitude:Number(b.latitude),longitude:Number(b.longitude)})} onDone={result=>{reload();setSelected(result.id);}}><Field name="description" label="Incident description (avoid unnecessary patient information)" maxLength="2000"/><Select name="priority" label="Operational priority" items={[["urgent","Urgent"],["standard","Standard"]]}/><Field name="latitude" label="Latitude" type="number" min="-90" max="90" step="any"/><Field name="longitude" label="Longitude" type="number" min="-180" max="180" step="any"/></Form></details>}
    {error&&<p role="alert">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>Incident</th><th>Priority</th><th>Status</th><th>Vehicle</th><th>Action</th></tr></thead><tbody>{incidents.map(i=><tr key={i.id}><td>{i.reference}<small>{i.description}</small></td><td>{i.priority}</td><td>{i.status.replaceAll('_',' ')}</td><td>{i.ambulance_code||'Unassigned'}</td><td><button className="secondary-button" onClick={()=>{setSelected(i.id);setRecommendation(null);setMessage('');}}>Open incident</button></td></tr>)}</tbody></table>{!incidents.length&&<p>No incidents recorded.</p>}</div>
    {active&&<div className="mission-detail"><h3>{active.reference}</h3><p>{active.description}</p><p>Location: {active.latitude}, {active.longitude} · {active.status.replaceAll('_',' ')}</p>
      {active.status==='open'&&can('admin','dispatcher')&&<button className="primary-button" disabled={busy} onClick={()=>recommend(active)}>{busy?'Checking…':'Find suitable vehicles'}</button>}
      {recommendation?.incidentId===active.id&&<><p>{recommendation.message}</p><small>{recommendation.distanceType} · Checked {stamp(recommendation.evaluatedAt)}. Assignment always rechecks current eligibility.</small>{recommendation.candidates.map(a=><div className="result-row" key={a.id}><strong>{a.code}</strong><span>{a.distanceKm} km{a.durationMinutes!=null?` · ${a.durationMinutes} min estimated drive`:''}</span><span>{a.readiness}% ready</span><button className="secondary-button" onClick={()=>onVehicle(a.id)}>Review vehicle</button><button className="primary-button" disabled={busy||active.status!=='open'} onClick={()=>assign(a.id)}>Assign vehicle</button></div>)}<details><summary>Excluded vehicles ({recommendation.excluded.length})</summary>{recommendation.excluded.map(a=><p key={a.id}>{a.code}: {a.reasons.join('; ')}</p>)}</details></>}
      {active.ambulance_id&&<button className="secondary-button" onClick={()=>onVehicle(active.ambulance_id)}>Inspect assigned vehicle</button>}
      {can('admin','dispatcher')&&flow[active.status]?.length>0&&<Form label="Update mission" submit={b=>send(`/api/incidents/${active.id}/transition`,b)} onDone={reload}><Select name="status" label="Next state" items={flow[active.status].map(s=>[s,s.replaceAll('_',' ')])}/><Field name="notes" label="Progress / closure notes" maxLength="2000"/></Form>}
    </div>}{message&&<p role="status" className="notice">{message}</p>}
  </section>;
}

export function AlertInbox({onVehicle}){
  const {can}=useAuth();const [version,setVersion]=useState(0),[filter,setFilter]=useState('active');const [alerts,error]=useRows('/api/alerts',version);
  const shown=alerts.filter(a=>filter==='all'||(a.status==='ACTIVE'&&(filter!=='escalated'||a.escalated_at)));
  return <section className="panel"><div className="section-heading"><h2>Alert inbox</h2><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active</option><option value="escalated">Escalated active</option><option value="all">Recent history</option></select></label></div><p>Escalation flags the alert for supervisor review in this inbox. It does not send an external message.</p>{error&&<p role="alert">{error}</p>}{!shown.length&&<p>No matching alerts.</p>}
    {shown.map(a=><details key={a.id}><summary>{a.ambulance_code} · {a.severity} · {a.message} · {a.status}</summary><p>Detected {stamp(a.created_at)}. Acknowledged: {a.acknowledged_name||'No'}. Escalated: {a.escalated_name||'No'}.</p><button className="secondary-button" onClick={()=>onVehicle(a.ambulance_id)}>Review vehicle</button>{a.status==='ACTIVE'&&can('admin','dispatcher','mechanic')&&<Form label="Record alert action" submit={b=>send(`/api/alerts/${a.id}/action`,b)} onDone={()=>setVersion(v=>v+1)}><Select label="Action" name="action" items={[["acknowledge","Acknowledge"],["escalate","Escalate for supervisor review"]]}/><Field label="Action notes" name="notes" maxLength="2000"/></Form>}</details>)}
  </section>;
}

export function ActivityTimeline({ambulanceId}){
  const [events,error]=useRows(`/api/ambulances/${ambulanceId}/timeline`);
  return <section className="panel"><h3>Vehicle activity timeline</h3>{error&&<p role="alert">{error}</p>}<ol className="activity-timeline">{events.map(e=><li key={e.event_id}><strong>{e.title.replaceAll('_',' ')}</strong><small>{stamp(e.at)} · {e.actor}</small><p>{e.detail}</p></li>)}</ol>{!events.length&&<p>No recorded activity yet.</p>}</section>;
}

export function RoadCoverage(){
  const {can}=useAuth();const [version,setVersion]=useState(0);const [points,error]=useRows('/api/coverage-points',version);
  return <section className="panel"><h2>Road response coverage</h2><p>Check named locations against a target driving time. This measures coverage at those points, not every location in a district.</p>{error&&<p role="alert">{error}</p>}
    {can('admin')&&<details><summary>Add or update coverage location</summary><Form label="Save coverage point" submit={b=>send('/api/coverage-points',{...b,latitude:Number(b.latitude),longitude:Number(b.longitude),targetMinutes:Number(b.targetMinutes)})} onDone={()=>setVersion(v=>v+1)}><Field label="Location name" name="name" maxLength="200"/><Field label="Latitude" name="latitude" type="number" min="-90" max="90" step="any"/><Field label="Longitude" name="longitude" type="number" min="-180" max="180" step="any"/><Field label="Target driving minutes" name="targetMinutes" type="number" min="1" max="180"/></Form></details>}
    {!points.length&&<p>No coverage locations configured.</p>}{points.map(p=><div className="result-row" key={p.id}><strong>{p.name}</strong><span>{p.withinTarget===null?'Coverage unknown':`${p.withinTarget} vehicles within ${p.target_minutes} minutes`}</span><span className="badge">{p.risk}</span><small>{p.note}</small></div>)}
  </section>;
}
