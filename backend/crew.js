const pool=require('./db');
const {roles,problem,audit}=require('./security');
const {tx}=require('./workflows');
const {page}=require('./notifications');
const positive=v=>{if(v===undefined||v===null)throw problem('Identifier required');return page(v,null,2147483647);};
function install(app){
 app.get('/api/crew-shifts',roles('admin','dispatcher','mechanic','viewer'),async(req,res)=>res.json((await pool.query(`SELECT s.*,a.ambulance_code,u.display_name AS driver,c.id AS check_id,c.created_at AS checked_at,c.expires_at,c.oxygen,c.equipment,c.cleaning,c.communications,c.crew_present FROM crew_shifts s JOIN ambulances a ON a.id=s.ambulance_id JOIN app_users u ON u.id=s.driver_id LEFT JOIN LATERAL(SELECT * FROM readiness_checks WHERE shift_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1)c ON true WHERE s.ends_at>NOW()-INTERVAL '1 day' ORDER BY s.starts_at DESC LIMIT 200`)).rows));
 app.post('/api/crew-shifts',roles('admin','dispatcher'),async(req,res)=>{
  const b=req.body||{},start=new Date(b.startsAt),end=new Date(b.endsAt),vehicle=positive(b.ambulanceId),driver=positive(b.driverId);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end<=new Date()||end-start>24*3600000)throw problem('Choose a shift ending in the future and lasting no more than 24 hours');
  if(typeof b.clinicalCrew!=='string'||!b.clinicalCrew.trim()||b.clinicalCrew.length>300)throw problem('Clinical crew names required (maximum 300 characters)');
  res.status(201).json(await tx(async db=>{
   await db.query('LOCK TABLE crew_shifts IN SHARE ROW EXCLUSIVE MODE');
   if(!(await db.query("SELECT id FROM app_users WHERE id=$1 AND active AND role='crew' FOR SHARE",[driver])).rowCount)throw problem('Select an active crew account as driver');
   if(!(await db.query("SELECT id FROM ambulances WHERE id=$1 AND status<>'retired' FOR SHARE",[vehicle])).rowCount)throw problem('Select an active fleet vehicle');
   if((await db.query('SELECT 1 FROM crew_shifts WHERE cancelled_at IS NULL AND (ambulance_id=$1 OR driver_id=$2) AND starts_at<$4 AND ends_at>$3',[vehicle,driver,start,end])).rowCount)throw problem('The driver or vehicle already has an overlapping shift',409);
   const r=await db.query('INSERT INTO crew_shifts(ambulance_id,driver_id,clinical_crew,starts_at,ends_at,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',[vehicle,driver,b.clinicalCrew.trim(),start,end,req.user.id]);
   await audit(db,req.user,'CREW_SHIFT_CREATED','crew_shift',r.rows[0].id,vehicle);return r.rows[0];
  }));
 });
 app.post('/api/crew-shifts/:id/cancel',roles('admin','dispatcher'),async(req,res)=>{
  await tx(async db=>{
   await db.query('LOCK TABLE crew_shifts IN SHARE ROW EXCLUSIVE MODE');
   const shift=(await db.query('SELECT * FROM crew_shifts WHERE id=$1',[positive(req.params.id)])).rows[0];if(!shift)throw problem('Shift not found',404);
   await db.query('SELECT id FROM ambulances WHERE id=$1 FOR UPDATE',[shift.ambulance_id]);
   if((await db.query("SELECT 1 FROM incidents WHERE ambulance_id=$1 AND status NOT IN ('completed','cancelled')",[shift.ambulance_id])).rowCount)throw problem('Finish the active mission before cancelling this shift',409);
   await db.query('UPDATE crew_shifts SET cancelled_at=NOW() WHERE id=$1',[shift.id]);await audit(db,req.user,'CREW_SHIFT_CANCELLED','crew_shift',shift.id,shift.ambulance_id);
  });res.json({message:'Shift cancelled'});
 });
 app.get('/api/crew/workspace',roles('crew'),async(req,res)=>{
  const shifts=(await pool.query(`SELECT s.*,a.ambulance_code FROM crew_shifts s JOIN ambulances a ON a.id=s.ambulance_id WHERE s.driver_id=$1 AND s.cancelled_at IS NULL AND s.starts_at<=NOW() AND s.ends_at>NOW() ORDER BY s.starts_at`,[req.user.id])).rows;
  const missions=(await pool.query("SELECT i.*,a.ambulance_code FROM incidents i JOIN ambulances a ON a.id=i.ambulance_id WHERE i.driver_id=$1 AND i.status NOT IN ('completed','cancelled') ORDER BY i.created_at",[req.user.id])).rows;
  const checks=shifts.length?(await pool.query('SELECT DISTINCT ON (shift_id) * FROM readiness_checks WHERE shift_id=ANY($1::int[]) ORDER BY shift_id,created_at DESC,id DESC',[shifts.map(s=>s.id)])).rows:[];
  res.json({shifts,missions,checks});
 });
 app.post(['/api/crew/checks','/api/readiness-checks'],roles('crew','admin','dispatcher'),async(req,res)=>{
  const b=req.body||{},fields=['oxygen','equipment','cleaning','communications','crewPresent'];
  if(fields.some(f=>typeof b[f]!=='boolean')||typeof (b.notes??'')!=='string'||(b.notes||'').length>2000)throw problem('Complete every checklist item and use notes up to 2,000 characters');
  res.status(201).json(await tx(async db=>{
   const shift=(await db.query('SELECT * FROM crew_shifts WHERE id=$1 AND cancelled_at IS NULL AND starts_at<=NOW() AND ends_at>NOW()',[positive(b.shiftId)])).rows[0];
   if(!shift)throw problem('An active shift is required',409);
   if(req.user.role==='crew'&&shift.driver_id!==req.user.id)throw problem('This shift is assigned to another crew',403);
   // Serialize checklist changes with dispatch assignment and shift cancellation.
   await db.query('SELECT id FROM ambulances WHERE id=$1 FOR UPDATE',[shift.ambulance_id]);
   if(!(await db.query('SELECT id FROM crew_shifts WHERE id=$1 AND cancelled_at IS NULL AND ends_at>NOW()',[shift.id])).rowCount)throw problem('Shift is no longer active',409);
   const r=await db.query("INSERT INTO readiness_checks(shift_id,oxygen,equipment,cleaning,communications,crew_present,notes,checked_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST($9::timestamptz,NOW()+INTERVAL '12 hours')) RETURNING *",[shift.id,...fields.map(f=>b[f]),b.notes||'',req.user.id,shift.ends_at]);
   await audit(db,req.user,'READINESS_CHECK_RECORDED','readiness_check',r.rows[0].id,shift.ambulance_id,{passed:fields.every(f=>b[f])});return r.rows[0];
  }));
 });
 app.post('/api/crew/incidents/:id/acknowledge',roles('crew'),async(req,res)=>{
  res.json(await tx(async db=>{
   const r=await db.query("UPDATE incidents SET acknowledged_at=NOW(),acknowledged_by=$2,updated_at=NOW() WHERE id=$1 AND driver_id=$2 AND status='assigned' AND acknowledged_at IS NULL RETURNING *",[positive(req.params.id),req.user.id]);
   if(!r.rowCount)throw problem('This mission is not awaiting your acknowledgment',409);
   await audit(db,req.user,'MISSION_ACKNOWLEDGED','incident',r.rows[0].id,r.rows[0].ambulance_id);return r.rows[0];
  }));
 });
}
module.exports={install};
