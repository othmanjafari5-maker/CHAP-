const {distance}=require('./intelligence');
// Configure a private OSRM-compatible service. No location data is sent to a public demo server.
async function travel(vehicles,latitude,longitude){
  const fallback=reason=>({mode:'straight-line',note:reason,values:vehicles.map(a=>({id:a.id,distanceKm:distance(a,latitude,longitude),durationMinutes:null,reachable:true}))});
  if(!process.env.ROUTING_URL)return fallback('Road routing is not configured; approximate straight-line distance only.');
  try{
    const chunks=[];for(let i=0;i<vehicles.length;i+=40)chunks.push(vehicles.slice(i,i+40));
    const values=[];
    for(let i=0;i<chunks.length;i+=4){
      const parts=await Promise.all(chunks.slice(i,i+4).map(async group=>{
        const coords=[...group.map(a=>`${Number(a.longitude)},${Number(a.latitude)}`),`${longitude},${latitude}`].join(';');
        const url=`${process.env.ROUTING_URL.replace(/\/$/,'')}/table/v1/driving/${coords}?sources=${group.map((_,n)=>n).join(';')}&destinations=${group.length}&annotations=distance,duration`;
        const response=await fetch(url,{signal:AbortSignal.timeout(4000)});
        if(!response.ok)throw new Error('Routing service failed');
        const body=await response.json();if(body.code!=='Ok'||body.distances?.length!==group.length||body.durations?.length!==group.length)throw new Error('Invalid routing response');
        return group.map((a,n)=>{const d=body.distances[n]?.[0],t=body.durations[n]?.[0];if(d!==null&&(!Number.isFinite(d)||d<0)||t!==null&&(!Number.isFinite(t)||t<0))throw new Error('Invalid route values');return {id:a.id,distanceKm:d===null?null:d/1000,durationMinutes:t===null?null:t/60,reachable:d!==null&&t!==null};});
      }));values.push(...parts.flat());
    }
    return {mode:'road',note:'Road-network driving estimate. Traffic and emergency driving conditions are not included.',values};
  }catch{return fallback('Road routing unavailable; fell back to approximate straight-line distance.');}
}
module.exports={travel};
