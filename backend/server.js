require('dotenv').config({ quiet: true, path: require('node:path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const pool = require('./db');
const migrate = require('./migrate');
const { numeric, alerts, assess } = require('./intelligence');
const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function id(value) { if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw fail('Invalid ambulance ID'); return Number(value); }
function number(value, name, min, max) { if (!numeric(value) || Number(value) < min || Number(value) > max) throw fail(`Invalid ${name}`); return Number(value); }
function date(value, name) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw fail(`Invalid ${name}`); return new Date(value).toISOString(); }
function codes(value) { if (!Array.isArray(value) || value.length > 30 || value.some(v => typeof v !== 'string' || !/^[A-Z0-9_-]{1,20}$/.test(v))) throw fail('Invalid fault codes'); return value; }
const {identity,roles,device,authRoutes}=require('./security');
const authorize=roles('admin','mechanic');
authRoutes(app);
app.use('/api',identity,(req,res,next)=>{
  if(req.path==='/readings'||req.path==='/health')return next();
  return roles()(req,res,next);
});
async function fleet(db = pool) {
  const result = await db.query(`SELECT a.*, vr.latitude, vr.longitude, vr.speed, vr.rpm,
    vr.engine_temperature, vr.battery_voltage, vr.fuel_level, vr.vibration, vr.recorded_at,
    vr.recorded_at AS last_update, vr.odometer_km, vr.fault_codes,
    seen.last_seen_at, m.next_service_date, m.next_service_km, h.id AS hold_id, h.reason AS hold_reason,
    hist.history
    FROM ambulances a
    LEFT JOIN LATERAL (SELECT * FROM vehicle_readings WHERE ambulance_id=a.id ORDER BY recorded_at DESC,id DESC LIMIT 1) vr ON true
    LEFT JOIN LATERAL (SELECT MAX(received_at) AS last_seen_at FROM vehicle_readings WHERE ambulance_id=a.id) seen ON true
    LEFT JOIN LATERAL (SELECT * FROM maintenance_records WHERE ambulance_id=a.id ORDER BY service_date DESC,id DESC LIMIT 1) m ON true
    LEFT JOIN safety_holds h ON h.ambulance_id=a.id AND h.cleared_at IS NULL
    LEFT JOIN LATERAL (SELECT json_agg(t ORDER BY t.recorded_at,t.id) AS history FROM
      (SELECT id, recorded_at,battery_voltage,engine_temperature,vibration,fault_codes FROM vehicle_readings WHERE ambulance_id=a.id ORDER BY recorded_at DESC,id DESC LIMIT 120) t) hist ON true
    ORDER BY a.id`);
  return result.rows.map(({ history, ...row }) => assess(row, history || []));
}
app.get('/', (req,res) => res.json({ message: 'CHAP Operational Readiness API' }));
app.get('/api/health', async (req,res) => { await pool.query('SELECT 1'); res.json({ status:'OK', database:'Connected' }); });
app.get('/api/ambulances', async (req,res) => res.json(await fleet()));
app.get('/api/ambulances/:id/latest', async (req,res) => {
  const vehicle = (await fleet()).find(a => a.id === id(req.params.id));
  if (!vehicle) throw fail('Ambulance not found',404);
  res.json(vehicle);
});
app.post('/api/readings', device, async (req,res) => {
  const b = req.body;
  const ambulanceId = id(b.ambulanceId);
  const fields = [['latitude',-90,90],['longitude',-180,180],['speed',0,300],['rpm',0,15000],['engineTemperature',-50,200],['batteryVoltage',0,40],['fuelLevel',0,100],['vibration',0,100]];
  const values = fields.map(([name,min,max]) => number(b[name],name,min,max));
  if (!Number.isInteger(values[3])) throw fail('RPM must be an integer');
  const recorded = b.recordedAt ? date(b.recordedAt,'recordedAt') : new Date().toISOString();
  if (Date.parse(recorded) > Date.now() + 30000) throw fail('Observation timestamp is in the future');
  const eventId = b.eventId || crypto.randomUUID();
  if (typeof eventId !== 'string' || eventId.length > 100) throw fail('Invalid event ID');
  const faults = b.faultCodes === undefined ? null : codes(b.faultCodes);
  const odo = b.odometerKm === undefined ? null : number(b.odometerKm,'odometer',0,10000000);
  const reading = { engine_temperature:values[4],battery_voltage:values[5],fuel_level:values[6],vibration:values[7],fault_codes:faults };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const vehicle = await client.query('SELECT id FROM ambulances WHERE id=$1 FOR UPDATE',[ambulanceId]);
    if (!vehicle.rowCount) throw fail('Ambulance not found',404);
    const latest = await client.query('SELECT recorded_at FROM vehicle_readings WHERE ambulance_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',[ambulanceId]);
    const saved = await client.query(`INSERT INTO vehicle_readings (ambulance_id,latitude,longitude,speed,rpm,engine_temperature,battery_voltage,fuel_level,vibration,event_id,recorded_at,received_at,odometer_km,fault_codes,source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13,$14) ON CONFLICT (ambulance_id,event_id) DO NOTHING RETURNING *`,
      [ambulanceId,...values,eventId,recorded,odo, faults === null ? null : JSON.stringify(faults),b.source === 'simulator' ? 'simulator':'device']);
    if (saved.rowCount) {
      const current = alerts(reading);
      if (current.some(a => a.severity === 'CRITICAL')) await client.query(`INSERT INTO safety_holds (ambulance_id,reason) VALUES ($1,$2) ON CONFLICT (ambulance_id) WHERE cleared_at IS NULL DO NOTHING`,[ambulanceId,current.filter(a => a.severity === 'CRITICAL').map(a=>a.message).join('; ')]);
      if (!latest.rowCount || new Date(recorded) >= new Date(latest.rows[0].recorded_at)) {
        const active = await client.query("SELECT * FROM vehicle_alerts WHERE ambulance_id=$1 AND status='ACTIVE'",[ambulanceId]);
        for (const old of active.rows) if (!current.some(a=>a.type===old.alert_type)) await client.query("UPDATE vehicle_alerts SET status='RESOLVED',resolved_at=CURRENT_TIMESTAMP WHERE id=$1",[old.id]);
        for (const a of current) {
          const old = active.rows.find(o=>o.alert_type===a.type);
          if (old) {
            await client.query('UPDATE vehicle_alerts SET severity=$1::varchar,message=$2,sensor_value=$3,acknowledged_by=CASE WHEN severity<>$1::varchar THEN NULL ELSE acknowledged_by END,acknowledged_at=CASE WHEN severity<>$1::varchar THEN NULL ELSE acknowledged_at END WHERE id=$4',[a.severity,a.message,a.value,old.id]);
            if(old.severity!==a.severity)await require('./security').audit(client,null,'ALERT_SEVERITY_CHANGED','alert',old.id,ambulanceId,{from:old.severity,to:a.severity,message:a.message});
          }
          else await client.query('INSERT INTO vehicle_alerts (ambulance_id,alert_type,severity,message,sensor_value) VALUES ($1,$2,$3,$4,$5)',[ambulanceId,a.type,a.severity,a.message,a.value]);
        }
      }
    }
    await client.query('COMMIT');
    res.status(saved.rowCount ? 201 : 200).json({ message:saved.rowCount ? 'Reading saved':'Duplicate acknowledged',reading:saved.rows[0] || null });
  } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
});
app.get('/api/ambulances/:id/trends', async (req,res) => {
  const hours = number(req.query.hours ?? 1, 'hours', 1, 744);
  const bucketSeconds = Math.max(30, Math.ceil(hours * 3600 / 120));
  const result = await pool.query(`WITH observations AS (
    SELECT recorded_at,battery_voltage,engine_temperature,vibration,rpm,fault_codes,
      LAG(fault_codes) OVER (ORDER BY recorded_at,id) AS previous_codes
    FROM vehicle_readings WHERE ambulance_id=$1 AND recorded_at >= NOW() - ($2 * INTERVAL '1 hour')
    UNION ALL SELECT recorded_at,battery_voltage,engine_temperature,vibration,rpm,fault_codes,NULL::jsonb
    FROM (SELECT * FROM vehicle_readings WHERE ambulance_id=$1 AND recorded_at < NOW() - ($2 * INTERVAL '1 hour') ORDER BY recorded_at DESC,id DESC LIMIT 1) prior
  ), ordered AS (
    SELECT *,LAG(fault_codes) OVER (ORDER BY recorded_at) AS prior_codes FROM observations
  ) SELECT to_timestamp(FLOOR(EXTRACT(EPOCH FROM recorded_at)/$3)*$3) AS recorded_at,
    AVG(battery_voltage)::float AS battery_voltage, AVG(engine_temperature)::float AS engine_temperature,
    AVG(vibration)::float AS vibration, AVG(rpm)::float AS rpm,
    SUM(CASE WHEN fault_codes IS NULL OR prior_codes IS NULL THEN NULL ELSE
      (SELECT COUNT(*) FROM jsonb_array_elements_text(fault_codes) code WHERE NOT prior_codes ? code) END)::int AS fault_events,
    COUNT(*)::int AS samples
    FROM ordered WHERE recorded_at >= NOW() - ($2 * INTERVAL '1 hour')
    GROUP BY 1 ORDER BY 1`, [id(req.params.id),hours,bucketSeconds]);
  res.json({bucketSeconds,rows:result.rows});
});
app.get('/api/ambulances/:id/history', async (req,res) => {
  const limit = number(req.query.limit ?? 500,'limit',1,2000);
  if (!Number.isInteger(limit)) throw fail('Limit must be an integer');
  const from = req.query.from ? date(req.query.from,'from') : new Date(Date.now()-86400000).toISOString();
  const to = req.query.to ? date(req.query.to,'to') : new Date().toISOString();
  if (from > to || Date.parse(to)-Date.parse(from)>31*86400000) throw fail('Select a range of up to 31 days');
  const result = await pool.query('SELECT * FROM vehicle_readings WHERE ambulance_id=$1 AND recorded_at BETWEEN $2 AND $3 ORDER BY recorded_at DESC,id DESC LIMIT $4',[id(req.params.id),from,to,limit]);
  res.json(result.rows.reverse());
});
app.get('/api/ambulances/:id/maintenance', async (req,res) => res.json((await pool.query('SELECT * FROM maintenance_records WHERE ambulance_id=$1 ORDER BY service_date DESC,id DESC',[id(req.params.id)])).rows));
app.post('/api/ambulances/:id/maintenance', authorize, async (req,res) => {
  const b=req.body, service=date(b.serviceDate,'service date'), next=date(b.nextServiceDate,'next service date');
  if (Date.parse(service)>Date.now() || next <= service) throw fail('Service date must be in the past and next service must follow it');
  if (typeof b.repairType!=='string' || !b.repairType.trim() || b.repairType.length>200 || typeof b.actor!=='string' || !b.actor.trim() || b.actor.length>100) throw fail('Repair type and operator name required');
  if (b.notes!==undefined && (typeof b.notes!=='string'||b.notes.length>5000)) throw fail('Invalid notes');
  if (b.failureOccurred!==undefined && typeof b.failureOccurred!=='boolean') throw fail('Invalid failure outcome');
  const odo=number(b.odometerKm,'odometer',0,10000000);
  const nextKm=b.nextServiceKm==null || b.nextServiceKm==='' ? null:number(b.nextServiceKm,'next service mileage',odo+1,10000000);
  const result=await pool.query(`INSERT INTO maintenance_records (ambulance_id,service_date,odometer_km,repair_type,notes,fault_codes,next_service_date,next_service_km,failure_occurred,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id(req.params.id),service,odo,b.repairType.trim(),b.notes||'',JSON.stringify(codes(b.faultCodes||[])),next,nextKm,b.failureOccurred||false,b.actor.trim()]);
  res.status(201).json(result.rows[0]);
});
app.post('/api/ambulances/:id/clear-inspection', authorize, async (req,res) => {
  const ambulanceId=id(req.params.id), {actor,notes}=req.body;
  if (typeof actor!=='string'||!actor.trim()||actor.length>100||typeof notes!=='string'||notes.trim().length<10||notes.length>5000) throw fail('Operator and inspection notes (at least 10 characters) required');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM ambulances WHERE id=$1 FOR UPDATE',[ambulanceId]);
    const a=(await fleet(client)).find(a=>a.id===ambulanceId);
    if (!a) throw fail('Ambulance not found',404);
    if (a.connection.status!=='LIVE'||!a.readiness.complete||a.alerts.length) throw fail('Clearance requires live, complete, normal telemetry and a service schedule',409);
    const result=await client.query('UPDATE safety_holds SET cleared_at=NOW(),cleared_by=$2,clearance_notes=$3 WHERE ambulance_id=$1 AND cleared_at IS NULL RETURNING *',[ambulanceId,actor.trim(),notes.trim()]);
    if (!result.rowCount) throw fail('No open inspection hold',409);
    await client.query('COMMIT'); res.json(result.rows[0]);
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
});
app.post('/api/dispatch/recommendations',roles('admin','dispatcher'), async (req,res) => {
  const lat=number(req.body.latitude,'latitude',-90,90),lon=number(req.body.longitude,'longitude',-180,180);
  const all=await fleet(), candidates=[],excluded=[];
  const routing=await require('./routing').travel(all.filter(a=>a.dispatch.eligible&&numeric(a.latitude)&&numeric(a.longitude)),lat,lon);
  for (const a of all) {
    if (!a.dispatch.eligible || !numeric(a.latitude)||!numeric(a.longitude)) {excluded.push({id:a.id,code:a.ambulance_code,reasons:[...a.dispatch.exclusionReasons,...(!numeric(a.latitude)||!numeric(a.longitude)?['GPS unavailable']:[])]});continue;}
    const route=routing.values.find(r=>r.id===a.id);
    if(!route?.reachable){excluded.push({id:a.id,code:a.ambulance_code,reasons:['No road route found']});continue;}
    const km=route.distanceKm;
    candidates.push({id:a.id,code:a.ambulance_code,distanceKm:Math.round(km*100)/100,durationMinutes:route.durationMinutes==null?null:Math.round(route.durationMinutes*10)/10,readiness:a.readiness.score,risk:a.risk.level,rankScore:a.readiness.score*.6+Number(a.fuel_level)*.1-(route.durationMinutes??Math.min(km,200)*2),reasons:['Live telemetry','No inspection hold','Service current']});
  }
  candidates.sort((a,b)=>b.rankScore-a.rankScore);
  res.json({evaluatedAt:new Date().toISOString(),candidates,excluded,routingMode:routing.mode,distanceType:routing.note,message:candidates.length?'Ranked eligible vehicles':'No suitable ambulance available'});
});
app.get('/api/fleet/coverage', async (req,res) => {
  const settings=(await pool.query('SELECT * FROM coverage_settings')).rows;
  const groups={};
  for(const a of await fleet()) {
    const name=a.hospital_name||'Unassigned';
    const g=groups[name] ||= {hospital:name,total:0,ready:0,unavailable:0,highRisk:0,minimum:settings.find(s=>s.hospital_name===name)?.minimum_ready||1};
    g.total++; a.dispatch.eligible?g.ready++:g.unavailable++; if(a.risk.level==='HIGH')g.highRisk++;
  }
  res.json(Object.values(groups).map(g=>({...g,risk:g.ready<g.minimum?'CRITICAL':g.ready===g.minimum?'WARNING':'ADEQUATE'})));
});
app.put('/api/fleet/coverage',roles('admin'),async(req,res)=>{
  const name=req.body.hospital;
  if(typeof name!=='string'||!name.trim()||name.length>200)throw fail('Hospital required');
  const minimum=number(req.body.minimum,'minimum coverage',1,1000);
  if(!Number.isInteger(minimum))throw fail('Minimum must be an integer');
  await require('./workflows').tx(async db=>{await db.query('INSERT INTO coverage_settings (hospital_name,minimum_ready) VALUES ($1,$2) ON CONFLICT (hospital_name) DO UPDATE SET minimum_ready=$2',[name,minimum]);await require('./security').audit(db,req.user,'COVERAGE_MINIMUM_CHANGED','coverage',null,null,{hospital:name,minimum});});res.json({message:'Coverage minimum saved'});
});
app.get('/api/fleet/availability',async(req,res)=>{
  const all=await fleet();
  const scheduled=(await pool.query("SELECT COUNT(*)::int AS count FROM work_orders WHERE status='in_progress' AND expected_completion IS NOT NULL")).rows[0].count;
  res.json({scheduledReturns:scheduled,method:'Conservative scenario, not a calibrated probability forecast. Assumes current status persists; excludes service due by horizon.',horizons:[0,3,7].map(days=>({days,total:all.length,expected:all.filter(a=>a.dispatch.eligible&&new Date(a.next_service_date).getTime()>=new Date(Date.now()+days*86400000).setUTCHours(0,0,0,0)).length,serviceDue:all.filter(a=>a.next_service_date&&new Date(a.next_service_date).getTime()<new Date(Date.now()+days*86400000).setUTCHours(0,0,0,0)).length,unknown:all.filter(a=>!a.readiness.complete||a.risk.level==='UNKNOWN').length}))});
});
app.get('/api/coverage-points',async(req,res)=>{
  const points=(await pool.query('SELECT * FROM coverage_points ORDER BY name')).rows;
  const available=(await fleet()).filter(a=>a.dispatch.eligible&&numeric(a.latitude)&&numeric(a.longitude));
  const results=[];
  for(const point of points){
    const routing=await require('./routing').travel(available,Number(point.latitude),Number(point.longitude));
    const within=routing.values.filter(v=>v.reachable&&v.durationMinutes!==null&&v.durationMinutes<=point.target_minutes);
    results.push({...point,mode:routing.mode,note:routing.note,withinTarget:routing.mode==='road'?within.length:null,risk:routing.mode!=='road'?'UNKNOWN':within.length===0?'CRITICAL':within.length===1?'WARNING':'ADEQUATE'});
  }
  res.json(results);
});
app.post('/api/coverage-points',roles('admin'),async(req,res)=>{
  const b=req.body;if(typeof b.name!=='string'||!b.name.trim()||b.name.length>200)throw fail('Point name required');
  const lat=number(b.latitude,'latitude',-90,90),lon=number(b.longitude,'longitude',-180,180),target=number(b.targetMinutes,'target minutes',1,180);
  if(!Number.isInteger(target))throw fail('Target must be whole minutes');
  const result=await require('./workflows').tx(async db=>{
    await db.query('LOCK TABLE coverage_points IN SHARE ROW EXCLUSIVE MODE');
    if(Number((await db.query('SELECT COUNT(*) FROM coverage_points')).rows[0].count)>=20)throw fail('Maximum 20 coverage points');
    const r=await db.query('INSERT INTO coverage_points(name,latitude,longitude,target_minutes) VALUES ($1,$2,$3,$4) ON CONFLICT(name) DO UPDATE SET latitude=$2,longitude=$3,target_minutes=$4 RETURNING *',[b.name.trim(),lat,lon,target]);
    await require('./security').audit(db,req.user,'COVERAGE_POINT_SAVED','coverage_point',r.rows[0].id,null,{name:b.name});return r.rows[0];
  });res.status(201).json(result);
});
require('./workflows').install(app,fleet);
app.use((err,req,res,next)=>{ console.error(err.message);res.status(err.status|| (err.code==='23503'?404:err.code==='23505'?409:500)).json({message:err.status?err.message:err.code==='23503'?'Referenced record not found':err.code==='23505'?'This record already exists or the vehicle is already assigned':'Request failed; check server logs'}); });
if(require.main===module) migrate().then(()=>app.listen(process.env.PORT||5000,()=>console.log('CHAP API ready'))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={app,fleet};
