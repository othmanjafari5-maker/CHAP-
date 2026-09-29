const crypto=require('node:crypto');
const pool=require('./db');
const {roles,passwordHash,hash,audit,problem}=require('./security');
const text=(v,name,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw problem(`${name} is required (maximum ${max} characters)`);return v.trim();};
const positive=v=>{if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)<1)throw problem('Invalid identifier');return Number(v);};
const choice=(v,allowed)=>{if(!allowed.includes(v))throw problem(`Choose one of: ${allowed.join(', ')}`);return v;};
async function tx(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
async function vehicleLock(db,id){const r=await db.query('SELECT * FROM ambulances WHERE id=$1 FOR UPDATE',[positive(id)]);if(!r.rowCount)throw problem('Ambulance not found',404);return r.rows[0];}
function install(app,fleet){
  app.get('/api/users',roles(),async(req,res)=>res.json((await pool.query('SELECT id,username,display_name,role,active FROM app_users ORDER BY display_name')).rows));
  app.post('/api/users',roles('admin'),async(req,res)=>{
    const b=req.body,username=text(b.username,'Username',60).toLowerCase();
    if(!/^[a-z0-9_.-]+$/.test(username))throw problem('Username must use letters, numbers, dots, underscores or hyphens');
    const encoded=await passwordHash(b.password);
    const result=await tx(async db=>{const r=await db.query('INSERT INTO app_users(username,display_name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,username,display_name,role,active',[username,text(b.displayName,'Name',100),encoded,choice(b.role,['admin','dispatcher','mechanic','viewer'])]);await audit(db,req.user,'USER_CREATED','user',r.rows[0].id,null,{role:b.role});return r.rows[0];});res.status(201).json(result);
  });
  app.patch('/api/users/:id',roles('admin'),async(req,res)=>{
    const userId=positive(req.params.id),b=req.body;
    const encoded=b.password?await passwordHash(b.password):null;
    const result=await tx(async db=>{
      await db.query('LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE');
      const old=(await db.query('SELECT * FROM app_users WHERE id=$1',[userId])).rows[0];if(!old)throw problem('User not found',404);
      const role=b.role===undefined?old.role:choice(b.role,['admin','dispatcher','mechanic','viewer']);
      if(b.active!==undefined&&typeof b.active!=='boolean')throw problem('Invalid account status');
      const active=b.active??old.active;
      if(old.role==='admin'&&old.active&&(!active||role!=='admin')&&Number((await db.query("SELECT COUNT(*) FROM app_users WHERE role='admin' AND active")).rows[0].count)<=1)throw problem('Keep at least one active administrator',409);
      const r=await db.query('UPDATE app_users SET role=$2,active=$3,password_hash=COALESCE($4,password_hash) WHERE id=$1 RETURNING id,username,display_name,role,active',[userId,role,active,encoded]);
      await db.query('DELETE FROM sessions WHERE user_id=$1',[userId]);await audit(db,req.user,'USER_UPDATED','user',userId,null,{role,active,passwordReset:!!encoded});return r.rows[0];
    });res.json(result);
  });
  app.post('/api/ambulances',roles('admin'),async(req,res)=>{
    const b=req.body;res.status(201).json(await tx(async db=>{const r=await db.query("INSERT INTO ambulances(ambulance_code,registration_number,hospital_name,status) VALUES ($1,$2,$3,'available') RETURNING *",[text(b.code,'Vehicle code',50),text(b.registration,'Registration',100),text(b.hospital,'Hospital',200)]);await audit(db,req.user,'VEHICLE_REGISTERED','ambulance',r.rows[0].id,r.rows[0].id);return r.rows[0];}));
  });
  app.patch('/api/ambulances/:id',roles('admin'),async(req,res)=>{
    const b=req.body;res.json(await tx(async db=>{
      const a=await vehicleLock(db,req.params.id);
      const status=b.status===undefined?a.status:choice(b.status,['available','maintenance','retired']);
      if(b.status!==undefined){
        if((await db.query("SELECT 1 FROM incidents WHERE ambulance_id=$1 AND status NOT IN ('completed','cancelled')",[a.id])).rowCount)throw problem('Finish or cancel the active mission before changing vehicle status',409);
        if(status==='available'&&(await db.query("SELECT 1 FROM work_orders WHERE ambulance_id=$1 AND status='in_progress'",[a.id])).rowCount)throw problem('Complete the active maintenance job first',409);
      }
      const r=await db.query('UPDATE ambulances SET registration_number=$2,hospital_name=$3,status=$4 WHERE id=$1 RETURNING *',[a.id,b.registration===undefined?a.registration_number:text(b.registration,'Registration',100),b.hospital===undefined?a.hospital_name:text(b.hospital,'Hospital',200),status]);
      await audit(db,req.user,'VEHICLE_UPDATED','ambulance',a.id,a.id,{from:a.status,to:status,hospital:r.rows[0].hospital_name});return r.rows[0];
    }));
  });
  app.get('/api/devices',roles('admin'),async(req,res)=>res.json((await pool.query('SELECT d.ambulance_id,a.ambulance_code,d.name,d.active,d.rotated_at FROM devices d JOIN ambulances a ON a.id=d.ambulance_id ORDER BY a.id')).rows));
  app.post('/api/ambulances/:id/device',roles('admin'),async(req,res)=>{
    const token=crypto.randomBytes(32).toString('hex');
    await tx(async db=>{const a=await vehicleLock(db,req.params.id);await db.query('INSERT INTO devices(ambulance_id,name,token_hash) VALUES ($1,$2,$3) ON CONFLICT(ambulance_id) DO UPDATE SET name=$2,token_hash=$3,active=TRUE,rotated_at=NOW()',[a.id,text(req.body.name,'Device name',100),hash(token)]);await audit(db,req.user,'DEVICE_KEY_ROTATED','device',a.id,a.id);});
    res.json({token,message:'Save this device key now. It is shown once; the previous key no longer works.'});
  });
  app.post('/api/ambulances/:id/device/revoke',roles('admin'),async(req,res)=>{
    await tx(async db=>{const a=await vehicleLock(db,req.params.id);await db.query('UPDATE devices SET active=FALSE WHERE ambulance_id=$1',[a.id]);await audit(db,req.user,'DEVICE_REVOKED','device',a.id,a.id);});res.json({message:'Device access revoked'});
  });
  app.get('/api/incidents',roles(),async(req,res)=>res.json((await pool.query('SELECT i.*,a.ambulance_code FROM incidents i LEFT JOIN ambulances a ON a.id=i.ambulance_id ORDER BY i.created_at DESC LIMIT 200')).rows));
  app.post('/api/incidents',roles('admin','dispatcher'),async(req,res)=>{
    const b=req.body;
    if(typeof b.latitude!=='number'||typeof b.longitude!=='number'||!Number.isFinite(b.latitude)||!Number.isFinite(b.longitude)||Math.abs(b.latitude)>90||Math.abs(b.longitude)>180)throw problem('Valid incident coordinates required');
    res.status(201).json(await tx(async db=>{const r=await db.query('INSERT INTO incidents(reference,description,priority,latitude,longitude,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[`INC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,text(b.description,'Incident description',2000),choice(b.priority,['urgent','standard']),b.latitude,b.longitude,req.user.id]);await audit(db,req.user,'INCIDENT_CREATED','incident',r.rows[0].id,null,{reference:r.rows[0].reference});return r.rows[0];}));
  });
  app.post('/api/incidents/:id/assign',roles('admin','dispatcher'),async(req,res)=>{
    res.json(await tx(async db=>{
      const incident=(await db.query('SELECT * FROM incidents WHERE id=$1 FOR UPDATE',[positive(req.params.id)])).rows[0];
      if(!incident)throw problem('Incident not found',404);if(incident.status!=='open')throw problem('Incident is already assigned or closed',409);
      const a=await vehicleLock(db,req.body.ambulanceId);
      const current=(await fleet(db)).find(v=>v.id===a.id);
      if(!current.dispatch.eligible)throw problem(`Vehicle is not eligible: ${current.dispatch.exclusionReasons.join('; ')}`,409);
      if((await db.query("SELECT 1 FROM work_orders WHERE ambulance_id=$1 AND status='in_progress'",[a.id])).rowCount)throw problem('Maintenance in progress',409);
      await db.query("UPDATE ambulances SET status='responding' WHERE id=$1",[a.id]);
      const r=await db.query("UPDATE incidents SET ambulance_id=$2,status='assigned',updated_at=NOW() WHERE id=$1 RETURNING *",[incident.id,a.id]);
      await audit(db,req.user,'INCIDENT_ASSIGNED','incident',incident.id,a.id,{reference:incident.reference});return r.rows[0];
    }));
  });
  app.post('/api/incidents/:id/transition',roles('admin','dispatcher'),async(req,res)=>{
    res.json(await tx(async db=>{
      const incident=(await db.query('SELECT * FROM incidents WHERE id=$1 FOR UPDATE',[positive(req.params.id)])).rows[0];if(!incident)throw problem('Incident not found',404);
      const flow={open:['cancelled'],assigned:['en_route','cancelled'],en_route:['on_scene','cancelled'],on_scene:['transporting','completed','cancelled'],transporting:['completed'],completed:[],cancelled:[]};
      const next=choice(req.body.status,flow[incident.status]);
      const notes=text(req.body.notes,'Transition notes',2000);
      if(incident.ambulance_id){await vehicleLock(db,incident.ambulance_id);if(['completed','cancelled'].includes(next))await db.query("UPDATE ambulances SET status='available' WHERE id=$1",[incident.ambulance_id]);}
      const r=await db.query("UPDATE incidents SET status=$2,updated_at=NOW(),completed_at=CASE WHEN $2 IN ('completed','cancelled') THEN NOW() ELSE NULL END WHERE id=$1 RETURNING *",[incident.id,next]);
      await audit(db,req.user,'INCIDENT_STATUS_CHANGED','incident',incident.id,incident.ambulance_id,{from:incident.status,to:next,notes});return r.rows[0];
    }));
  });
  app.get('/api/work-orders',roles(),async(req,res)=>res.json((await pool.query('SELECT w.*,a.ambulance_code,u.display_name AS technician FROM work_orders w JOIN ambulances a ON a.id=w.ambulance_id LEFT JOIN app_users u ON u.id=w.technician_id ORDER BY w.created_at DESC LIMIT 200')).rows));
  app.post('/api/work-orders',roles('admin','mechanic'),async(req,res)=>{
    const b=req.body;res.status(201).json(await tx(async db=>{
      const a=await vehicleLock(db,b.ambulanceId);
      const technician=b.technicianId?positive(b.technicianId):null;
      if(technician&&!(await db.query("SELECT 1 FROM app_users WHERE id=$1 AND active AND role IN ('admin','mechanic')",[technician])).rowCount)throw problem('Choose an active mechanic');
      const due=b.expectedCompletion?new Date(b.expectedCompletion):null;
      if(due&&(!Number.isFinite(due.getTime())||due<=new Date()))throw problem('Expected completion must be in the future');
      const r=await db.query('INSERT INTO work_orders(ambulance_id,title,notes,technician_id,expected_completion,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[a.id,text(b.title,'Job title',200),b.notes?text(b.notes,'Notes',3000):'',technician,due,req.user.id]);
      await audit(db,req.user,'WORK_ORDER_CREATED','work_order',r.rows[0].id,a.id,{title:b.title,technicianId:technician,expectedCompletion:due});return r.rows[0];
    }));
  });
  app.patch('/api/work-orders/:id',roles('admin','mechanic'),async(req,res)=>{
    res.json(await tx(async db=>{
      const job=(await db.query('SELECT * FROM work_orders WHERE id=$1 FOR UPDATE',[positive(req.params.id)])).rows[0];if(!job)throw problem('Work order not found',404);
      if(['completed','cancelled'].includes(job.status))throw problem('Closed work orders cannot be reassigned',409);
      const tech=req.body.technicianId?positive(req.body.technicianId):null;
      if(tech&&!(await db.query("SELECT 1 FROM app_users WHERE id=$1 AND active AND role IN ('admin','mechanic')",[tech])).rowCount)throw problem('Choose an active mechanic');
      const due=req.body.expectedCompletion?new Date(req.body.expectedCompletion):null;
      if(due&&(!Number.isFinite(due.getTime())||due<=new Date()))throw problem('Expected completion must be in the future');
      const r=await db.query('UPDATE work_orders SET technician_id=$2,expected_completion=$3,updated_at=NOW() WHERE id=$1 RETURNING *',[job.id,tech,due]);await audit(db,req.user,'WORK_ORDER_REASSIGNED','work_order',job.id,job.ambulance_id,{technicianId:tech,expectedCompletion:due});return r.rows[0];
    }));
  });
  app.post('/api/work-orders/:id/transition',roles('admin','mechanic'),async(req,res)=>{
    res.json(await tx(async db=>{
      // Lock the vehicle before its job, matching fleet administration and assignment.
      const lookup=(await db.query('SELECT ambulance_id FROM work_orders WHERE id=$1',[positive(req.params.id)])).rows[0];if(!lookup)throw problem('Work order not found',404);
      const a=await vehicleLock(db,lookup.ambulance_id);
      const job=(await db.query('SELECT * FROM work_orders WHERE id=$1 FOR UPDATE',[positive(req.params.id)])).rows[0];
      const flow={open:['in_progress','cancelled'],in_progress:['completed','cancelled'],completed:[],cancelled:[]};const next=choice(req.body.status,flow[job.status]);
      const notes=text(req.body.notes,'Work notes',3000);
      if(next==='in_progress'){
        if(a.status==='responding'||a.status==='retired')throw problem('Vehicle must be released from its mission and active in the fleet',409);
        await db.query("UPDATE ambulances SET status='maintenance' WHERE id=$1",[a.id]);
      }
      if(next==='completed'){
        const record=(await db.query('SELECT id FROM maintenance_records WHERE id=$1 AND ambulance_id=$2 AND created_at>=$3::timestamptz AND service_date>=($3::timestamptz)::date',[positive(req.body.serviceRecordId),a.id,job.created_at])).rows[0];
        if(!record)throw problem('Record completed service for this job before closing it',409);
        if(!(await db.query("SELECT 1 FROM work_orders WHERE ambulance_id=$1 AND id<>$2 AND status='in_progress'",[a.id,job.id])).rowCount)await db.query("UPDATE ambulances SET status='available' WHERE id=$1",[a.id]);
      }
      const r=await db.query('UPDATE work_orders SET status=$2,completion_notes=$3,updated_at=NOW() WHERE id=$1 RETURNING *',[job.id,next,notes]);
      await audit(db,req.user,'WORK_ORDER_STATUS_CHANGED','work_order',job.id,a.id,{from:job.status,to:next,notes,serviceRecordId:next==='completed'?Number(req.body.serviceRecordId):null});return r.rows[0];
    }));
  });
  app.get('/api/alerts',roles(),async(req,res)=>res.json((await pool.query(`SELECT v.*,a.ambulance_code,u.display_name AS acknowledged_name,e.display_name AS escalated_name FROM vehicle_alerts v JOIN ambulances a ON a.id=v.ambulance_id LEFT JOIN app_users u ON u.id=v.acknowledged_by LEFT JOIN app_users e ON e.id=v.escalated_by ORDER BY (v.status='ACTIVE') DESC,(v.severity='CRITICAL') DESC,v.created_at DESC LIMIT 300`)).rows));
  app.post('/api/alerts/:id/action',roles('admin','dispatcher','mechanic'),async(req,res)=>{
    const action=choice(req.body.action,['acknowledge','escalate']);const notes=text(req.body.notes,'Action notes',2000);
    res.json(await tx(async db=>{
      const alert=(await db.query('SELECT * FROM vehicle_alerts WHERE id=$1 FOR UPDATE',[positive(req.params.id)])).rows[0];if(!alert)throw problem('Alert not found',404);if(alert.status!=='ACTIVE')throw problem('This alert has already resolved',409);
      const sql=action==='acknowledge'?'UPDATE vehicle_alerts SET acknowledged_by=$2,acknowledged_at=NOW(),operator_notes=$3 WHERE id=$1 RETURNING *':'UPDATE vehicle_alerts SET escalated_by=$2,escalated_at=NOW(),operator_notes=$3 WHERE id=$1 RETURNING *';
      const r=await db.query(sql,[alert.id,req.user.id,notes]);await audit(db,req.user,`ALERT_${action.toUpperCase()}`,'alert',alert.id,alert.ambulance_id,{notes});return r.rows[0];
    }));
  });
  app.get('/api/ambulances/:id/timeline',roles(),async(req,res)=>{
    const id=positive(req.params.id);
    const r=await pool.query(`SELECT * FROM (
      SELECT 'audit-'||id AS event_id,created_at AS at,action AS title,actor_name AS actor,details::text AS detail FROM audit_events WHERE ambulance_id=$1
      UNION ALL SELECT 'alert-'||id,created_at AT TIME ZONE current_setting('TIMEZONE'),'Alert: '||alert_type,'Telemetry',message FROM vehicle_alerts WHERE ambulance_id=$1
      UNION ALL SELECT 'resolved-'||id,resolved_at AT TIME ZONE current_setting('TIMEZONE'),'Alert resolved: '||alert_type,'Telemetry',message FROM vehicle_alerts WHERE ambulance_id=$1 AND resolved_at IS NOT NULL
      UNION ALL SELECT 'hold-'||id,created_at,'Inspection hold created','Telemetry',reason FROM safety_holds WHERE ambulance_id=$1
      UNION ALL SELECT 'clear-'||id,cleared_at,'Inspection cleared',cleared_by,clearance_notes FROM safety_holds WHERE ambulance_id=$1 AND cleared_at IS NOT NULL
      UNION ALL SELECT 'service-'||id,created_at,'Service recorded: '||repair_type,created_by,notes FROM maintenance_records WHERE ambulance_id=$1
    ) events ORDER BY at DESC,event_id DESC LIMIT 300`,[id]);res.json(r.rows);
  });
}
module.exports={install,tx};
