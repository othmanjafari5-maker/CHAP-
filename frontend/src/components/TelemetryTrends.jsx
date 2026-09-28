import {useEffect,useState} from 'react';
import {request} from '../api';
const metrics=[['battery_voltage','Battery voltage','V'],['engine_temperature','Engine temperature','°C'],['vibration','Vibration','sensor units'],['rpm','Engine speed','RPM'],['fault_events','New fault occurrences','events / bucket']];
function Chart({rows,field,label,unit,bucketSeconds}) {
  const points=rows.map(r=>({x:new Date(r.recorded_at).getTime(),y:r[field]==null?null:Number(r[field])}));
  const values=points.filter(p=>Number.isFinite(p.y));
  if(!values.length)return <div className="trend-card"><h3>{label}</h3><p>No readings in this period.</p></div>;
  const min=Math.min(...values.map(p=>p.y)),max=Math.max(...values.map(p=>p.y));
  const start=points[0].x,end=points.at(-1).x;
  const x=t=>36+(t-start)/Math.max(1,end-start)*420;
  const y=v=>125-(v-min)/Math.max(.1,max-min)*95;
  let path='',previous=null;
  for(const p of points){if(p.y===null){previous=null;continue;}path+=`${!previous||p.x-previous.x>Math.max(60000,bucketSeconds*1500)?'M':'L'} ${x(p.x)} ${y(p.y)} `;previous=p;}
  return <div className="trend-card"><div className="fleet-card-top"><h3>{label}</h3><small>{unit}</small></div><svg viewBox="0 0 480 160" role="img" aria-label={`${label}: minimum ${min.toFixed(2)}, maximum ${max.toFixed(2)}`}><line x1="36" y1="130" x2="460" y2="130" stroke="#ddd"/><text x="0" y="32">{max.toFixed(1)}</text><text x="0" y="125">{min.toFixed(1)}</text><path d={path} fill="none" stroke="#f54242" strokeWidth="2.5"/>{values.length===1&&<circle cx={x(values[0].x)} cy={y(values[0].y)} r="4" fill="#f54242"/>}<text x="36" y="152">{new Date(start).toLocaleTimeString()}</text><text x="460" y="152" textAnchor="end">{new Date(end).toLocaleTimeString()}</text></svg></div>;
}
export default function TelemetryTrends({ambulanceId}) {
  const [hours,setHours]=useState(1),[rows,setRows]=useState([]),[error,setError]=useState(''),[bucketSeconds,setBucketSeconds]=useState(30);
  useEffect(()=>{const controller=new AbortController();let timer;
    async function poll(){try{const data=await request(`/api/ambulances/${ambulanceId}/trends?hours=${hours}`,{signal:controller.signal});if(!controller.signal.aborted){setRows(data.rows);setBucketSeconds(data.bucketSeconds);setError('');}}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(!controller.signal.aborted)timer=setTimeout(poll,10000);}}
    poll();return()=>{controller.abort();clearTimeout(timer);};
  },[ambulanceId,hours]);
  return <div className="panel"><div className="section-heading"><div><h3>Deterioration trends</h3><small>All samples aggregated into approximately 120 time buckets. Missing buckets break the line.</small></div><label>Period<select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value="1">Last hour</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option></select></label></div>{error&&<p className="error">{error}</p>}<div className="trends-grid">{metrics.map(([field,label,unit])=><Chart key={field} rows={rows} field={field} label={label} unit={unit} bucketSeconds={bucketSeconds}/>)}</div><small>Fault occurrences count codes newly appearing since the previous scan; repeated codes are not counted again. Initial unknown scans are excluded.</small></div>;
}
