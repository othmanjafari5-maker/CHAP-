const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const pool = require('./db');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const problem = (message,status=400) => Object.assign(new Error(message),{status});
async function passwordHash(password) {
  if(typeof password!=='string'||password.length<12||password.length>128)throw problem('Password must contain 12–128 characters');
  const salt=crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;
}
async function verify(password, stored) {
  if(typeof password!=='string'||password.length>128)return false;
  const [salt,key]=stored.split(':');
  const calculated=await scrypt(password,salt,64);
  const expected=Buffer.from(key,'hex');
  return expected.length===calculated.length&&crypto.timingSafeEqual(expected,calculated);
}
function bearer(req){return /^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1]||'';}
async function identity(req,res,next) {
  const token=bearer(req);
  if(token){
    const result=await pool.query(`SELECT u.id,u.username,u.display_name,u.role FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active`,[hash(token)]);
    req.user=result.rows[0];
  }
  next();
}
function roles(...allowed) {
  return (req,res,next)=>{
    if(!req.user)return res.status(401).json({message:'Sign in to continue'});
    if(allowed.length&&!allowed.includes(req.user.role))return res.status(403).json({message:'Your role cannot perform this action'});
    if(req.body&&typeof req.body==='object')req.body.actor=req.user.display_name;
    next();
  };
}
async function device(req,res,next) {
  const token=bearer(req);
  if(!token||token.length>200)return res.status(401).json({message:'Device credentials required'});
  const result=await pool.query('SELECT ambulance_id FROM devices WHERE token_hash=$1 AND active',[hash(token)]);
  if(!result.rowCount||Number(req.body?.ambulanceId)!==result.rows[0].ambulance_id)return res.status(403).json({message:'Device is not authorized for this ambulance'});
  next();
}
async function audit(db,user,action,type,entityId,ambulanceId,details={}) {
  await db.query('INSERT INTO audit_events (ambulance_id,actor_id,actor_name,action,entity_type,entity_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7)',[ambulanceId||null,user?.id||null,user?.display_name||'System',action,type,entityId||null,JSON.stringify(details)]);
}
function authRoutes(app) {
  app.post('/api/auth/login',async(req,res)=>{
    const username=typeof req.body?.username==='string'?req.body.username.trim().toLowerCase():'';
    const key=hash(req.ip||'unknown');
    const throttle=await pool.query(`INSERT INTO login_limits (key,attempts,reset_at) VALUES ($1,1,NOW()+INTERVAL '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.reset_at<NOW() THEN 1 ELSE login_limits.attempts+1 END,reset_at=CASE WHEN login_limits.reset_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE login_limits.reset_at END RETURNING attempts`,[key]);
    if(throttle.rows[0].attempts>30)throw problem('Too many sign-in attempts. Try again after 15 minutes.',429);
    const result=await pool.query('SELECT * FROM app_users WHERE username=$1 AND active',[username]);
    const user=result.rows[0];
    // Perform a hash even for nonexistent users to avoid a cheap account probe.
    const valid=await verify(req.body?.password,user?.password_hash||`${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!user||!valid)throw problem('Invalid username or password',401);
    const token=crypto.randomBytes(32).toString('hex');
    await pool.query("DELETE FROM sessions WHERE expires_at<NOW()");
    await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '8 hours')",[hash(token),user.id]);
    res.json({token,user:{id:user.id,username:user.username,display_name:user.display_name,role:user.role}});
  });
  app.post('/api/auth/logout',identity,roles(),async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(bearer(req))]);res.json({message:'Signed out'});});
  app.get('/api/auth/me',identity,roles(),(req,res)=>res.json(req.user));
}
module.exports={hash,passwordHash,verify,identity,roles,device,audit,authRoutes,problem};
