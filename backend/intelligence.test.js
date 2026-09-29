const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,connection,features,distance,numeric}=require('./intelligence');
const now=Date.now();
const healthy={status:'available',recorded_at:new Date(now).toISOString(),fuel_level:80,battery_voltage:12.7,engine_temperature:86,vibration:1,fault_codes:[],odometer_km:1000,next_service_km:2000,next_service_date:new Date(now+86400000).toISOString()};
test('complete healthy vehicle is ready',()=>{const a=assess(healthy,[],now);assert.equal(a.readiness.score,100);assert.equal(a.dispatch.eligible,true);});
test('unknown sensors never become healthy zeroes',()=>{const a=assess({...healthy,battery_voltage:null},[],now);assert.equal(a.readiness.score,null);assert.equal(a.dispatch.eligible,false);});
test('critical temperature overrides average score',()=>{const a=assess({...healthy,engine_temperature:110},[],now);assert.equal(a.readiness.score,80);assert.equal(a.dispatch.eligible,false);});
test('hold persists even with normal telemetry',()=>assert.equal(assess({...healthy,hold_id:1},[],now).dispatch.eligible,false));
test('busy, stale, overdue and unknown service vehicles are excluded',()=>{for(const change of [{status:'responding'},{recorded_at:new Date(now-61000).toISOString()},{next_service_date:new Date(now-86400000).toISOString()},{next_service_date:null}])assert.equal(assess({...healthy,...change},[],now).dispatch.eligible,false);});
test('freshness transitions without new observations',()=>{assert.equal(connection(new Date(now-15000),now).status,'LIVE');assert.equal(connection(new Date(now-16000),now).status,'DELAYED');assert.equal(connection(new Date(now-61000),now).status,'OFFLINE');assert.equal(connection(null,now).status,'UNKNOWN');});
test('risk requires enough samples and elapsed time',()=>{assert.equal(features([]),null);assert.equal(features(Array(12).fill(healthy)),null);});
test('distance supports valid zero coordinates',()=>assert.equal(distance({latitude:0,longitude:0},0,0),0));

test('coercible nonnumeric values are rejected',()=>{for(const value of [true,false,[],{},' ',null])assert.equal(numeric(value),false);});
test('mileage-based service requires a current odometer',()=>assert.equal(assess({...healthy,odometer_km:null},[],now).dispatch.eligible,false));

test('demo predictions cannot veto otherwise eligible vehicles',()=>{const history=Array.from({length:120},(_,i)=>({recorded_at:new Date(now-(120-i)*5000).toISOString(),battery_voltage:11-i*.001,engine_temperature:110,vibration:4+i*.01,fault_codes:['P0300']}));const a=assess(healthy,history,now);assert.equal(a.dispatch.eligible,true);assert.ok(!a.dispatch.exclusionReasons.some(r=>r.includes('demo')));});
