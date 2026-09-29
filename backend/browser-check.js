// Optional browser integration test. Uses an isolated schema, never the live fleet.
require('dotenv').config({quiet:true,path:require('node:path').join(__dirname,'.env')});
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const pool=require('./db');pool.options.max=1;
const {passwordHash,hash}=require('./security');
const {app}=require('./server');
const migrate=require('./migrate');
const schema=`chap_browser_${Date.now()}`;
let server,browser,lastPage,heartbeat,created=false,pending=Promise.resolve();
async function run(){
  await pool.query(`CREATE SCHEMA ${schema}`);created=true;await pool.query(`SET search_path TO ${schema}`);await migrate();
  const encoded=await passwordHash('browser-test-password-123');
  await pool.query("INSERT INTO app_users(username,display_name,password_hash,role) VALUES ('browser','Browser Operator',$1,'admin'),('viewer','Read Only',$1,'viewer')",[encoded]);
  await pool.query("INSERT INTO ambulances(ambulance_code,registration_number,hospital_name,status) VALUES ('TEST-UI','UI-123','Browser Hospital','available')");
  await pool.query("INSERT INTO devices(ambulance_id,name,token_hash) VALUES (1,'Browser device',$1)",[hash('browser-device-key')]);
  await pool.query("INSERT INTO maintenance_records(ambulance_id,service_date,odometer_km,repair_type,next_service_date,next_service_km,created_by) VALUES(1,CURRENT_DATE,1000,'Routine inspection',CURRENT_DATE+30,5000,'Browser Operator')");
  const express=require('express');app.use('/assets',express.static(path.join(__dirname,'../frontend/dist/assets')));app.use('/ui',express.static(path.join(__dirname,'../frontend/dist')));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const reading={ambulanceId:1,latitude:-6.16,longitude:35.75,speed:0,rpm:800,engineTemperature:86,batteryVoltage:12.7,fuelLevel:80,vibration:1,faultCodes:[],odometerKm:1000};
  async function emit(){const r=await fetch(base+'/api/readings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer browser-device-key'},body:JSON.stringify({...reading,eventId:require('node:crypto').randomUUID(),recordedAt:new Date().toISOString()})});assert.equal(r.status,201);}
  await emit();heartbeat=setInterval(()=>{pending=pending.then(emit);},5000);
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});lastPage=page;page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost:5000/api/**',async route=>{const request=route.request();const response=await route.fetch({url:base+new URL(request.url()).pathname+new URL(request.url()).search});await route.fulfill({response});});
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await page.goto(base+'/ui/');
  await page.getByLabel('Username',{exact:true}).fill('browser');await page.getByLabel('Password',{exact:true}).fill('browser-test-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Operations overview',exact:true}).waitFor();
  await page.getByRole('button',{name:/TEST-UI/}).first().click();
  await page.getByRole('link',{name:'Trends',exact:true}).click();await page.getByRole('heading',{name:'Deterioration trends'}).waitFor();
  await page.getByRole('link',{name:'Activity',exact:true}).click();await page.getByRole('heading',{name:'Vehicle activity timeline'}).waitFor();
  await page.getByRole('link',{name:'Dispatch',exact:true}).click();
  await page.locator('summary').filter({hasText:'Create incident'}).click();
  await page.getByLabel('Incident description').fill('Browser workflow incident');await page.getByLabel('Operational priority').selectOption('urgent');
  await page.getByLabel('Latitude',{exact:true}).fill('-6.163');await page.getByLabel('Longitude',{exact:true}).fill('35.7516');await page.getByRole('button',{name:'Create incident',exact:true}).click();
  await page.getByRole('button',{name:'Find suitable vehicles'}).click();await page.getByRole('button',{name:'Assign vehicle',exact:true}).click();
  await page.getByText('Vehicle assigned. Mission is now active.').waitFor();
  for(const status of ['en_route','on_scene','completed']){
    const select=page.getByLabel('Next state');await page.waitForFunction(s=>Array.from(document.querySelectorAll('select[name="status"] option')).some(o=>o.value===s),status);await select.selectOption(status);await page.getByLabel('Progress / closure notes').fill('Browser verified transition');
    const response=page.waitForResponse(r=>r.url().includes('/transition')&&r.status()===200);await page.getByRole('button',{name:'Update mission'}).click();await response;
  }
  await page.getByRole('link',{name:'Maintenance',exact:true}).click();
  await page.locator('summary').filter({hasText:'Create work order'}).click();await page.getByLabel('Ambulance',{exact:true}).selectOption('1');await page.getByLabel('Work required').fill('Browser repair job');await page.getByLabel('Assigned technician').selectOption('1');await page.getByRole('button',{name:'Create work order',exact:true}).click();
  const job=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Browser repair job'})}).first();await job.locator('summary').first().click();
  await job.getByLabel('Next status').selectOption('in_progress');await job.getByLabel('Work / cancellation notes').fill('Started browser repair');await job.getByRole('button',{name:'Update work order'}).click();
  await page.getByRole('link',{name:'Administration',exact:true}).click();await page.getByRole('heading',{name:'Fleet administration'}).waitFor();
  await page.locator('summary').filter({hasText:'Register ambulance'}).click();await page.getByLabel('Vehicle code',{exact:true}).fill('SECOND-UI');await page.getByLabel('Registration',{exact:true}).fill('UI-456');await page.getByLabel('Hospital / service area').fill('Browser Hospital');await page.getByRole('button',{name:'Register vehicle'}).click();
  await page.getByLabel('Manage vehicle').selectOption({label:'SECOND-UI'});
  await page.getByRole('link',{name:'Planning',exact:true}).click();await page.getByRole('heading',{name:'Road response coverage'}).waitFor();
  await page.getByRole('link',{name:'Alert inbox',exact:true}).click();await page.getByRole('heading',{name:'Alert inbox'}).first().waitFor();
  await page.getByRole('link',{name:'Operations overview',exact:true}).click();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Mobile layout must not overflow');
  await page.screenshot({path:'/tmp/chap-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Username',{exact:true}).fill('viewer');await page.getByLabel('Password',{exact:true}).fill('browser-test-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Operations overview',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Administration',exact:true}).count(),0);
  await page.getByRole('link',{name:'Dispatch',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Create incident',exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log('Browser checks passed: login, tabs, mission assignment/progression, maintenance creation, fleet registration, planning, mobile layout, logout and viewer restrictions.');
}
run().catch(async e=>{if(lastPage)await lastPage.screenshot({path:'/tmp/chap-browser-failure.png',fullPage:true}).catch(()=>{});console.error(e);process.exitCode=1;}).finally(async()=>{clearInterval(heartbeat);await pending.catch(()=>{});if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(created){await pool.query('SET search_path TO public');await pool.query(`DROP SCHEMA ${schema} CASCADE`);}await pool.end();});
