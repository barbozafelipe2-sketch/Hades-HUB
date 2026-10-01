import { getEnv, isNetlifyRuntime } from './env.mjs';

const localSystem = globalThis.__KAIROS_DB_SYSTEM__ ||= new Map();
const localTenant = globalThis.__KAIROS_DB_TENANT__ ||= new Map();
const localLocks = globalThis.__KAIROS_DB_LOCKS__ ||= new Map();
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
