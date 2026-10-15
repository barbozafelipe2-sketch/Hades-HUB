// Public read-only checks. Never creates users, trades, or billing objects.
const base=new URL(process.argv[2]||'https://hades-os.netlify.app'),expected=process.argv[3]||null;
if(!['https:','http:'].includes(base.protocol))throw new Error('INVALID_SITE_URL');
const checks=[];
for(const path of ['/','/release.json','/.netlify/functions/state','/.netlify/functions/auth-config']){
  try{
    const r=await fetch(new URL(path,base),{signal:AbortSignal.timeout(10000)}),body=await r.text();
    let data;try{data=JSON.parse(body);}catch{}
    const ok=path==='/'?r.ok:path==='/release.json'?r.ok&&/^[a-f0-9]{40}$/i.test(data?.commit||'')&&(!expected||data.commit===expected):path.endsWith('/state')?r.status===401:r.ok&&!!data;
    checks.push({path,status:r.status,ok,...(path==='/release.json'?{commit:data?.commit||null,migrationsReported:data?.requiredMigrations?.length||0}:{}),...(path==='/'?{cspPresent:!!r.headers.get('content-security-policy')}:{})});
  }catch{checks.push({path,ok:false,error:'REQUEST_FAILED'});}
}
console.log(JSON.stringify({site:base.origin,checkedAt:new Date().toISOString(),checks,scope:'public read-only; does not certify authenticated integrations or applied migrations'},null,2));
if(checks.some(r=>!r.ok))process.exitCode=1;
