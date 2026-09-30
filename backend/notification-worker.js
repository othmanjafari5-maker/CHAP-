require('dotenv').config({quiet:true,path:require('node:path').join(__dirname,'.env')});
const pool=require('./db');
const {configuration,escalate,deliverOne}=require('./notifications');
let stopping=false,timer,wake;
function stop(){stopping=true;clearTimeout(timer);wake?.();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
async function main(){
  const config=configuration();
  await require('./migrate')();
  console.log(JSON.stringify({service:'notifications',externalDelivery:!!config}));
  while(!stopping){
    try {
      await escalate();
      for(let i=0;i<10&&!stopping;i++){if(!await deliverOne(config))break;await pool.query("INSERT INTO worker_heartbeats(name,last_seen_at) VALUES ('notifications',NOW()) ON CONFLICT(name) DO UPDATE SET last_seen_at=NOW()");}
      await pool.query("INSERT INTO worker_heartbeats(name,last_seen_at) VALUES ('notifications',NOW()) ON CONFLICT(name) DO UPDATE SET last_seen_at=NOW()");
    }catch(e){console.error(JSON.stringify({service:'notifications',error:'Worker cycle failed',code:e.code||'unknown'}));}
    if(!stopping)await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,5000);});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
