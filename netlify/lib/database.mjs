import crypto from 'node:crypto';
import { getEnv, isNetlifyRuntime } from './env.mjs';

const localSystem = globalThis.__KAIROS_DB_SYSTEM__ ||= new Map();
const localTenant = globalThis.__KAIROS_DB_TENANT__ ||= new Map();
const localLocks = globalThis.__KAIROS_DB_LOCKS__ ||= new Map();
const localAudit = globalThis.__KAIROS_DB_AUDIT__ ||= [];
const localUsage = globalThis.__KAIROS_DB_USAGE__ ||= new Map();
let cachedModule = null;
let cachedDb = null;

function qaMemoryMode(){ return !isNetlifyRuntime() && String(getEnv('KAIROS_DATABASE_QA_MEMORY')||'').toLowerCase()==='true'; }

function commercialDbRequired(){
  if(qaMemoryMode()) return false;
  const explicit=String(getEnv('KAIROS_DATA_BACKEND')||'').trim().toLowerCase();
  if(explicit==='blobs') return false;
  if(explicit==='postgres' || explicit==='database') return true;
  return isNetlifyRuntime();
}

async function moduleForDatabase(){
  if(cachedModule) return cachedModule;
  const spec='@netlify/database';
  try{ cachedModule=await import(spec); return cachedModule; }
  catch(e){
    if(commercialDbRequired()) throw Object.assign(new Error('DATABASE_DRIVER_UNAVAILABLE'),{cause:e});
    return null;
  }
}

async function database(){
  if(qaMemoryMode()) return null;
  if(cachedDb) return cachedDb;
  const mod=await moduleForDatabase();
  if(!mod?.getDatabase) return null;
  cachedDb=mod.getDatabase();
  return cachedDb;
}

function clone(v){ return v==null?v:structuredClone(v); }
function tenantMap(tenantId){
  let map=localTenant.get(tenantId);
  if(!map){ map=new Map(); localTenant.set(tenantId,map); }
  return map;
}
function prefixMatch(k,prefix){ return String(k).startsWith(String(prefix||'')); }
function escapedLikePrefix(prefix){ return String(prefix||'').replace(/[\\%_]/g,'\\$&')+'%'; }

async function withLocalLock(name,fn){
  const prior=localLocks.get(name)||Promise.resolve();
  let release; const gate=new Promise(r=>{release=r;});
  const queued=prior.catch(()=>{}).then(()=>gate); localLocks.set(name,queued);
  await prior.catch(()=>{});
  try{return await fn();}
  finally{ release(); if(localLocks.get(name)===queued) localLocks.delete(name); }
}

export function databaseStatus(){
  return {
    required:commercialDbRequired(),
    mode:qaMemoryMode()?'qa_memory':(isNetlifyRuntime()?'netlify_database':'local_memory'),
    branchIsolation:isNetlifyRuntime()?'netlify_database_branch':'local'
  };
}

export async function getSystemRecord(key,fallback=null){
  const db=await database();
  if(!db){ return localSystem.has(key)?clone(localSystem.get(key)):fallback; }
  const rows=await db.sql`SELECT value FROM kairos_system_state WHERE key = ${String(key)} LIMIT 1`;
  return rows?.[0]?.value ?? fallback;
}

export async function setSystemRecord(key,value,{onlyIfNew=false}={}){
  const db=await database();
  if(!db){
    if(onlyIfNew && localSystem.has(key)) return {modified:false};
    localSystem.set(key,clone(value)); return {modified:true};
  }
  const payload=JSON.stringify(value);
  if(onlyIfNew){
    const rows=await db.sql`
      INSERT INTO kairos_system_state (key,value,updated_at)
      VALUES (${String(key)}, ${payload}::jsonb, NOW())
      ON CONFLICT (key) DO NOTHING
      RETURNING key`;
    return {modified:!!rows?.length};
  }
  await db.sql`
    INSERT INTO kairos_system_state (key,value,updated_at)
    VALUES (${String(key)}, ${payload}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`;
  return {modified:true};
}

export async function deleteSystemRecord(key){
  const db=await database();
  if(!db){ const existed=localSystem.delete(key); return {modified:existed}; }
  const rows=await db.sql`DELETE FROM kairos_system_state WHERE key = ${String(key)} RETURNING key`;
  return {modified:!!rows?.length};
}

export async function listSystemRecords(prefix=''){
  const db=await database();
  if(!db) return [...localSystem.keys()].filter(k=>prefixMatch(k,prefix)).sort();
  const like=escapedLikePrefix(prefix);
  const rows=await db.sql`SELECT key FROM kairos_system_state WHERE key LIKE ${like} ESCAPE '\\' ORDER BY key`;
  return (rows||[]).map(r=>r.key);
}

export async function getTenantRecord(tenantId,key,fallback=null){
  const tid=String(tenantId); const db=await database();
  if(!db){ const map=tenantMap(tid); return map.has(key)?clone(map.get(key)):fallback; }
  const rows=await db.sql`SELECT value FROM kairos_tenant_state WHERE tenant_id=${tid} AND key=${String(key)} LIMIT 1`;
  return rows?.[0]?.value ?? fallback;
}

export async function setTenantRecord(tenantId,key,value,{onlyIfNew=false}={}){
  const tid=String(tenantId); const db=await database();
  if(!db){
    const map=tenantMap(tid); if(onlyIfNew&&map.has(key)) return {modified:false};
    map.set(key,clone(value)); return {modified:true};
  }
  const payload=JSON.stringify(value);
  if(onlyIfNew){
    const rows=await db.sql`
      INSERT INTO kairos_tenant_state (tenant_id,key,value,updated_at)
      VALUES (${tid},${String(key)},${payload}::jsonb,NOW())
      ON CONFLICT (tenant_id,key) DO NOTHING
      RETURNING key`;
    return {modified:!!rows?.length};
  }
  await db.sql`
    INSERT INTO kairos_tenant_state (tenant_id,key,value,updated_at)
    VALUES (${tid},${String(key)},${payload}::jsonb,NOW())
    ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  return {modified:true};
}

export async function deleteTenantRecord(tenantId,key){
  const tid=String(tenantId); const db=await database();
  if(!db){ const map=tenantMap(tid); const existed=map.delete(key); return {modified:existed}; }
  const rows=await db.sql`DELETE FROM kairos_tenant_state WHERE tenant_id=${tid} AND key=${String(key)} RETURNING key`;
  return {modified:!!rows?.length};
}

export async function listTenantRecords(tenantId,prefix=''){
  const tid=String(tenantId); const db=await database();
  if(!db) return [...tenantMap(tid).keys()].filter(k=>prefixMatch(k,prefix)).sort();
  const like=escapedLikePrefix(prefix);
  const rows=await db.sql`SELECT key FROM kairos_tenant_state WHERE tenant_id=${tid} AND key LIKE ${like} ESCAPE '\\' ORDER BY key`;
  return (rows||[]).map(r=>r.key);
}

export async function withDatabaseLock(scope,key,fn){
  const lockName=`kairos:${String(scope)}:${String(key)}`.slice(0,500);
  const db=await database();
  if(!db) return withLocalLock(lockName,fn);
  const client=await db.pool.connect();
  try{
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))',[lockName]);
    return await fn();
  } finally {
    try{ await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))',[lockName]); }catch{}
    client.release();
  }
}


function safeAuditDetails(input={}){
  const allow=['role','plan','billingStatus','feature','units','period','reason','action','source','provider','status','result','subscriptionStatus','customerIdSuffix','subscriptionIdSuffix'];
  const out={};
  for(const key of allow){
    const value=input?.[key]; if(value===undefined||value===null) continue;
    out[key]=typeof value==='string'?value.replace(/[\u0000-\u001F\u007F]/g,'').slice(0,160):value;
  }
  return out;
}

export async function appendAuditEvent({tenantId=null,userId=null,eventType,requestId=null,details={}}={}){
  const type=String(eventType||'').trim().slice(0,100); if(!type) throw new Error('AUDIT_EVENT_TYPE_REQUIRED');
  const row={id:crypto.randomUUID(),tenantId:tenantId?String(tenantId).slice(0,96):null,userId:userId?String(userId).slice(0,96):null,eventType:type,requestId:requestId?String(requestId).slice(0,160):null,details:safeAuditDetails(details),createdAt:new Date().toISOString()};
  const db=await database();
  if(!db){ localAudit.push(clone(row)); if(localAudit.length>5000)localAudit.splice(0,localAudit.length-5000); return row; }
  const payload=JSON.stringify(row.details);
  await db.sql`INSERT INTO kairos_audit_events (id,tenant_id,user_id,event_type,request_id,details,created_at) VALUES (${row.id},${row.tenantId},${row.userId},${row.eventType},${row.requestId},${payload}::jsonb,${row.createdAt}::timestamptz)`;
  return row;
}

export async function listAuditEvents(tenantId,{limit=100}={}){
  const tid=String(tenantId||''); const cap=Math.max(1,Math.min(250,Number(limit)||100));
  const db=await database();
  if(!db) return localAudit.filter(r=>r.tenantId===tid).slice(-cap).reverse().map(clone);
  const rows=await db.sql`SELECT id,tenant_id,user_id,event_type,request_id,details,created_at FROM kairos_audit_events WHERE tenant_id=${tid} ORDER BY created_at DESC LIMIT ${cap}`;
  return (rows||[]).map(r=>({id:r.id,tenantId:r.tenant_id,userId:r.user_id,eventType:r.event_type,requestId:r.request_id,details:r.details||{},createdAt:new Date(r.created_at).toISOString()}));
}

export async function consumeUsageEvent({tenantId,period,feature,units,limit,idempotencyKey}={}){
  const tid=String(tenantId||'').slice(0,96), per=String(period||'').slice(0,16), feat=String(feature||'').slice(0,80), idem=String(idempotencyKey||'').slice(0,220);
  const amount=Math.max(1,Math.min(100000,Math.trunc(Number(units)||0)));
  const cap=limit==null?null:Math.max(1,Math.min(100000000,Math.trunc(Number(limit)||0)));
  if(!tid||!/^\d{4}-\d{2}$/.test(per)||!feat||!idem) throw new Error('USAGE_EVENT_INVALID');
  if(cap===null) return {ok:true,idempotent:false,unlimited:true,used:0,remaining:null,limit:null,period:per};
  const localKey=`${tid}:${per}:${idem}`;
  const db=await database();
  if(!db){
    return withLocalLock(`usage:${tid}:${per}`,async()=>{
      if(localUsage.has(localKey)){
        const used=[...localUsage.values()].filter(r=>r.tenantId===tid&&r.period===per).reduce((n,r)=>n+r.units,0);
        return {ok:true,idempotent:true,used,remaining:Math.max(0,cap-used),limit:cap,period:per};
      }
      const used=[...localUsage.values()].filter(r=>r.tenantId===tid&&r.period===per).reduce((n,r)=>n+r.units,0);
      if(used+amount>cap) return {ok:false,idempotent:false,used,remaining:Math.max(0,cap-used),limit:cap,period:per};
      localUsage.set(localKey,{id:crypto.randomUUID(),tenantId:tid,period:per,feature:feat,units:amount,idempotencyKey:idem,createdAt:new Date().toISOString()});
      return {ok:true,idempotent:false,used:used+amount,remaining:Math.max(0,cap-used-amount),limit:cap,period:per};
    });
  }
  const client=await db.pool.connect();
  const lockName=`kairos:usage:${tid}:${per}`;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[lockName]);
    const prior=await client.query('SELECT units FROM kairos_usage_events WHERE tenant_id=$1 AND period=$2 AND idempotency_key=$3 LIMIT 1',[tid,per,idem]);
    const sum=await client.query('SELECT COALESCE(SUM(units),0)::int AS used FROM kairos_usage_events WHERE tenant_id=$1 AND period=$2',[tid,per]);
    const used=Number(sum.rows?.[0]?.used||0);
    if(prior.rows?.length){ await client.query('COMMIT'); return {ok:true,idempotent:true,used,remaining:Math.max(0,cap-used),limit:cap,period:per}; }
    if(used+amount>cap){ await client.query('ROLLBACK'); return {ok:false,idempotent:false,used,remaining:Math.max(0,cap-used),limit:cap,period:per}; }
    await client.query('INSERT INTO kairos_usage_events (id,tenant_id,period,feature,units,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),tid,per,feat,amount,idem]);
    await client.query('COMMIT');
    return {ok:true,idempotent:false,used:used+amount,remaining:Math.max(0,cap-used-amount),limit:cap,period:per};
  }catch(e){ try{await client.query('ROLLBACK');}catch{} throw e; }
  finally{ client.release(); }
}

export async function getUsageSummary(tenantId,period,limit=null){
  const tid=String(tenantId||''), per=String(period||''); const cap=limit==null?null:Number(limit);
  if(cap===null) return {period:per,used:0,limit:null,remaining:null,unlimited:true};
  const db=await database(); let used=0;
  if(!db) used=[...localUsage.values()].filter(r=>r.tenantId===tid&&r.period===per).reduce((n,r)=>n+r.units,0);
  else { const rows=await db.sql`SELECT COALESCE(SUM(units),0)::int AS used FROM kairos_usage_events WHERE tenant_id=${tid} AND period=${per}`; used=Number(rows?.[0]?.used||0); }
  return {period:per,used,limit:cap,remaining:Math.max(0,cap-used),unlimited:false};
}
