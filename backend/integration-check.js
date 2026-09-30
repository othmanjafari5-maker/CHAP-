// Runs against an isolated, temporary schema in the configured database.
require('dotenv').config({quiet:true, path: require('node:path').join(__dirname, '.env')});
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pool=require('./db');
pool.options.max=1;
const {passwordHash,hash}=require('./security');
let sessionToken;
const deviceToken=crypto.randomBytes(24).toString('hex');
const {app}=require('./server');
const migrate=require('./migrate');
const schema=`wahi_test_${Date.now()}`;
let server, schemaCreated=false;
async function run(){
  await pool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated=true;
  await pool.query(`SET search_path TO ${schema}`);
  await migrate();
  await pool.query("INSERT INTO ambulances (ambulance_code,status,hospital_name) VALUES ('TEST-1','available','Test Hospital')");
  await pool.query("INSERT INTO app_users(username,display_name,password_hash,role) VALUES ('tester','Test operator',$1,'admin')",[await passwordHash('test-password-long-123')]);
  await pool.query("INSERT INTO devices(ambulance_id,name,token_hash) VALUES (1,'Test device',$1)",[hash(deviceToken)]);
  await pool.query("INSERT INTO app_users(username,display_name,password_hash,role) VALUES ('crew','Test Crew',$1,'crew')",[await passwordHash('test-password-long-123')]);
  await pool.query("INSERT INTO crew_shifts(ambulance_id,driver_id,clinical_crew,starts_at,ends_at,created_by) SELECT 1,id,'Test clinician',NOW()-INTERVAL '1 hour',NOW()+INTERVAL '8 hours',1 FROM app_users WHERE username='crew'");
  await pool.query("INSERT INTO readiness_checks(shift_id,oxygen,equipment,cleaning,communications,crew_present,checked_by,expires_at) VALUES(1,true,true,true,true,true,1,NOW()+INTERVAL '8 hours')");
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,auth=true,method='POST'){
    const response=await fetch(base+path,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${path==='/api/readings'?deviceToken:sessionToken}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const login=await call('/api/auth/login',{username:'tester',password:'test-password-long-123'},false);
  assert.equal(login.status,200);sessionToken=login.body.token;
  assert.equal((await call('/api/ambulances',undefined,false)).status,401);
  const reading={ambulanceId:1,eventId:'first',recordedAt:new Date().toISOString(),latitude:0,longitude:0,speed:0,rpm:800,engineTemperature:86,batteryVoltage:12.7,fuelLevel:80,vibration:1,faultCodes:[],odometerKm:1000};
  assert.equal((await call('/api/readings',{...reading,batteryVoltage:null})).status,400);
  assert.equal((await call('/api/readings',reading)).status,201);
  assert.equal((await call('/api/readings',reading)).status,200);
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM vehicle_readings')).rows[0].count),1);
  const maintenance={serviceDate:new Date(Date.now()-86400000).toISOString(),nextServiceDate:new Date(Date.now()+30*86400000).toISOString(),odometerKm:900,nextServiceKm:5000,repairType:'Inspection',actor:'Test operator',faultCodes:[]};
  assert.equal((await call('/api/ambulances/1/maintenance',maintenance,false)).status,401);
  assert.equal((await call('/api/ambulances/1/maintenance',maintenance,true)).status,201);
  let fleet=(await call('/api/ambulances')).body;
  assert.equal(fleet[0].dispatch.eligible,true);
  assert.equal((await call('/api/dispatch/recommendations',{latitude:0,longitude:0})).body.candidates.length,1);
  assert.equal((await call('/api/readings',{...reading,eventId:'critical',engineTemperature:110,recordedAt:new Date().toISOString()})).status,201);
  assert.equal((await call('/api/ambulances')).body[0].safety.inspectionRequired,true);
  assert.equal((await call('/api/readings',{...reading,eventId:'old-healthy',recordedAt:new Date(Date.now()-86400000).toISOString()})).status,201);
  assert.equal(Number((await call('/api/ambulances')).body[0].engine_temperature),110);
  assert.equal((await call('/api/ambulances/1/clear-inspection',{actor:'Tester',notes:'Completed full inspection'},true)).status,409);
  assert.equal((await call('/api/readings',{...reading,eventId:'recovered',recordedAt:new Date().toISOString()})).status,201);
  assert.equal((await call('/api/ambulances')).body[0].dispatch.eligible,false);
  assert.equal((await call('/api/ambulances/1/clear-inspection',{actor:'Tester',notes:'Completed full inspection'},true)).status,200);
  assert.equal((await call('/api/ambulances')).body[0].dispatch.eligible,true);
  assert.equal((await call('/api/fleet/coverage')).body[0].ready,1);
  assert.equal((await call('/api/fleet/availability')).body.horizons.length,3);
  assert.equal((await call('/api/ambulances/1/history?limit=-1')).status,400);
  assert.equal((await call('/api/ambulances/1/history')).status,200);
  const trends=await call('/api/ambulances/1/trends?hours=1');
  assert.equal(trends.status,200);
  assert.ok(trends.body.rows.length>0);
  const faultTime=Date.now();
  for(const [offset,faultCodes] of [[100,['P0300']],[200,['P0300']],[300,[]],[400,['P0300']]]) {
    assert.equal((await call('/api/readings',{...reading,eventId:`fault-${offset}`,recordedAt:new Date(faultTime+offset).toISOString(),faultCodes})).status,201);
  }
  const faultTrends=(await call('/api/ambulances/1/trends?hours=1')).body;
  assert.equal(faultTrends.rows.reduce((sum,r)=>sum+(r.fault_events||0),0),2);
  assert.equal((await call('/api/fleet/coverage',{hospital:'Test Hospital',minimum:2},true,'PUT')).status,200);
  assert.equal((await call('/api/fleet/coverage')).body[0].minimum,2);
  await workflowChecks(call,reading,maintenance);
  console.log('Integration checks passed: validation, deduplication, auth, maintenance, late events, persistent holds, clearance, dispatch, coverage, forecast and history.');
}

async function workflowChecks(call,reading,maintenance){
  // Recover after fault-frequency test and prove actor identity cannot be forged.
  await call('/api/readings',{...reading,eventId:'workflow-normal',recordedAt:new Date(Date.now()+1000).toISOString()});
  assert.equal((await call('/api/ambulances/1/clear-inspection',{actor:'Impersonated',notes:'Verified the repaired vehicle and normal readings'})).status,200);
  const recorded=(await pool.query('SELECT cleared_by FROM safety_holds ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(recorded.cleared_by,'Test operator');
  const incident=(await call('/api/incidents',{description:'Integration mission',priority:'urgent',latitude:0,longitude:0})).body;
  const second=(await call('/api/incidents',{description:'Second mission',priority:'standard',latitude:0,longitude:0})).body;
  const assignments=await Promise.all([call(`/api/incidents/${incident.id}/assign`,{ambulanceId:1}),call(`/api/incidents/${second.id}/assign`,{ambulanceId:1})]);
  assert.deepEqual(assignments.map(r=>r.status).sort(),[200,409]);
  const assigned=assignments[0].status===200?incident:second;
  assert.equal((await call('/api/ambulances/1',{status:'available'},true,'PATCH')).status,409);
  assert.equal((await call(`/api/incidents/${assigned.id}/transition`,{status:'completed',notes:'Invalid skipped states'})).status,400);
  assert.equal((await call(`/api/incidents/${assigned.id}/transition`,{status:'en_route',notes:'Departure'})).status,409);
  const dispatcherSession=sessionToken;sessionToken=(await call('/api/auth/login',{username:'crew',password:'test-password-long-123'},false)).body.token;
  assert.equal((await call(`/api/crew/incidents/${assigned.id}/acknowledge`,{})).status,200);sessionToken=dispatcherSession;
  for(const status of ['en_route','on_scene','completed'])assert.equal((await call(`/api/incidents/${assigned.id}/transition`,{status,notes:'Integration transition'})).status,200);
  const job=(await call('/api/work-orders',{ambulanceId:1,title:'Test repair',technicianId:1,expectedCompletion:new Date(Date.now()+86400000).toISOString()})).body;
  assert.equal((await call(`/api/work-orders/${job.id}/transition`,{status:'in_progress',notes:'Repair started'})).status,200);
  assert.equal((await call('/api/ambulances/1',{status:'available'},true,'PATCH')).status,409);
  assert.equal((await call(`/api/work-orders/${job.id}/transition`,{status:'completed',notes:'Done',serviceRecordId:9999})).status,409);
  const service=(await call('/api/ambulances/1/maintenance',{...maintenance,serviceDate:new Date().toISOString()})).body;
  assert.equal((await call(`/api/work-orders/${job.id}/transition`,{status:'completed',notes:'Completed and tested',serviceRecordId:service.id})).status,200);
  assert.ok((await call('/api/ambulances/1/timeline')).body.some(e=>e.title==='INCIDENT_ASSIGNED'));
  const viewer=(await call('/api/users',{username:'viewer',displayName:'Viewer',role:'viewer',password:'test-password-viewer-123'})).body;
  const adminSession=sessionToken;
  sessionToken=(await call('/api/auth/login',{username:'viewer',password:'test-password-viewer-123'},false)).body.token;
  assert.equal((await call('/api/ambulances')).status,200);
  assert.equal((await call('/api/incidents',{description:'Unauthorized',priority:'urgent',latitude:0,longitude:0})).status,403);
  assert.equal((await call('/api/ambulances/1/maintenance',maintenance)).status,403);
  sessionToken=adminSession;
  assert.equal((await call(`/api/users/${viewer.id}`,{active:false},true,'PATCH')).status,200);
  assert.equal((await call('/api/users/1',{active:false},true,'PATCH')).status,409);
  assert.equal((await call('/api/readings',{...reading,eventId:'no-device'},false)).status,401);
  assert.equal((await call('/api/readings',{...reading,eventId:'wrong-vehicle',ambulanceId:2})).status,403);
  assert.equal((await call('/api/ambulances/1/device/revoke',{})).status,200);
  assert.equal((await call('/api/readings',{...reading,eventId:'revoked'})).status,403);
}

run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(schemaCreated){ await pool.query('SET search_path TO public');
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  await pool.end();
});
