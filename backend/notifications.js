const crypto = require('node:crypto');
const pool = require('./db');
const {roles,problem} = require('./security');
const {tx} = require('./workflows');
function page(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw problem('Invalid page parameter');
  return Number(value);
}
function configuration() {
  const url=process.env.NOTIFICATION_WEBHOOK_URL;
  if (!url) return null;
  const target=new URL(url);
  if (target.username||target.password||target.hash||target.search) throw new Error('Webhook URL must not contain credentials, fragments, or query parameters');
  if (target.protocol!=='https:' && !(process.env.NODE_ENV!=='production'&&target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname))) throw new Error('Webhook delivery requires HTTPS');
  if (!process.env.NOTIFICATION_WEBHOOK_SECRET || process.env.NOTIFICATION_WEBHOOK_SECRET.length<32) throw new Error('Webhook signing secret must contain at least 32 characters');
  return {url:target.href,secret:process.env.NOTIFICATION_WEBHOOK_SECRET};
}
async function escalate() {
  const minutes=Number(process.env.ALERT_ESCALATION_MINUTES||10);
  if (!Number.isFinite(minutes)||minutes<1||minutes>1440) throw new Error('Invalid alert escalation interval');
  await tx(async db=>{
    const alerts=await db.query(`UPDATE vehicle_alerts SET escalated_at=NOW() WHERE status='ACTIVE' AND severity='CRITICAL' AND acknowledged_at IS NULL AND escalated_at IS NULL AND created_at < NOW()-($1*INTERVAL '1 minute') RETURNING id,ambulance_id`,[minutes]);
    const missions=await db.query("UPDATE incidents SET acknowledgment_escalated_at=NOW() WHERE status='assigned' AND acknowledged_at IS NULL AND acknowledgment_escalated_at IS NULL AND updated_at<NOW()-INTERVAL '2 minutes' RETURNING id,ambulance_id");
    for(const m of missions.rows)await require('./security').audit(db,null,'MISSION_ACK_OVERDUE','incident',m.id,m.ambulance_id);
    for (const a of alerts.rows) await require('./security').audit(db,null,'ALERT_AUTO_ESCALATED','alert',a.id,a.ambulance_id,{minutes});
  });
}
async function deliverOne(config=configuration()) {
  if (!config) return false;
  const lease=crypto.randomUUID();
  const result=await pool.query(`UPDATE notifications SET delivery_status='sending',lease_token=$1,leased_at=NOW(),attempts=attempts+1
    WHERE id=(SELECT id FROM notifications WHERE (delivery_status='pending' AND next_attempt_at<=NOW()) OR (delivery_status='sending' AND leased_at<NOW()-INTERVAL '1 minute') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[lease]);
  if(!result.rowCount)return false;
  const n=result.rows[0], timestamp=String(Math.floor(Date.now()/1000));
  // No incident descriptions, coordinates, or operator notes leave this system.
  const body=JSON.stringify({id:n.id,application:'WAHI',kind:n.kind,ambulanceId:n.ambulance_id,entityType:n.entity_type,entityId:n.entity_id,createdAt:n.created_at});
  const signature=crypto.createHmac('sha256',config.secret).update(`${timestamp}.${body}`).digest('hex');
  try {
    const response=await fetch(config.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-WAHI-Timestamp':timestamp,'X-WAHI-Signature':`sha256=${signature}`,'Idempotency-Key':`wahi-${n.id}`},body});
    await response.body?.cancel();
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    await pool.query("UPDATE notifications SET delivery_status='delivered',delivered_at=NOW(),last_error=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",[n.id,lease]);
  } catch(error) {
    const reason=/^HTTP \d{3}$/.test(error.message)?error.message:'Delivery failed or timed out';
    await pool.query(`UPDATE notifications SET delivery_status=$3,last_error=$4,next_attempt_at=NOW()+($5*INTERVAL '1 second'),lease_token=NULL WHERE id=$1 AND lease_token=$2`,[n.id,lease,n.attempts>=8?'failed':'pending',reason,Math.min(3600,15*2**Math.min(n.attempts,8))]);
  }
  return true;
}
function install(app) {
  app.get('/api/notifications',async(req,res)=>{
    const limit=page(req.query.limit,25,100),before=page(req.query.before,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);
    const unread=req.query.unread==='true';
    const r=await pool.query(`SELECT n.id,n.kind,n.title,n.ambulance_id,n.entity_type,n.entity_id,n.created_at,r.read_at FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE n.id<$2 AND ($3::boolean=FALSE OR r.notification_id IS NULL) ORDER BY n.id DESC LIMIT $4`,[req.user.id,before,unread,limit+1]);
    const count=await pool.query('SELECT COUNT(*)::int AS count FROM notifications n WHERE NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)',[req.user.id]);
    res.json({rows:r.rows.slice(0,limit),nextBefore:r.rows.length>limit?r.rows[limit-1].id:null,unreadCount:count.rows[0].count});
  });
  app.post('/api/notifications/:id/read',async(req,res)=>{
    const id=page(req.params.id,null,Number.MAX_SAFE_INTEGER);
    const found=await pool.query('SELECT id FROM notifications WHERE id=$1',[id]);
    if(!found.rowCount)throw problem('Notification not found',404);
    await pool.query('INSERT INTO notification_reads(notification_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[id,req.user.id]);res.json({message:'Marked as read'});
  });
  app.get('/api/system/status',roles('admin'),async(req,res)=>{
    const queue=await pool.query('SELECT delivery_status,COUNT(*)::int AS count FROM notifications GROUP BY delivery_status');
    const worker=(await pool.query("SELECT last_seen_at FROM worker_heartbeats WHERE name='notifications'")).rows[0];
    res.json({database:'connected',webhookConfigured:!!process.env.NOTIFICATION_WEBHOOK_URL,workerLastSeen:worker?.last_seen_at||null,workerHealthy:!!worker&&Date.now()-new Date(worker.last_seen_at).getTime()<60000,queue:queue.rows});
  });
  app.get('/api/notification-deliveries',roles('admin'),async(req,res)=>res.json((await pool.query("SELECT id,kind,delivery_status,attempts,last_error,next_attempt_at,created_at FROM notifications WHERE delivery_status<>'delivered' ORDER BY id DESC LIMIT 100")).rows));
  app.post('/api/notification-deliveries/:id/retry',roles('admin'),async(req,res)=>{
    const id=page(req.params.id,null,Number.MAX_SAFE_INTEGER);
    await tx(async db=>{
      const r=await db.query("UPDATE notifications SET delivery_status='pending',attempts=0,next_attempt_at=NOW(),last_error=NULL WHERE id=$1 AND delivery_status='failed' RETURNING id",[id]);
      if(!r.rowCount)throw problem('Only failed deliveries can be retried',409);
      await require('./security').audit(db,req.user,'NOTIFICATION_RETRIED','notification',null,null,{notificationId:id});
    });res.json({message:'Delivery queued again'});
  });
}
module.exports={install,deliverOne,escalate,configuration,page};
