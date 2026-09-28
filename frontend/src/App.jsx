import { useEffect, useState } from 'react';
import FleetMap from './components/FleetMap';
import LiveAmbulanceMap from './components/LiveAmbulanceMap';
import TelemetryTrends from './components/TelemetryTrends';
import MaintenancePanel from './components/MaintenancePanel';
import CoverageSettings from './components/CoverageSettings';
import { request, freshness } from './api';
import './App.css';

const time = value => value ? new Date(value).toLocaleString() : 'Never received';
export default function App() {
  const [fleet, setFleet] = useState([]), [selectedId, setSelectedId] = useState(null);
  const [coverage, setCoverage] = useState([]), [forecast, setForecast] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now()), [refresh, setRefresh] = useState(0);
  const [dispatch, setDispatch] = useState(null), [dispatchError, setDispatchError] = useState(''), [ranking, setRanking] = useState(false);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer;
    const poll = async () => {
      try {
        const [vehicles, areas, availability] = await Promise.all(['/api/ambulances','/api/fleet/coverage','/api/fleet/availability'].map(path => request(path,{signal:controller.signal})));
        if (!controller.signal.aborted) { setFleet(vehicles); setCoverage(areas); setForecast(availability); setError(''); }
      } catch(e) { if(e.name !== 'AbortError') setError(e.message); }
      finally { if(!controller.signal.aborted) {setLoading(false); timer=setTimeout(poll,5000);} }
    };
    poll(); return () => {controller.abort();clearTimeout(timer);};
  }, [refresh]);
  const vehicles = fleet.map(a => {
    const state=freshness(a.recorded_at,now);
    return {...a,connection:{...a.connection,status:state},dispatch:{...a.dispatch,eligible:!error&&state==='LIVE'&&a.dispatch.eligible}};
  });
  const selected=vehicles.find(a=>a.id===selectedId)||vehicles[0];
  async function recommend(event) {
    event.preventDefault();setRanking(true);setDispatchError('');setDispatch(null);
    const form=new FormData(event.currentTarget);
    try {setDispatch(await request('/api/dispatch/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:Number(form.get('latitude')),longitude:Number(form.get('longitude'))})}));}
    catch(e){setDispatchError(e.message);} finally {setRanking(false);}
  }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#overview"><span className="brand-mark">✚</span><span>CHAP<small>AMBULANCE INTELLIGENCE</small></span></a><nav><a href="#overview">Overview</a><a href="#fleet">Ambulance fleet</a><a href="#vehicle">Vehicle intelligence</a><a href="#dispatch">Dispatch support</a><a href="#coverage">Coverage & planning</a></nav><div className="sidebar-note"><span className="pulse-dot"/> Operational readiness<p>Know which vehicles are ready to respond.</p></div></aside>
    <main className="main-content" id="overview"><header className="page-header"><div><p className="eyebrow">FLEET OPERATIONS</p><h1>Ambulance control center</h1><p>Vehicle health, readiness and service coverage in one place.</p></div><span className="badge">{error?'CONNECTION LOST':'UPDATES EVERY 5s'}</span></header>
      {error&&<div className="notice" role="alert">Backend unavailable: {error}. Displayed readings are last known values; recommendations and counts may be outdated.</div>}
      <div className="summary-grid">{[['Total ambulances',vehicles.length],['Dispatch ready',vehicles.filter(a=>a.dispatch.eligible).length],['Inspection required',vehicles.filter(a=>a.safety.inspectionRequired).length],['Delayed / offline',vehicles.filter(a=>a.connection.status!=='LIVE').length]].map(([label,value])=><div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {loading&&<p role="status">Loading fleet…</p>}{!loading&&!vehicles.length&&<div className="panel">No ambulances found. Run the backend seed command to create the demo fleet.</div>}
      <section id="fleet"><div className="section-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h2>Ambulance fleet</h2></div><span>{vehicles.length} registered vehicles</span></div><div className="fleet-grid">{vehicles.map(a=><button type="button" key={a.id} className={`fleet-card ${selected?.id===a.id?'selected':''}`} onClick={()=>setSelectedId(a.id)}><div className="fleet-card-top"><h3>{a.ambulance_code}</h3><span className={`badge ${a.connection.status!=='LIVE'?'attention':''}`}>{a.connection.status}</span></div><p>{a.hospital_name||'Unassigned hospital'}</p><div className="readiness-value">{a.readiness.score??'—'}<small>/ 100 readiness</small></div><div className="score-track"><span style={{width:`${a.readiness.score||0}%`}}/></div><p className="card-label">{a.connection.status==='LIVE'?a.readiness.label:'TELEMETRY NOT CURRENT'}</p><div className="card-meta"><span>{a.effective_status}</span><strong>{a.dispatch.eligible?'Dispatch ready':'Not eligible'}</strong></div><small>Last observation: {time(a.recorded_at)}</small></button>)}</div><FleetMap ambulances={vehicles} onSelect={setSelectedId}/></section>
      {selected&&<section id="vehicle" className="vehicle-section"><div className="section-heading"><div><p className="eyebrow">VEHICLE INTELLIGENCE</p><h2>{selected.ambulance_code} <span className="muted">/ {selected.registration_number}</span></h2></div><span className="badge">{selected.effective_status}</span></div><div className="intelligence-grid"><div className="panel"><h3>Readiness assessment</h3><strong className="large-number">{selected.readiness.score??'—'}<small> / 100</small></strong><p>{selected.connection.status==='LIVE'?selected.readiness.label:'Current readiness unavailable — stale telemetry'}</p><ul className="reason-list">{selected.readiness.reasons.map(r=><li key={r}>{r}</li>)}</ul>{selected.safety.inspectionRequired&&<div className="notice">Inspection required: {selected.safety.reason}</div>}<small>Last contact: {time(selected.connection.lastSeenAt)}</small></div><div className="panel"><h3>Failure risk</h3><strong className="large-number risk-label">{selected.connection.status==='LIVE'?selected.risk.level:'UNKNOWN'}</strong><p>{selected.risk.source}</p><ul className="reason-list">{selected.risk.reasons.map(r=><li key={r}>{r}</li>)}</ul><small>Seven-day demo estimate. Synthetic model output is not a validated failure probability. Unknown risk does not override mechanical safety checks.</small></div></div>
      <div className="data-grid">{[['Speed','speed','km/h'],['Engine speed','rpm','RPM'],['Temperature','engine_temperature','°C'],['Battery','battery_voltage','V'],['Fuel','fuel_level','%'],['Vibration','vibration','sensor units'],['Odometer','odometer_km','km']].map(([label,key,unit])=><div className="data-card" key={key}><span>{label}</span><strong>{selected[key]??'—'} <small>{unit}</small></strong></div>)}</div>
      <TelemetryTrends key={selected.id} ambulanceId={selected.id}/><LiveAmbulanceMap ambulance={selected}/><MaintenancePanel key={`maintenance-${selected.id}`} ambulance={selected} onChange={()=>setRefresh(v=>v+1)}/></section>}
      <section id="dispatch" className="panel"><p className="eyebrow">READINESS FIRST</p><h2>Dispatch recommendation</h2><p>Enter the incident location to rank eligible vehicles by health, fuel, risk and approximate distance.</p><form className="inline-form" onSubmit={recommend}><label>Incident latitude<input name="latitude" type="number" min="-90" max="90" step="any" defaultValue="-6.163" required/></label><label>Incident longitude<input name="longitude" type="number" min="-180" max="180" step="any" defaultValue="35.7516" required/></label><button className="primary-button" disabled={ranking||!!error}>{ranking?'Checking fleet…':'Find suitable ambulance'}</button></form>{dispatchError&&<p role="alert" className="error">{dispatchError}</p>}{dispatch&&<div><p><strong>{dispatch.message}</strong> · Checked {time(dispatch.evaluatedAt)}</p><small>{now-new Date(dispatch.evaluatedAt).getTime()>15000?"Recommendation is stale. Run the check again. ":""}{dispatch.distanceType}. Recheck before assignment; this does not dispatch a vehicle.</small>{dispatch.candidates.map((a,i)=><div className="result-row" key={a.id}><strong>#{i+1} {a.code}</strong><span>{a.distanceKm} km away</span><span>{a.readiness}% ready · Risk {a.risk}</span></div>)}<details><summary>Excluded vehicles ({dispatch.excluded.length})</summary>{dispatch.excluded.map(a=><p key={a.id}><strong>{a.code}:</strong> {a.reasons.join('; ')||'Readiness requirements not met'}</p>)}</details></div>}</section>
      <section id="coverage"><div className="section-heading"><div><p className="eyebrow">SERVICE RESILIENCE</p><h2>Coverage & availability</h2></div></div><div className="coverage-grid">{coverage.map(g=><div className="panel" key={g.hospital}><span className={`badge ${g.risk!=='ADEQUATE'?'attention':''}`}>{g.risk}</span><h3>{g.hospital}</h3><strong className="large-number">{g.ready}<small> / {g.total} ready</small></strong><p>{g.unavailable} unavailable · {g.highRisk} high risk</p><small>Minimum coverage: {g.minimum}. {g.ready===g.minimum?'One more loss would leave coverage below minimum.':''}</small><CoverageSettings hospital={g.hospital} minimum={g.minimum} onChange={()=>setRefresh(v=>v+1)}/></div>)}</div>{forecast&&<div className="panel"><h3>Likely fleet availability</h3><div className="forecast-grid">{forecast.horizons.map(h=><div key={h.days}><span>{h.days===0?'Today':`Next ${h.days} days`}</span><strong>{h.expected}<small> / {h.total}</small></strong><p>{h.serviceDue} service due · {h.unknown} uncertain</p></div>)}</div><small>{forecast.method}</small></div>}</section><footer>CHAP · Ambulance operational readiness</footer>
    </main></div>;
}
