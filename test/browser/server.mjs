import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
if(process.env.NETLIFY||process.env.SITE_ID)throw new Error('BROWSER_FIXTURE_SERVER_IS_LOCAL_ONLY');
Object.assign(process.env,{KAIROS_DATABASE_QA_MEMORY:'true',KAIROS_DATA_BACKEND:'postgres',KAIROS_ADMIN_PASSWORD:'browser-test-password',KAIROS_LEGACY_AUTH_ENABLED:'true',KAIROS_SESSION_SECRET:'browser-fixture-local-secret'});
const realFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('BROWSER_FIXTURE_EXTERNAL_NETWORK_BLOCKED');return realFetch(input,options);};
const store=await import('../../netlify/lib/store.mjs'),auth=await import('../../netlify/lib/auth.mjs'),state=await import('../../netlify/lib/state.mjs');
store.configurePersistenceForRequest({});
const principal=await auth.loginPrincipal(new Request('http://localhost'),'admin','browser-test-password');
async function reset(){
  store.configurePersistenceForRequest({});store.configureTenantForRequest(principal);
  await state.saveTransactions([]);await state.savePaperOrders([]);
  await state.saveSettings({onboardingComplete:true});
  await state.saveMarks({AAPL:{price:100,source:'licensed_market_feed',license_id:'browser-fixture-license',asOf:new Date().toISOString()}});
  await state.saveAIMirror({status:'APPROVED',generatedAt:new Date().toISOString(),budget:200,focus:'all',allocation:[{symbol:'AAPL',weight_pct:100,amount:200}],gate:{approved:true}});
}
await reset();
const root=path.resolve('public');
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:8787');
    if(url.pathname==='/__test/reset'&&req.method==='POST'){await reset();res.writeHead(204);res.end();return;}
    if(url.pathname.startsWith('/.netlify/functions/')){
      const name=url.pathname.split('/').at(-1);if(!/^[a-z-]+$/.test(name))throw new Error('INVALID_FUNCTION');
      const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
      const request=new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
      const handler=(await import(`../../netlify/functions/${name}.mjs`)).default;
      const result=await handler(request,{});res.writeHead(result?.status||204,Object.fromEntries(result?.headers||[]));res.end(result?Buffer.from(await result.arrayBuffer()):undefined);return;
    }
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root+path.sep))throw new Error('INVALID_PATH');
    const data=await fs.readFile(file);res.writeHead(200,{'content-type':({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream'});res.end(data);
  }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}).listen(8787,'127.0.0.1');
