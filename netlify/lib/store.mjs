import { getStore, getDeployStore } from '@netlify/blobs';
import { getEnv, isNetlifyRuntime } from './env.mjs';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  databaseStatus,getSystemRecord,setSystemRecord,deleteSystemRecord,listSystemRecords,
  getTenantRecord,setTenantRecord,deleteTenantRecord,listTenantRecords,withDatabaseLock
} from './database.mjs';

const memory = globalThis.__KAIROS_MEMORY_STORE__ ||= new Map();
let blobHealthy = true;
let lastBlobError = null;
let retryAfter = 0;
const RETRY_BACKOFF_MS = 5000;
const requestContext = globalThis.__KAIROS_REQUEST_CONTEXT__ ||= new AsyncLocalStorage();

function production(){ return isNetlifyRuntime(); }
function deployContext(){ return String(getEnv('CONTEXT')||getEnv('NETLIFY_CONTEXT')||'').toLowerCase(); }
function cleanTenantId(value){
  const s=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(s)) throw new Error('INVALID_TENANT_ID');
  return s;
}

function activeContext(){ return requestContext.getStore()||null; }
function safeNamespacePart(value){ return String(value||'').toLowerCase().replace(/[^a-z0-9_-]/g,'_').replace(/^_+|_+$/g,'').slice(0,80); }
function databaseNamespace(){
  const current=activeContext();
  if(current?.dataNamespace) return current.dataNamespace;
  if(!production()) return 'local';
  const explicit=safeNamespacePart(getEnv('KAIROS_DATABASE_NAMESPACE'));
  if(explicit) return explicit;
  const deployId=safeNamespacePart(getEnv('DEPLOY_ID'));
  const context=deployContext();
  if(context==='production') return 'prod';
  if(deployId) return `deploy_${deployId}`;
  throw new Error('DATABASE_NAMESPACE_UNRESOLVED');
}
function scopedSystemKey(key){ return `${databaseNamespace()}:${String(key)}`; }
function scopedTenantId(tenantId){ return `${databaseNamespace()}__${cleanTenantId(tenantId)}`; }

function dataBackend(){
  const explicit=String(getEnv('KAIROS_DATA_BACKEND')||'').trim().toLowerCase();
  if(explicit==='blobs') return 'blobs';
  if(explicit==='postgres'||explicit==='database') return 'postgres';
  return production()?'postgres':'blobs';
}
const DB_EXACT_KEYS=new Set([
  'user/profile','user/settings','portfolio/transactions','portfolio/marks','broker/orders','broker/watchlist',
  'mirror/ai/latest','mirror/ai/history','mirror/wallet/latest','evolution/state','decisions/index','trace/status',
  'trace/world-state/latest'
]);
function databaseBackedKey(key){
  const k=String(key||'').replace(/^\/+/, '');
  return DB_EXACT_KEYS.has(k)||['decisions/','limits/','restore/'].some(prefix=>k.startsWith(prefix));
}
function databaseBackedPrefix(prefix){
  const p=String(prefix||'').replace(/^\/+/, '');
  if(!p) return null;
  if(DB_EXACT_KEYS.has(p)) return true;
  return ['decisions/','limits/','restore/'].some(x=>p.startsWith(x)||x.startsWith(p));
}
function tenantIdRequired(){
  const tenant=activeContext()?.tenant;
  if(!tenant?.tenantId) throw new Error('TENANT_CONTEXT_REQUIRED');
  return tenant.tenantId;
}

export function configurePersistenceForRequest(context){
  const explicit=String(getEnv('HADES_STORAGE_SCOPE')||getEnv('KAIROS_STORAGE_SCOPE')||'').toLowerCase();
  let storageScope=null;
  if(explicit==='deploy' || explicit==='site') storageScope=explicit;
  const deployContextValue=String(context?.deploy?.context||'').toLowerCase();
  if(!storageScope){
    if(deployContextValue) storageScope=deployContextValue==='production'?'site':'deploy';
    else if(context?.deploy?.published===true) storageScope='site';
    else if(context?.deploy?.published===false) storageScope='deploy';
  }
  let dataNamespace=safeNamespacePart(getEnv('KAIROS_DATABASE_NAMESPACE'))||null;
  if(!dataNamespace){
    if(!production()) dataNamespace='local';
    else if(deployContextValue==='production' || context?.deploy?.published===true) dataNamespace='prod';
    else {
      const deployId=safeNamespacePart(context?.deploy?.id||getEnv('DEPLOY_ID'));
      if(deployId) dataNamespace=`deploy_${deployId}`;
    }
  }
  if(production() && dataBackend()==='postgres' && !dataNamespace) throw new Error('DATABASE_NAMESPACE_UNRESOLVED');
  requestContext.enterWith({storageScope,dataNamespace,tenant:null});
  return storageScope;
}
export function configureTenantForRequest(tenant){
  const tenantValue=!tenant?null:{
    tenantId:cleanTenantId(typeof tenant==='string'?tenant:tenant.tenantId),
    userId:tenant?.userId?String(tenant.userId).slice(0,96):null,
    role:tenant?.role?String(tenant.role).slice(0,32):null,
  };
  const current=activeContext();
  if(current){ current.tenant=tenantValue; return tenantValue; }
  requestContext.enterWith({storageScope:null,dataNamespace:production()?null:'local',tenant:tenantValue});
  return tenantValue;
}
export function currentTenantContext(){ const t=activeContext()?.tenant; return t?{...t}:null; }
export function deployScopedPersistence(){
  const explicit=String(getEnv('HADES_STORAGE_SCOPE')||getEnv('KAIROS_STORAGE_SCOPE')||'').toLowerCase();
  if(explicit==='deploy') return true; if(explicit==='site') return false;
  const scoped=activeContext()?.storageScope;
  if(scoped) return scoped==='deploy';
  const c=deployContext(); return production() && !!c && c!=='production';
}
export function persistenceStatus(){
  const db=databaseStatus();
  return {
    provider:dataBackend()==='postgres'?'hybrid_database_blobs':(blobHealthy?'netlify_blobs':'netlify_blobs_degraded'),
    transactionalProvider:dataBackend()==='postgres'?'netlify_database':'netlify_blobs',
    artifactProvider:blobHealthy?'netlify_blobs':'netlify_blobs_degraded',
    scope:deployScopedPersistence()?'deploy':'site',
    databaseBranchIsolation:db.branchIsolation,
    databaseScope:databaseNamespace().startsWith('deploy_')?'deploy':databaseNamespace(),
    tenantScoped:!!activeContext()?.tenant,
    persistent:dataBackend()==='postgres'?true:blobHealthy,
    error:lastBlobError,
    retryAfter:retryAfter||null
  };
}
function noteBlobError(e){ blobHealthy=false; lastBlobError=String(e?.message||e).slice(0,240); retryAfter=Date.now()+RETRY_BACKOFF_MS; }
function noteBlobSuccess(){ blobHealthy=true; lastBlobError=null; retryAfter=0; }
function ephemeralWritesAllowed(){ return getEnv('SAURON_ALLOW_EPHEMERAL_WRITES')==='true' || !production(); }
function ephemeralReadsAllowed(){ return getEnv('SAURON_ALLOW_EPHEMERAL_READS')==='true' || !production(); }
export function store(name='sauron-private-v2') { return deployScopedPersistence() ? getDeployStore(name) : getStore(name); }
function physicalKey(key,{system=false}={}){
  const clean=String(key||'').replace(/^\/+/, '');
  if(system) return `system/${clean}`;
  const tenant=activeContext()?.tenant;
  if(tenant?.tenantId) return `tenants/${tenant.tenantId}/${clean}`;
  if(production()) throw new Error('TENANT_CONTEXT_REQUIRED');
  return clean; // local/tests keep legacy logical layout
}
function logicalKey(physical,prefix,{system=false}={}){
  if(system){ const base='system/'; return physical.startsWith(base)?physical.slice(base.length):physical; }
  const tenant=activeContext()?.tenant;
  if(tenant?.tenantId){ const base=`tenants/${tenant.tenantId}/`; return physical.startsWith(base)?physical.slice(base.length):physical; }
  return physical;
}
async function blobRead(op){
  if(!blobHealthy && Date.now()<retryAfter) throw new Error('PERSISTENCE_UNAVAILABLE');
  try{ const v=await op(); noteBlobSuccess(); return v; }
  catch(e){ noteBlobError(e); throw e; }
}
async function readJSON(key,fallback=null,{system=false}={}){
  const pkey=physicalKey(key,{system});
  try { const v=await blobRead(()=>store().get(pkey,{type:'json',consistency:'strong'})); return v ?? fallback; }
  catch(e){
    if(!ephemeralReadsAllowed()) throw new Error('PERSISTENCE_UNAVAILABLE');
    return memory.has(pkey) ? structuredClone(memory.get(pkey)) : fallback;
  }
}
async function writeJSON(key,value,options={}, {system=false}={}){
  const pkey=physicalKey(key,{system});
  try { return await blobRead(()=>store().setJSON(pkey,value,options)); }
  catch(e){
    if(!ephemeralWritesAllowed()) throw new Error('PERSISTENCE_DEGRADED_WRITE_BLOCKED');
    if(options?.onlyIfNew && memory.has(pkey)) return;
    memory.set(pkey,structuredClone(value));
    return {fallback:'ephemeral_memory'};
  }
}
async function removeKey(key,{system=false}={}){
  const pkey=physicalKey(key,{system});
  try { return await blobRead(()=>store().delete(pkey)); }
  catch(e){
    if(!ephemeralWritesAllowed()) throw new Error('PERSISTENCE_DEGRADED_WRITE_BLOCKED');
    memory.delete(pkey); return {fallback:'ephemeral_memory'};
  }
}
async function keys(prefix='',{system=false}={}){
  const pprefix=physicalKey(prefix,{system});
  try { const {blobs}=await blobRead(()=>store().list({prefix:pprefix})); return (blobs||[]).map(b=>logicalKey(b.key,prefix,{system})); }
  catch(e){
    if(!ephemeralReadsAllowed()) throw new Error('PERSISTENCE_UNAVAILABLE');
    return [...memory.keys()].filter(k=>k.startsWith(pprefix)).map(k=>logicalKey(k,prefix,{system}));
  }
}

// Tenant data APIs. Transactional/customer state uses Netlify Database in hosted commercial mode.
// High-volume historical/operational artifacts remain in deploy/site scoped Blobs.
export async function getJSON(key,fallback=null){
  if(dataBackend()==='postgres'&&databaseBackedKey(key)) return getTenantRecord(scopedTenantId(tenantIdRequired()),String(key),fallback);
  return readJSON(key,fallback,{system:false});
}
export async function setJSON(key,value,options={}){
  if(dataBackend()==='postgres'&&databaseBackedKey(key)) return setTenantRecord(scopedTenantId(tenantIdRequired()),String(key),value,options);
  return writeJSON(key,value,options,{system:false});
}
export async function listKeys(prefix=''){
  if(dataBackend()!=='postgres') return keys(prefix,{system:false});
  const mode=databaseBackedPrefix(prefix);
  if(mode===true) return listTenantRecords(scopedTenantId(tenantIdRequired()),prefix);
  if(mode===false) return keys(prefix,{system:false});
  const tid=scopedTenantId(tenantIdRequired());
  const [dbKeys,blobKeys]=await Promise.all([listTenantRecords(tid,prefix),keys(prefix,{system:false})]);
  return [...new Set([...dbKeys,...blobKeys])].sort();
}
export async function deleteKey(key){
  if(dataBackend()==='postgres'&&databaseBackedKey(key)) return deleteTenantRecord(scopedTenantId(tenantIdRequired()),String(key));
  return removeKey(key,{system:false});
}

// System APIs are authoritative in Postgres for hosted commercial mode.
export async function getSystemJSON(key,fallback=null){
  if(dataBackend()==='postgres') return getSystemRecord(scopedSystemKey(key),fallback);
  return readJSON(key,fallback,{system:true});
}
export async function setSystemJSON(key,value,options={}){
  if(dataBackend()==='postgres') return setSystemRecord(scopedSystemKey(key),value,options);
  return writeJSON(key,value,options,{system:true});
}
export async function listSystemKeys(prefix=''){
  if(dataBackend()==='postgres'){ const base=`${databaseNamespace()}:`; return (await listSystemRecords(`${base}${String(prefix||'')}`)).map(k=>k.slice(base.length)); }
  return keys(prefix,{system:true});
}
export async function deleteSystemKey(key){
  if(dataBackend()==='postgres') return deleteSystemRecord(scopedSystemKey(key));
  return removeKey(key,{system:true});
}
// Read-only compatibility bridge for migrating the pre-commercial single-admin store.
export async function getLegacyGlobalJSON(key,fallback=null){
  const pkey=String(key||'').replace(/^\/+/, '');
  try{ const v=await blobRead(()=>store().get(pkey,{type:'json',consistency:'strong'})); return v ?? fallback; }
  catch(e){
    if(!ephemeralReadsAllowed()) return fallback;
    return memory.has(pkey)?structuredClone(memory.get(pkey)):fallback;
  }
}

export async function listLegacyGlobalKeys(prefix=''){
  const clean=String(prefix||'').replace(/^\/+/, '');
  try{ const {blobs}=await blobRead(()=>store().list({prefix:clean})); return (blobs||[]).map(b=>b.key); }
  catch(e){
    if(!ephemeralReadsAllowed()) return [];
    return [...memory.keys()].filter(k=>k.startsWith(clean));
  }
}

export async function setTenantJSONForMigration(tenantId,key,value,options={onlyIfNew:true}){
  const tid=cleanTenantId(tenantId);
  const clean=String(key||'').replace(/^\/+/, '');
  if(dataBackend()==='postgres'&&databaseBackedKey(clean)) return setTenantRecord(scopedTenantId(tid),clean,value,options);
  const pkey=`tenants/${tid}/${clean}`;
  try{ return await blobRead(()=>store().setJSON(pkey,value,options)); }
  catch(e){
    if(!ephemeralWritesAllowed()) throw new Error('PERSISTENCE_DEGRADED_WRITE_BLOCKED');
    if(options?.onlyIfNew && memory.has(pkey)) return {modified:false};
    memory.set(pkey,structuredClone(value)); return {fallback:'ephemeral_memory',modified:true};
  }
}

const pruneClock = globalThis.__KAIROS_PRUNE_CLOCK__ ||= new Map();
function tenantClockKey(scope){ return `${activeContext()?.tenant?.tenantId||'system'}:${scope}`; }
function shouldPrune(scope,minIntervalMs){ const key=tenantClockKey(scope); const last=Number(pruneClock.get(key)||0); if(Date.now()-last<minIntervalMs) return false; pruneClock.set(key,Date.now()); return true; }
export async function pruneDatedPrefix(prefix,{keepDays=30,minIntervalMs=6*3600000}={}){
  const scope=`dated:${prefix}`; if(!shouldPrune(scope,minIntervalMs)) return {skipped:true};
  const cutoff=new Date(Date.now()-Math.max(1,keepDays)*86400000).toISOString().slice(0,10);
  const found=await listKeys(prefix); let removed=0;
  for(const key of found){
    const rest=key.slice(prefix.length); const date=rest.slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date) && date<cutoff){ await deleteKey(key); removed++; }
  }
  return {removed,cutoff};
}
export async function pruneJSONCollection(prefix,{maxEntries=120,minIntervalMs=15*60000,timestampFields=['finishedAt','endedAt','generatedAt','startedAt','createdAt','exportedAt']}={}){
  const scope=`json:${prefix}`; if(!shouldPrune(scope,minIntervalMs)) return {skipped:true};
  const found=await listKeys(prefix); if(found.length<=maxEntries) return {removed:0};
  const rows=[];
  for(const key of found){
    const value=await getJSON(key,null).catch(()=>null); let ts=0;
    for(const f of timestampFields){ const t=Date.parse(value?.[f]||0); if(Number.isFinite(t)){ ts=t; break; } }
    rows.push({key,ts});
  }
  rows.sort((a,b)=>a.ts-b.ts || a.key.localeCompare(b.key));
  const remove=rows.slice(0,Math.max(0,rows.length-maxEntries));
  for(const row of remove) await deleteKey(row.key);
  return {removed:remove.length};
}

const localLocks = globalThis.__KAIROS_LOCAL_LOCKS__ ||= new Map();
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function withLocalLock(key,fn){
  const prior=localLocks.get(key)||Promise.resolve();
  let release; const gate=new Promise(r=>{release=r;});
  const queued=prior.catch(()=>{}).then(()=>gate); localLocks.set(key,queued);
  await prior.catch(()=>{});
  try{return await fn();}
  finally{ release(); if(localLocks.get(key)===queued) localLocks.delete(key); }
}
async function acquireBlobLock(name,{ttlMs=15000,waitMs=4000,scopeKey=null}={}){
  const tenantPart=scopeKey||activeContext()?.tenant?.tenantId||'system';
  const lockKey=`locks/${tenantPart}/${String(name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}`;
  const token=crypto.randomUUID(); const deadline=Date.now()+waitMs;
  while(Date.now()<deadline){
    const now=Date.now(); const value={token,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+ttlMs).toISOString()};
    let created;
    try{ created=await blobRead(()=>store().setJSON(lockKey,value,{onlyIfNew:true})); }
    catch(e){ throw new Error('PERSISTENCE_LOCK_UNAVAILABLE'); }
    if(created?.modified) return {lockKey,token,etag:created.etag||null};
    let current=null;
    try{ current=await blobRead(()=>store().getWithMetadata(lockKey,{type:'json',consistency:'strong'})); }
    catch{ throw new Error('PERSISTENCE_LOCK_UNAVAILABLE'); }
    const expires=Date.parse(current?.data?.expiresAt||0);
    if(current?.etag && Number.isFinite(expires) && expires<=Date.now()){
      const stolen=await blobRead(()=>store().setJSON(lockKey,value,{onlyIfMatch:current.etag}));
      if(stolen?.modified) return {lockKey,token,etag:stolen.etag||null};
    }
    await sleep(80);
  }
  throw new Error('PERSISTENCE_LOCK_TIMEOUT');
}
async function releaseBlobLock(lock){
  if(!lock?.lockKey) return;
  try{
    const current=await blobRead(()=>store().getWithMetadata(lock.lockKey,{type:'json',consistency:'strong'}));
    if(current?.data?.token!==lock.token || !current?.etag) return;
    await blobRead(()=>store().setJSON(lock.lockKey,{token:lock.token,releasedAt:new Date().toISOString(),expiresAt:new Date(0).toISOString()},{onlyIfMatch:current.etag}));
  }catch{}
}
export async function withKeyLock(key,fn,opts={}){
  const tenantId=activeContext()?.tenant?.tenantId||'local';
  const scopedKey=`${tenantId}:${key}`;
  if(dataBackend()==='postgres') return withDatabaseLock(`tenant:${scopedTenantId(tenantId)}`,key,fn);
  if(!production()) return await withLocalLock(scopedKey,fn);
  const lock=await acquireBlobLock(key,{...opts,scopeKey:tenantId});
  try{return await fn();} finally{ await releaseBlobLock(lock); }
}
export async function withSystemKeyLock(key,fn,opts={}){
  const scopedKey=`system:${key}`;
  if(dataBackend()==='postgres') return withDatabaseLock(`system:${databaseNamespace()}`,key,fn);
  if(!production()) return await withLocalLock(scopedKey,fn);
  const lock=await acquireBlobLock(key,{...opts,scopeKey:'system'});
  try{return await fn();} finally{ await releaseBlobLock(lock); }
}

