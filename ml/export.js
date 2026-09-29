// Local dataset export. No credentials or data are sent to external services.
require('../backend/node_modules/dotenv').config({quiet:true,path:require('node:path').join(__dirname,'../backend/.env')});
const fs=require('node:fs');
const pool=require('../backend/db');
const {features}=require('../backend/intelligence');
const output=process.argv[2];
if(!output){console.error('Usage: node ml/export.js /path/to/review-windows.csv');process.exit(1);}
const names=['vehicle_id','observed_at','battery_voltage','battery_slope_per_hour','overheat_fraction','vibration','vibration_slope_per_hour','fault_fraction','failure_within_7_days','verified_through','outcome_verified'];
async function run(){
  const result=await pool.query(`WITH anchors AS (
    SELECT ambulance_id,DATE_TRUNC('day',recorded_at) AS day,MAX(recorded_at) AS observed_at
    FROM vehicle_readings WHERE source='device' AND event_id IS NOT NULL AND recorded_at>=NOW()-INTERVAL '90 days' AND recorded_at<NOW()-INTERVAL '7 days'
    GROUP BY 1,2
  ) SELECT a.ambulance_id,a.observed_at,h.history FROM anchors a
  CROSS JOIN LATERAL (SELECT json_agg(t ORDER BY t.recorded_at,t.id) AS history FROM
    (SELECT id,recorded_at,battery_voltage,engine_temperature,vibration,fault_codes FROM vehicle_readings
     WHERE ambulance_id=a.ambulance_id AND source='device' AND event_id IS NOT NULL AND recorded_at<=a.observed_at ORDER BY recorded_at DESC,id DESC LIMIT 120) t) h
  ORDER BY a.ambulance_id,a.observed_at`);
  const lines=[names.join(',')];
  for(const row of result.rows){const input=features(row.history||[]);if(input)lines.push([row.ambulance_id,new Date(row.observed_at).toISOString(),...input,'','',''].join(','));}
  fs.writeFileSync(output,lines.join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log(`Exported ${lines.length-1} windows. Outcome columns are deliberately blank and must be reviewed against actual follow-up records.`);
}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
