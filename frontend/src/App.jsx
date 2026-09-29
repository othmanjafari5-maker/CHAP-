import { useEffect, useState } from 'react';
import FleetMap from './components/FleetMap';
import LiveAmbulanceMap from './components/LiveAmbulanceMap';
import TelemetryTrends from './components/TelemetryTrends';
import MaintenancePanel from './components/MaintenancePanel';
import CoverageSettings from './components/CoverageSettings';
import { request, freshness } from './api';
import { FleetFilters, AttentionQueue, MaintenanceQueue, FaultPanel } from './components/WorkQueues';
import './App.css';

const time = value => value ? new Date(value).toLocaleString() : 'Never received';
const workspaces = {
  operations: ['Operations overview', 'Monitor readiness, locate vehicles and investigate exceptions.'],
  vehicle: ['Vehicle workspace', 'Inspect telemetry, journey history, faults and maintenance.'],
  maintenance: ['Maintenance workspace', 'Prioritize inspections and service work, then reassess availability.'],
  dispatch: ['Dispatch workspace', 'Find a suitable vehicle and review the reasons behind each recommendation.'],
  planning: ['Planning workspace', 'Review hospital coverage and likely fleet availability.'],
};
const vehicleTabs = ['telemetry', 'trends', 'journey', 'faults', 'maintenance'];
function readRoute() {
  const [requested, id, requestedTab] = window.location.hash.slice(1).split('/');
  return { page: Object.hasOwn(workspaces, requested) ? requested : 'operations', id: /^\d+$/.test(id || '') ? Number(id) : null, tab: vehicleTabs.includes(requestedTab) ? requestedTab : 'telemetry' };
}
export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [search, setSearch] = useState(''), [hospital, setHospital] = useState('');
  useEffect(() => {
    const update = () => { setRoute(readRoute()); window.scrollTo({ top: 0 }); document.getElementById('workspace-heading')?.focus(); };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  function navigate(page, id = null, tab = 'telemetry') {
    window.location.hash = `${page}${id ? `/${id}` : ''}${page === 'vehicle' ? `/${tab}` : ''}`;
  }
  const [fleet, setFleet] = useState([]), [selectedId, setSelectedId] = useState(null);
  const [coverage, setCoverage] = useState([]), [forecast, setForecast] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now()), [refresh, setRefresh] = useState(0);
  const [incident, setIncident] = useState({ latitude: '-6.163', longitude: '35.7516' });
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
  const selected = route.id ? vehicles.find(a => a.id === route.id) : vehicles.find(a => a.id === selectedId) || vehicles[0];
  const filteredVehicles = vehicles.filter(a => (!hospital || (a.hospital_name || 'Unassigned') === hospital) && `${a.ambulance_code} ${a.registration_number}`.toLowerCase().includes(search.trim().toLowerCase()));
  const openVehicle = id => { setSelectedId(id); navigate('vehicle', id); };
  const selectMaintenance = id => { setSelectedId(id); navigate('maintenance', id); };
  const [title, description] = workspaces[route.page];
  async function recommend(event) {
    event.preventDefault();setRanking(true);setDispatchError('');setDispatch(null);
    const form=new FormData(event.currentTarget);
    try {setDispatch(await request('/api/dispatch/recommendations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:Number(form.get('latitude')),longitude:Number(form.get('longitude'))})}));}
    catch(e){setDispatchError(e.message);} finally {setRanking(false);}
  }
  return <div className="app-shell">
    <a href="#workspace-heading" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('workspace-heading')?.focus(); }}>Skip to workspace</a>
    <aside className="sidebar"><a className="brand" href="#operations"><span className="brand-mark">✚</span><span>CHAP<small>AMBULANCE INTELLIGENCE</small></span></a>
      <nav aria-label="Workspaces">{Object.entries(workspaces).map(([key, [label]]) => <a key={key} href={`#${key}${(key === 'vehicle' || key === 'maintenance') && selected ? `/${selected.id}` : ''}`} aria-current={route.page === key ? 'page' : undefined}>{label.replace(' workspace', '')}</a>)}</nav>
      <div className="sidebar-note"><span className="pulse-dot"/> Operational readiness<p>Monitor → investigate → act → reassess.</p></div>
    </aside>
    <main className="main-content"><header className="page-header"><div><p className="eyebrow">CHAP / {route.page.toUpperCase()}</p><h1 id="workspace-heading" tabIndex="-1">{title}</h1><p>{description}</p></div><span className="badge">{error?'CONNECTION LOST':loading?'CONNECTING':'UPDATES EVERY 5s'}</span></header>
      {error&&<div className="notice" role="alert">Backend unavailable: {error}. Displayed readings are last known values; recommendations and counts may be outdated.</div>}
      {route.page === 'operations' && <div className="summary-grid">{[['Total ambulances',vehicles.length],['Dispatch ready',vehicles.filter(a=>a.dispatch.eligible).length],['Inspection required',vehicles.filter(a=>a.safety.inspectionRequired).length],['Delayed / offline',vehicles.filter(a=>a.connection.status!=='LIVE').length]].map(([label,value])=><div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
      {loading&&<p role="status">Loading fleet…</p>}{!loading&&!vehicles.length&&<div className="panel">No ambulances found. Run the backend seed command to create the demo fleet.</div>}
      {!loading && route.id && !selected && (route.page === 'vehicle' || route.page === 'maintenance') && <div className="notice" role="alert">The requested vehicle is no longer available. <button className="text-button" onClick={()=>navigate('operations')}>Choose a vehicle from Operations</button></div>}
      {route.page === 'operations' && <>
      <FleetFilters vehicles={vehicles} search={search} setSearch={setSearch} hospital={hospital} setHospital={setHospital}/>
      <div className="operations-layout"><FleetMap ambulances={filteredVehicles} onSelect={openVehicle}/><AttentionQueue vehicles={filteredVehicles} onOpen={openVehicle}/></div>
      <section id="fleet"><div className="section-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h2>Ambulance fleet</h2></div><span>{filteredVehicles.length} of {vehicles.length} vehicles shown</span></div><div className="fleet-grid">{filteredVehicles.map(a=><button type="button" key={a.id} className={`fleet-card ${selected?.id===a.id?'selected':''}`} onClick={()=>openVehicle(a.id)}><div className="fleet-card-top"><h3>{a.ambulance_code}</h3><span className={`badge ${a.connection.status!=='LIVE'?'attention':''}`}>{a.connection.status}</span></div><p>{a.hospital_name||'Unassigned hospital'}</p><div className="readiness-value">{a.readiness.score??'—'}<small>/ 100 readiness</small></div><div className="score-track"><span style={{width:`${a.readiness.score||0}%`}}/></div><p className="card-label">{a.connection.status==='LIVE'?a.readiness.label:'TELEMETRY NOT CURRENT'}</p><div className="card-meta"><span>{a.effective_status}</span><strong>{a.dispatch.eligible?'Dispatch ready':'Not eligible'}</strong></div><small>Last observation: {time(a.recorded_at)}</small></button>)}</div>{!filteredVehicles.length && !loading && <p>No vehicles match your filters.</p>}</section></>}
      {(route.page === 'vehicle' || route.page === 'maintenance') && selected && <div className="vehicle-selector"><label>Selected vehicle<select value={selected.id} onChange={e => {const id=Number(e.target.value); setSelectedId(id); navigate(route.page,id,route.tab);}}>{vehicles.map(a=><option key={a.id} value={a.id}>{a.ambulance_code} · {a.hospital_name || 'Unassigned'}</option>)}</select></label><button className="secondary-button" onClick={() => navigate('operations')}>Back to operations</button></div>}
      {route.page === 'vehicle' && selected&&<section id="vehicle" className="vehicle-section"><div className="section-heading"><div><p className="eyebrow">VEHICLE INTELLIGENCE</p><h2>{selected.ambulance_code} <span className="muted">/ {selected.registration_number}</span></h2></div><span className="badge">{selected.effective_status}</span></div><nav className="vehicle-tabs" aria-label="Vehicle sections">{vehicleTabs.map(tab => <a key={tab} href={`#vehicle/${selected.id}/${tab}`} aria-current={route.tab === tab ? 'page' : undefined}>{tab === 'journey' ? 'Journey history' : tab.charAt(0).toUpperCase()+tab.slice(1)}</a>)}</nav>
      {route.tab === 'telemetry' && <><div className="intelligence-grid"><div className="panel"><h3>Readiness assessment</h3><strong className="large-number">{selected.readiness.score??'—'}<small> / 100</small></strong><p>{selected.connection.status==='LIVE'?selected.readiness.label:'Current readiness unavailable — stale telemetry'}</p><ul className="reason-list">{selected.readiness.reasons.map(r=><li key={r}>{r}</li>)}</ul>{selected.safety.inspectionRequired&&<div className="notice">Inspection required: {selected.safety.reason}</div>}<small>Last contact: {time(selected.connection.lastSeenAt)}</small></div><div className="panel"><h3>Failure risk</h3><strong className="large-number risk-label">{selected.connection.status==='LIVE'?selected.risk.level:'UNKNOWN'}</strong><p>{selected.risk.source}</p><ul className="reason-list">{selected.risk.reasons.map(r=><li key={r}>{r}</li>)}</ul><small>Seven-day demo estimate. Synthetic model output is not a validated failure probability. Unknown risk does not override mechanical safety checks.</small></div></div>
      <div className="data-grid">{[['Speed','speed','km/h'],['Engine speed','rpm','RPM'],['Temperature','engine_temperature','°C'],['Battery','battery_voltage','V'],['Fuel','fuel_level','%'],['Vibration','vibration','sensor units'],['Odometer','odometer_km','km']].map(([label,key,unit])=><div className="data-card" key={key}><span>{label}</span><strong>{selected[key]??'—'} <small>{unit}</small></strong></div>)}</div>
      </>}
      {route.tab === 'trends' && <TelemetryTrends key={selected.id} ambulanceId={selected.id}/>}
      {route.tab === 'journey' && <LiveAmbulanceMap key={selected.id} ambulance={selected}/>}
      {route.tab === 'faults' && <><FaultPanel ambulance={selected}/><button className="primary-button" onClick={()=>selectMaintenance(selected.id)}>Review inspection & service</button></>}
      {route.tab === 'maintenance' && <MaintenancePanel key={`vehicle-maintenance-${selected.id}`} ambulance={selected} onChange={()=>setRefresh(v=>v+1)}/>}
      <div className="workspace-actions"><button className="secondary-button" onClick={()=>selectMaintenance(selected.id)}>Open maintenance worklist</button><button className="secondary-button" onClick={()=>navigate('dispatch')}>Check dispatch options</button></div>
      </section>}
      {route.page === 'maintenance' && <><MaintenanceQueue vehicles={vehicles} selectedId={selected?.id} now={now} onOpen={selectMaintenance}/>{selected && <><div className="section-heading"><h2>{selected.ambulance_code} · Service record</h2><button className="secondary-button" onClick={()=>openVehicle(selected.id)}>Inspect vehicle telemetry</button></div><MaintenancePanel key={`maintenance-${selected.id}`} ambulance={selected} onChange={()=>setRefresh(v=>v+1)}/><button className="secondary-button" onClick={()=>navigate('planning')}>Review coverage after service</button></>}</>}

      {route.page === 'dispatch' && <section id="dispatch" className="panel"><p className="eyebrow">READINESS FIRST</p><h2>Dispatch recommendation</h2><p>Enter the incident location to rank eligible vehicles by health, fuel, risk and approximate distance.</p><form className="inline-form" onSubmit={recommend}><label>Incident latitude<input name="latitude" type="number" min="-90" max="90" step="any" value={incident.latitude} onChange={e=>{setIncident({...incident,latitude:e.target.value});setDispatch(null);}} required/></label><label>Incident longitude<input name="longitude" type="number" min="-180" max="180" step="any" value={incident.longitude} onChange={e=>{setIncident({...incident,longitude:e.target.value});setDispatch(null);}} required/></label><button className="primary-button" disabled={ranking||!!error||loading}>{ranking?'Checking fleet…':'Find suitable ambulance'}</button></form>{dispatchError&&<p role="alert" className="error">{dispatchError}</p>}{dispatch&&<div><p><strong>{dispatch.message}</strong> · Checked {time(dispatch.evaluatedAt)}</p><small>{now-new Date(dispatch.evaluatedAt).getTime()>15000?"Recommendation is stale. Run the check again. ":""}{dispatch.distanceType}. Recheck before assignment; this does not dispatch a vehicle.</small>{dispatch.candidates.map((a,i)=><div className="result-row" key={a.id}><strong>#{i+1} {a.code}</strong><span>{a.distanceKm} km away</span><span>{a.readiness}% ready · Risk {a.risk}</span><button className="secondary-button" onClick={()=>openVehicle(a.id)}>Review vehicle</button></div>)}<details><summary>Excluded vehicles ({dispatch.excluded.length})</summary>{dispatch.excluded.map(a=><p key={a.id}><strong>{a.code}:</strong> {a.reasons.join('; ')||'Readiness requirements not met'} <button className="text-button" onClick={()=>openVehicle(a.id)}>Review</button></p>)}</details></div>}</section>}
      {route.page === 'planning' && <section id="coverage"><div className="section-heading"><div><p className="eyebrow">SERVICE RESILIENCE</p><h2>Coverage & availability</h2></div></div><div className="coverage-grid">{coverage.map(g=><div className="panel" key={g.hospital}><span className={`badge ${g.risk!=='ADEQUATE'?'attention':''}`}>{g.risk}</span><h3>{g.hospital}</h3><strong className="large-number">{g.ready}<small> / {g.total} ready</small></strong><p>{g.unavailable} unavailable · {g.highRisk} high risk</p><small>Minimum coverage: {g.minimum}. {g.ready===g.minimum?'One more loss would leave coverage below minimum.':''}</small><CoverageSettings hospital={g.hospital} minimum={g.minimum} onChange={()=>setRefresh(v=>v+1)}/></div>)}</div>{forecast&&<div className="panel"><h3>Likely fleet availability</h3><div className="forecast-grid">{forecast.horizons.map(h=><div key={h.days}><span>{h.days===0?'Today':`Next ${h.days} days`}</span><strong>{h.expected}<small> / {h.total}</small></strong><p>{h.serviceDue} service due · {h.unknown} uncertain</p></div>)}</div><small>{forecast.method}</small></div>}</section>}<footer>CHAP · Ambulance operational readiness</footer>
    </main></div>;
}
