// Local-only account provisioning; no public bootstrap endpoint.
require('dotenv').config({quiet:true,path:require('node:path').join(__dirname,'.env')});
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pool=require('./db');
const migrate=require('./migrate');
const {passwordHash,hash}=require('./security');
async function run(){
  await migrate();
  if(!(await pool.query('SELECT 1 FROM app_users LIMIT 1')).rowCount){
    const password=crypto.randomBytes(18).toString('base64url');
    await pool.query("INSERT INTO app_users(username,display_name,password_hash,role) VALUES ('admin','Administrator',$1,'admin')",[await passwordHash(password)]);
    const target=process.env.INITIAL_LOGIN_FILE||path.join(__dirname,'.initial-login');
    fs.writeFileSync(target,`Username: admin\nPassword: ${password}\n`,{mode:0o600});
    console.log(`Initial administrator credentials saved to ${target} (not printed).`);
  }else console.log('Accounts already exist; credentials unchanged.');
  if(process.argv.includes('--simulator')){
    const target=path.join(__dirname,'../simulator/devices.json');
    const entries=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):{};
    for(const a of (await pool.query("SELECT id,ambulance_code FROM ambulances WHERE ambulance_code IN ('AMB-001','AMB-002','AMB-003')")).rows){
      const device=await pool.query('SELECT 1 FROM devices WHERE ambulance_id=$1',[a.id]);
      if(device.rowCount)continue;
      const token=crypto.randomBytes(32).toString('hex');
      await pool.query('INSERT INTO devices(ambulance_id,name,token_hash) VALUES ($1,$2,$3)',[a.id,`Simulator ${a.ambulance_code}`,hash(token)]);
      entries[a.ambulance_code]={id:a.id,token};
    }
    fs.writeFileSync(target,JSON.stringify(entries,null,2)+'\n',{mode:0o600});
    console.log('Simulator credentials saved locally; existing device credentials retained.');
  }
}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
