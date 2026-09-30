const crypto=require('node:crypto');
function install(app){
 app.disable('x-powered-by');
 if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
 app.use((req,res,next)=>{
   const started=Date.now(),id=crypto.randomUUID();
   res.setHeader('X-Request-ID',id);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
   if(req.path.startsWith('/api'))res.setHeader('Cache-Control','no-store');
   if(process.env.ACCESS_LOG==='true')res.on('finish',()=>console.log(JSON.stringify({requestId:id,method:req.method,route:req.route?.path||'unmatched',status:res.statusCode,durationMs:Date.now()-started})));
   next();
 });
}
function shutdown(server,pool){
 let stopping=false;
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
   if(stopping)return;stopping=true;
   const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
   server.close(()=>pool.end().then(()=>{clearTimeout(deadline);process.exitCode=0;}).catch(()=>{process.exitCode=1;}));
   server.closeIdleConnections();
 });
}
module.exports={install,shutdown};
