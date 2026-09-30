const crypto=require('node:crypto');
const pool=require('./db');
const {roles,identity,hash,passwordHash,verify,audit,problem}=require('./security');
const {tx}=require('./workflows');
const {page}=require('./notifications');
async function throttle(req){
  const key=hash(`recovery:${req.ip}`);
  const r=await pool.query(`INSERT INTO login_limits(key,attempts,reset_at) VALUES ($1,1,NOW()+INTERVAL '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.reset_at<NOW() THEN 1 ELSE login_limits.attempts+1 END,reset_at=CASE WHEN login_limits.reset_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE login_limits.reset_at END RETURNING attempts`,[key]);
  if(r.rows[0].attempts>10)throw problem('Too many recovery attempts. Try again after 15 minutes.',429);
}
function publicRoutes(app){
  app.post('/api/auth/recovery-request',async(req,res)=>{
    await throttle(req);
    const username=typeof req.body?.username==='string'?req.body.username.trim().toLowerCase().slice(0,60):'';
    await pool.query(`INSERT INTO password_recoveries(user_id) SELECT id FROM app_users WHERE username=$1 AND active ON CONFLICT(user_id) WHERE used_at IS NULL DO NOTHING`,[username]);
    res.json({message:'If this account is active, an administrator can verify your identity and issue a recovery code. Contact your administrator.'});
  });
  app.post('/api/auth/recover',async(req,res)=>{
    await throttle(req);
    if(typeof req.body?.code!=='string'||!/^[a-f0-9]{64}$/.test(req.body.code))throw problem('Invalid or expired recovery code');
    const encoded=await passwordHash(req.body.password);
    await tx(async db=>{
      const candidate=(await db.query('SELECT user_id FROM password_recoveries WHERE token_hash=$1',[hash(req.body.code)])).rows[0];
      if(!candidate)throw problem('Invalid or expired recovery code');
      const user=(await db.query('SELECT * FROM app_users WHERE id=$1 FOR UPDATE',[candidate.user_id])).rows[0];
      const r=await db.query('UPDATE password_recoveries SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING id',[hash(req.body.code)]);
      if(!user?.active||!r.rowCount)throw problem('Invalid or expired recovery code');
      await db.query('UPDATE app_users SET password_hash=$2 WHERE id=$1',[user.id,encoded]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      await audit(db,user,'PASSWORD_RECOVERED','user',user.id,null);
    });res.json({message:'Password reset. Sign in with your new password.'});
  });
  app.post('/api/auth/password',identity,roles(),async(req,res)=>{
    const encoded=await passwordHash(req.body?.password);
    await tx(async db=>{
      const user=(await db.query('SELECT * FROM app_users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
      if(!user?.active||!await verify(req.body.currentPassword,user.password_hash))throw problem('Current password is incorrect',400);
      await db.query('UPDATE app_users SET password_hash=$2 WHERE id=$1',[user.id,encoded]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      await db.query('UPDATE password_recoveries SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.id]);
      await audit(db,req.user,'PASSWORD_CHANGED','user',user.id,null);
    });res.json({message:'Password changed. Sign in again on all devices.'});
  });
}
function csv(rows,columns){
  const escape=value=>{
    let text=value==null?'':value instanceof Date?value.toISOString():String(value);
    if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return [columns.map(escape).join(','),...rows.map(r=>columns.map(c=>escape(r[c])).join(','))].join('\r\n')+'\r\n';
}
const reports={
 incidents:{table:'incidents',time:'created_at',columns:['id','reference','priority','status','ambulance_id','created_at','updated_at','completed_at']},
 maintenance:{table:'maintenance_records',time:'created_at',columns:['id','ambulance_id','service_date','odometer_km','repair_type','next_service_date','next_service_km','created_at']},
 alerts:{table:'vehicle_alerts',time:'created_at',columns:['id','ambulance_id','alert_type','severity','status','created_at','acknowledged_at','escalated_at','resolved_at']},
};
function range(query){
 const from=new Date(query.from),to=new Date(query.to);
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to-from>366*86400000)throw problem('Choose a valid date range of up to 366 days');
 return [from,to];
}
function install(app){
 app.get('/api/recovery-requests',roles('admin'),async(req,res)=>res.json((await pool.query('SELECT r.id,r.requested_at,r.expires_at,u.username,u.display_name FROM password_recoveries r JOIN app_users u ON u.id=r.user_id WHERE r.used_at IS NULL AND u.active ORDER BY r.requested_at LIMIT 100')).rows));
 app.post('/api/recovery-requests/:id/issue',roles('admin'),async(req,res)=>{
   if(req.body?.identityVerified!==true)throw problem('Verify the account owner’s identity before issuing a code');
   const code=crypto.randomBytes(32).toString('hex');
   await tx(async db=>{
     const id=page(req.params.id,null,Number.MAX_SAFE_INTEGER);
     const r=await db.query("UPDATE password_recoveries SET token_hash=$2,expires_at=NOW()+INTERVAL '15 minutes',issued_by=$3 WHERE id=$1 AND used_at IS NULL RETURNING user_id",[id,hash(code),req.user.id]);
     if(!r.rowCount)throw problem('Recovery request no longer available',404);
     await audit(db,req.user,'RECOVERY_CODE_ISSUED','user',r.rows[0].user_id,null);
   });res.json({code,message:'Code expires in 15 minutes and can be used once. Give it privately to the verified account owner.'});
 });
 app.get('/api/reports/:kind',async(req,res)=>{
   const report=Object.hasOwn(reports,req.params.kind)?reports[req.params.kind]:null;if(!report)throw problem('Report not found',404);
   const [from,to]=range(req.query),limit=50,before=page(req.query.before,2147483647,2147483647);
   const exportCSV=req.query.format==='csv';
   const result=await pool.query(`SELECT ${report.columns.join(',')} FROM ${report.table} WHERE ${report.time}>=$1 AND ${report.time}<$2 AND id<$3 ORDER BY id DESC LIMIT $4`,[from,to,before,exportCSV?10001:limit+1]);
   if(exportCSV){if(result.rowCount>10000)throw problem('Export exceeds 10,000 rows. Choose a shorter date range.',400);res.json({filename:`wahi-${req.params.kind}-${from.toISOString().slice(0,10)}.csv`,csv:csv(result.rows,report.columns),count:result.rowCount});}
   else res.json({rows:result.rows.slice(0,limit),columns:report.columns,nextBefore:result.rowCount>limit?result.rows[limit-1].id:null});
 });
}
module.exports={publicRoutes,install,csv};
