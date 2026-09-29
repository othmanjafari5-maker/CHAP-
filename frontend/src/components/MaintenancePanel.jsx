import {useEffect,useState} from 'react';
import {request} from '../api';
import {useAuth} from '../auth-context';
export default function MaintenancePanel({ambulance,onChange}) {
  const {user,can}=useAuth();
  const [records,setRecords]=useState([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
  const editable=can('admin','mechanic');
  useEffect(()=>{const controller=new AbortController();request(`/api/ambulances/${ambulance.id}/maintenance`,{signal:controller.signal}).then(setRecords).catch(e=>{if(e.name!=='AbortError')setMessage(e.message);});return()=>controller.abort();},[ambulance.id,version]);
  async function submit(event,clear=false){
    event.preventDefault();setBusy(true);setMessage('');const form=new FormData(event.currentTarget);
    const body=clear?{notes:form.get('notes')}:{serviceDate:form.get('serviceDate'),odometerKm:Number(form.get('odometerKm')),repairType:form.get('repairType'),notes:form.get('notes'),nextServiceDate:form.get('nextServiceDate'),nextServiceKm:form.get('nextServiceKm')||null,faultCodes:form.get('faultCodes').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),failureOccurred:form.get('failureOccurred')==='on'};
    try{const saved=await request(`/api/ambulances/${ambulance.id}/${clear?'clear-inspection':'maintenance'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setMessage(clear?'Inspection cleared.':`Service record #${saved.id} saved. Use this ID when completing its work order.`);setVersion(v=>v+1);onChange();}catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  return <div className="panel"><h3>Maintenance & inspection</h3><p>Signed in as {user.display_name}. Service entries and clearances are attributed to your account.</p>
    {editable&&<details><summary>Add completed service</summary><form className="maintenance-form" onSubmit={submit}>
      <label>Service date<input name="serviceDate" type="date" max={new Date().toISOString().slice(0,10)} required/></label>
      <label>Odometer (km)<input name="odometerKm" type="number" min="0" step="0.1" required/></label>
      <label>Repair / service type<input name="repairType" maxLength="200" required/></label>
      <label>Next service date<input name="nextServiceDate" type="date" required/></label>
      <label>Next service odometer (optional)<input name="nextServiceKm" type="number" min="0"/></label>
      <label>Fault codes (comma separated)<input name="faultCodes" placeholder="P0300, P0217"/></label>
      <label className="full-width">Work performed<textarea name="notes" maxLength="5000"/></label>
      <label className="checkbox-label"><input type="checkbox" name="failureOccurred"/> Actual mechanical failure occurred</label>
      <button className="primary-button" disabled={busy}>Save service record</button></form></details>}
    {editable&&ambulance.safety.inspectionRequired&&<form onSubmit={e=>submit(e,true)}><label>Inspection clearance notes<textarea name="notes" minLength="10" maxLength="5000" required/></label><button className="primary-button" disabled={busy}>Clear inspection hold</button><small>Requires live normal readings, fault scan and a service schedule. Completing a work order does not clear a safety hold.</small></form>}
    {message&&<p role="status" className="notice">{message}</p>}
    <div className="table-scroll"><table><thead><tr><th>Record</th><th>Service date</th><th>Work</th><th>Next service</th><th>Recorded by</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>#{r.id}</td><td>{new Date(r.service_date).toLocaleDateString()}</td><td>{r.repair_type}<small>{r.notes}</small><small>{r.odometer_km} km · Failure: {r.failure_occurred?'Yes':'No'}</small></td><td>{new Date(r.next_service_date).toLocaleDateString()}</td><td>{r.created_by}</td></tr>)}</tbody></table>{!records.length&&<p>No service records yet.</p>}</div>
  </div>;
}
