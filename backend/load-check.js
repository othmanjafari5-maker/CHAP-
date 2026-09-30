// Opt-in, bounded, read-only smoke load check. No operational writes or login attempts.
const base=process.env.WAHI_URL,token=process.env.WAHI_TOKEN;
if(!base||!token)throw new Error('Set WAHI_URL and WAHI_TOKEN to an authorized test environment');
const concurrency=Number(process.env.WAHI_CONCURRENCY||5),requests=Number(process.env.WAHI_REQUESTS||100);
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>20||!Number.isInteger(requests)||requests<1||requests>1000)throw new Error('Use 1–20 concurrent requests and 1–1000 requests');
let next=0,failed=0;const times=[];
async function run(){while(next++<requests){const start=performance.now();try{const r=await fetch(`${base.replace(/\/$/,'')}/api/ambulances`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});await r.arrayBuffer();if(!r.ok)failed++;}catch{failed++;}times.push(performance.now()-start);}}
Promise.all(Array.from({length:concurrency},run)).then(()=>{times.sort((a,b)=>a-b);console.log(JSON.stringify({requests:times.length,failed,p50Ms:Math.round(times[Math.floor(times.length*.5)]),p95Ms:Math.round(times[Math.min(times.length-1,Math.floor(times.length*.95))])}));if(failed)process.exitCode=1;});
