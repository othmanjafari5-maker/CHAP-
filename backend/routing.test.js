const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {travel}=require('./routing');
test('routing distinguishes real road estimates, unreachable routes and fallback',async()=>{
  const previous=process.env.ROUTING_URL;delete process.env.ROUTING_URL;
  const fleet=[{id:1,latitude:0,longitude:0}];
  assert.equal((await travel(fleet,0,1)).mode,'straight-line');
  let payload={code:'Ok',distances:[[1200]],durations:[[180]]};
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));});
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    process.env.ROUTING_URL=`http://127.0.0.1:${server.address().port}`;
    const result=await travel(fleet,0,1);assert.equal(result.mode,'road');assert.equal(result.values[0].durationMinutes,3);assert.equal(result.values[0].distanceKm,1.2);
    payload={code:'Ok',distances:[[null]],durations:[[null]]};assert.equal((await travel(fleet,0,1)).values[0].reachable,false);
    payload={code:'InvalidQuery'};assert.equal((await travel(fleet,0,1)).mode,'straight-line');
  }finally{await new Promise(r=>server.close(r));if(previous===undefined)delete process.env.ROUTING_URL;else process.env.ROUTING_URL=previous;}
});
