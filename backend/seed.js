require('dotenv').config({ quiet: true, path: require('node:path').join(__dirname, '.env') });
const pool = require('./db');
const migrate = require('./migrate');
async function seed() {
  await migrate();
  for (let n=1;n<=3;n++) {
    await pool.query("INSERT INTO ambulances (ambulance_code,registration_number,hospital_name,status) VALUES ($1,$2,$3,'available') ON CONFLICT (ambulance_code) DO NOTHING",[`AMB-00${n}`,`DEMO-00${n}`,n===3?'District Hospital':'Central Hospital']);
  }
  console.log('Demo fleet seeded. Add actual service records through the dashboard; service readiness stays unknown until then.');
}
seed().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
