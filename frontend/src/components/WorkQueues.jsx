import { useState } from 'react';

export function FleetFilters({ vehicles, search, setSearch, hospital, setHospital, status, setStatus }) {
  const hospitals = [...new Set(vehicles.map(a => a.hospital_name || 'Unassigned'))].sort();
  return <div className="workspace-filters">
    <label>Find an ambulance<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Vehicle code or registration" /></label>
    <label>Hospital<select value={hospital} onChange={e => setHospital(e.target.value)}><option value="">All hospitals</option>{hospitals.map(name => <option key={name}>{name}</option>)}</select></label>
    <label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All states</option><option value="ready">Dispatch ready</option><option value="hold">Inspection holds</option><option value="offline">Delayed / offline</option><option value="maintenance">In maintenance</option><option value="responding">Responding</option><option value="retired">Retired</option></select></label>
    <button type="button" className="secondary-button" onClick={() => { setSearch(''); setHospital(''); setStatus(''); }}>Reset filters</button>
  </div>;
}

export function AttentionQueue({ vehicles, onOpen }) {
  const attention = vehicles.filter(a => !a.dispatch.eligible).sort((a, b) => Number(b.safety.inspectionRequired) - Number(a.safety.inspectionRequired));
  return <section className="panel attention-queue"><div className="section-heading"><h2>Needs attention</h2><span>{attention.length} vehicles</span></div>
    {!attention.length ? <p>{vehicles.length ? 'All displayed vehicles meet current dispatch requirements.' : 'No vehicles to assess in this view.'}</p> : <div className="queue-list">{attention.map(a => <button className="queue-item" key={a.id} onClick={() => onOpen(a.id)}>
      <span><strong>{a.ambulance_code}</strong><small>{a.hospital_name || 'Unassigned hospital'}</small></span>
      <span>{a.safety.inspectionRequired ? 'Inspection required' : a.connection.status !== 'LIVE' ? `${a.connection.status} telemetry` : a.readiness.reasons[0] || a.effective_status || 'Review readiness'}</span>
      <span aria-hidden="true">→</span>
    </button>)}</div>}
  </section>;
}

function serviceState(vehicle, now) {
  if (vehicle.safety.inspectionRequired) return 'Inspection hold';
  if (!vehicle.next_service_date) return 'Schedule missing';
  const due = new Date(vehicle.next_service_date).getTime();
  const today = new Date(now).setUTCHours(0, 0, 0, 0);
  if (due < today || (vehicle.next_service_km != null && vehicle.odometer_km != null && Number(vehicle.odometer_km) >= Number(vehicle.next_service_km))) return 'Overdue';
  if (due <= today + 7 * 86400000) return 'Due within 7 days';
  return 'Scheduled';
}

export function MaintenanceQueue({ vehicles, selectedId, now, onOpen }) {
  const [filter, setFilter] = useState('all');
  const order = ['Inspection hold', 'Overdue', 'Schedule missing', 'Due within 7 days', 'Scheduled'];
  const rows = vehicles.map(a => ({ ...a, serviceState: serviceState(a, now) }))
    .filter(a => filter === 'all' || a.serviceState === filter)
    .sort((a, b) => order.indexOf(a.serviceState) - order.indexOf(b.serviceState));
  return <section className="panel"><div className="section-heading"><div><h2>Service worklist</h2><small>Select a vehicle to review its history, record service or clear an inspection.</small></div>
    <label>Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All vehicles</option>{order.map(state => <option key={state}>{state}</option>)}</select></label></div>
    <div className="table-scroll"><table><thead><tr><th>Vehicle</th><th>Service status</th><th>Next service</th><th>Next mileage</th><th>Action</th></tr></thead><tbody>{rows.map(a => <tr key={a.id} className={selectedId === a.id ? 'selected-row' : ''}>
      <td><strong>{a.ambulance_code}</strong><small>{a.hospital_name || 'Unassigned'}</small></td><td><span className={`badge ${a.serviceState !== 'Scheduled' ? 'attention' : ''}`}>{a.serviceState}</span></td>
      <td>{a.next_service_date ? new Date(a.next_service_date).toLocaleDateString() : 'Not recorded'}</td><td>{a.next_service_km == null ? 'Not recorded' : `${a.next_service_km} km`}</td>
      <td><button className="secondary-button" onClick={() => onOpen(a.id)}>Review {a.ambulance_code}</button></td>
    </tr>)}</tbody></table>{!rows.length && <p>No vehicles match this service filter.</p>}</div>
  </section>;
}

export function FaultPanel({ ambulance }) {
  return <section className="panel"><h3>Faults & safety restrictions</h3>
    {ambulance.connection.status !== 'LIVE' && <p className="notice">These are last known readings. Current fault status cannot be confirmed.</p>}
    {ambulance.safety.inspectionRequired && <div className="notice"><strong>Persistent inspection hold</strong><p>{ambulance.safety.reason}</p></div>}
    <p>Diagnostic codes: {Array.isArray(ambulance.fault_codes) ? ambulance.fault_codes.join(', ') || 'No codes reported in the latest scan' : 'Fault scan unavailable'}</p>
    {ambulance.alerts?.length ? <ul className="reason-list">{ambulance.alerts.map(alert => <li key={alert.type}><strong>{alert.severity}</strong> — {alert.message}</li>)}</ul> : <p>No threshold alerts in the latest reading.</p>}
    <p>Inspection holds are cleared through the Maintenance workspace after review.</p>
  </section>;
}
