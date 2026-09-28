// Runs against an isolated, temporary schema in the configured database.
require('dotenv').config({quiet:true, path: require('node:path').join(__dirname, '.env')});
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pool=require('./db');
pool.options.max=1;
process.env.ADMIN_TOKEN=crypto.randomBytes(24).toString('hex');
const {app}=require('./server');
const migrate=require('./migrate');
const schema=`chap_test_${Date.now()}`;
let server, schemaCreated=false;
async function run(){
  await pool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated=true;
  await pool.query(`SET search_path TO ${schema}`);
  await migrate();
  await pool.query("INSERT INTO ambulances (ambulance_code,status,hospital_name) VALUES ('TEST-1','available','Test Hospital')");
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,auth=false,method='POST'){
    const response=await fetch(base+path,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${process.env.ADMIN_TOKEN}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  const reading={ambulanceId:1,eventId:'first',recordedAt:new Date().toISOString(),latitude:0,longitude:0,speed:0,rpm:800,engineTemperature:86,batteryVoltage:12.7,fuelLevel:80,vibration:1,faultCodes:[],odometerKm:1000};
  assert.equal((await call('/api/readings',{...reading,batteryVoltage:null})).status,400);
  assert.equal((await call('/api/readings',reading)).status,201);
  assert.equal((await call('/api/readings',reading)).status,200);
  assert.equal(Number((await pool.query('SELECT COUNT(*) FROM vehicle_readings')).rows[0].count),1);
  const maintenance={serviceDate:new Date(Date.now()-86400000).toISOString(),nextServiceDate:new Date(Date.now()+30*86400000).toISOString(),odometerKm:900,nextServiceKm:5000,repairType:'Inspection',actor:'Test operator',faultCodes:[]};
  assert.equal((await call('/api/ambulances/1/maintenance',maintenance)).status,401);
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
  console.log('Integration checks passed: validation, deduplication, auth, maintenance, late events, persistent holds, clearance, dispatch, coverage, forecast and history.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(schemaCreated){ await pool.query('SET search_path TO public');
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  await pool.end();
});
