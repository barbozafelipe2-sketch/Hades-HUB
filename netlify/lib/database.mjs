import crypto from 'node:crypto';
import { getEnv, isNetlifyRuntime } from './env.mjs';

const localSystem = globalThis.__KAIROS_DB_SYSTEM__ ||= new Map();
const localTenant = globalThis.__KAIROS_DB_TENANT__ ||= new Map();
const localLocks = globalThis.__KAIROS_DB_LOCKS__ ||= new Map();
const localAudit = globalThis.__KAIROS_DB_AUDIT__ ||= [];
const localUsage = globalThis.__KAIROS_DB_USAGE__ ||= new Map();
const localAIUsage = globalThis.__KAIROS_DB_AI_USAGE__ ||= new Map();
const localDecisionResponses = globalThis.__KAIROS_DB_DECISION_RESPONSES__ ||= new Map();
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



export async function migrateLegacyPaperLedger(tenantId){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const db=await database();if(!db)return {skipped:true};
  const marker='paper-ledger-bootstrap-owner-v1';const prior=await db.sql`SELECT marker FROM kairos_migration_markers WHERE tenant_id=${tid} AND marker=${marker} LIMIT 1`;if(prior?.length)return {alreadyMigrated:true};
  const keys=['portfolio/transactions','portfolio/marks','broker/orders'];const legacy={};for(const key of keys){const rows=await db.sql`SELECT value FROM kairos_tenant_state WHERE tenant_id=${tid} AND key=${key} LIMIT 1`;legacy[key]=rows?.[0]?.value??null;}
  const hash=crypto.createHash('sha256').update(JSON.stringify(legacy)).digest('hex');const client=await db.pool.connect();
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`legacy-paper:${tid}`]);await client.query('INSERT INTO paper_accounts(id,tenant_id,currency,cash_balance) VALUES($1,$2,$3,0) ON CONFLICT(tenant_id,id) DO NOTHING',[paperAccountId,tid,'USD']);
    const txs=Array.isArray(legacy['portfolio/transactions'])?legacy['portfolio/transactions']:[];
    for(const r of txs){const id=String(r.id||crypto.randomUUID()),type=String(r.type||'').toUpperCase(),payload=JSON.stringify({...r,id,legacySource:'kairos_tenant_state:portfolio/transactions'});await client.query(`INSERT INTO paper_transactions(id,tenant_id,account_id,idempotency_key,transaction_type,symbol,quantity,unit_price,amount,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,COALESCE($11::timestamptz,now())) ON CONFLICT DO NOTHING`,[id,tid,paperAccountId,`legacy-json:${id}`,type,r.symbol||null,Number(r.quantity||0),Number(r.unitPrice||0),Number(r.amount||0),payload,r.createdAt||null]);}
    const marks=legacy['portfolio/marks']&&typeof legacy['portfolio/marks']==='object'?legacy['portfolio/marks']:{};
    for(const [sym,m] of Object.entries(marks)){if(!(Number(m?.price)>0)||!Number.isFinite(Date.parse(m?.asOf||'')))continue;const manual=!m?.license_id&&!m?.licenseId;await client.query(`INSERT INTO paper_marks(id,tenant_id,account_id,symbol,price,source,asof,exchange,delay_class,license_id,point_in_time,manual) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,[crypto.randomUUID(),tid,paperAccountId,sym,Number(m.price),String(m.source||'manual'),m.asOf,m.exchange||null,m.delay_class||'unknown',m.license_id||m.licenseId||'unverified',m.point_in_time===true,manual]);}
    const orders=Array.isArray(legacy['broker/orders'])?legacy['broker/orders']:[];for(const o of orders){const id=String(o.id||crypto.randomUUID()),status=String(o.status||'open').toLowerCase()==='open'?'pending':String(o.status||'pending').toLowerCase();if(status==='filled')continue;await client.query(`INSERT INTO paper_orders(id,tenant_id,account_id,idempotency_key,symbol,side,quantity,status,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10::timestamptz,now()),now()) ON CONFLICT DO NOTHING`,[id,tid,paperAccountId,`legacy-json:${id}`,String(o.symbol||'').toUpperCase(),String(o.side||'BUY').toLowerCase(),Number(o.quantity||0),['pending','cancelled','rejected'].includes(status)?status:'pending',JSON.stringify({...o,id,legacySource:'kairos_tenant_state:broker/orders'}),o.createdAt||null]);}
    await client.query('INSERT INTO kairos_migration_markers(tenant_id,marker,source_key,source_hash) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,marker) DO NOTHING',[tid,marker,'kairos_tenant_state:bootstrap-owner-paper-json',hash]);await client.query('COMMIT');return {migrated:true,transactionCount:txs.length,markCount:Object.keys(marks).length,orderCount:orders.length,sourceHash:hash};
  }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}
const localPaper=globalThis.__KAIROS_DB_PAPER__ ||= new Map();
const paperAccountId='paper-main';
function localPaperTenant(tenantId){let row=localPaper.get(tenantId);if(!row){row={transactions:[],marks:{},orders:[]};localPaper.set(tenantId,row);}return row;}
async function ensurePaperAccount(db,tenantId){await db.sql`INSERT INTO paper_accounts(id,tenant_id,currency,cash_balance) VALUES(${paperAccountId},${tenantId},'USD',0) ON CONFLICT(tenant_id,id) DO NOTHING`;}
export async function getPaperTransactions(tenantId){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const db=await database();if(!db)return clone(localPaperTenant(tid).transactions);
  await ensurePaperAccount(db,tid);const rows=await db.sql`SELECT payload FROM paper_transactions WHERE tenant_id=${tid} AND account_id=${paperAccountId} ORDER BY created_at,id`;return (rows||[]).map(r=>r.payload||{});
}
export async function replacePaperTransactions(tenantId,transactions=[]){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const rows=Array.isArray(transactions)?transactions:[];const db=await database();if(!db){localPaperTenant(tid).transactions=clone(rows);return clone(rows);}
  const client=await db.pool.connect();try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`paper:${tid}`]);
    await client.query('INSERT INTO paper_accounts(id,tenant_id,currency,cash_balance) VALUES($1,$2,$3,0) ON CONFLICT(tenant_id,id) DO NOTHING',[paperAccountId,tid,'USD']);
    const existing=await client.query('SELECT id FROM paper_transactions WHERE tenant_id=$1 AND account_id=$2',[tid,paperAccountId]);const keep=new Set(rows.map(r=>String(r.id)));
    for(const r of [...rows].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.createdAt||'').localeCompare(String(b.createdAt||'')))){
      const id=String(r.id||crypto.randomUUID()),type=String(r.type||'').toUpperCase(),payload=JSON.stringify({...r,id});
      await client.query(`INSERT INTO paper_transactions(id,tenant_id,account_id,idempotency_key,transaction_type,symbol,quantity,unit_price,amount,source,asof,exchange,delay_class,license_id,point_in_time,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,COALESCE($17::timestamptz,now())) ON CONFLICT(tenant_id,id) DO UPDATE SET transaction_type=EXCLUDED.transaction_type,symbol=EXCLUDED.symbol,quantity=EXCLUDED.quantity,unit_price=EXCLUDED.unit_price,amount=EXCLUDED.amount,source=EXCLUDED.source,asof=EXCLUDED.asof,exchange=EXCLUDED.exchange,delay_class=EXCLUDED.delay_class,license_id=EXCLUDED.license_id,point_in_time=EXCLUDED.point_in_time,payload=EXCLUDED.payload`,[id,tid,paperAccountId,`paper-tx:${id}`,type,r.symbol||null,Number(r.quantity||0),Number(r.unitPrice||0),Number(r.amount||0),r.source||null,r.asof||null,r.exchange||null,r.delay_class||null,r.license_id||null,r.point_in_time===true,payload,r.createdAt||null]);
    }
    for(const r of existing.rows)if(!keep.has(r.id))await client.query('DELETE FROM paper_transactions WHERE tenant_id=$1 AND account_id=$2 AND id=$3',[tid,paperAccountId,r.id]);await client.query('COMMIT');return rows;
  }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}
export async function getPaperMarks(tenantId){const tid=String(tenantId||'');const db=await database();if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');if(!db)return clone(localPaperTenant(tid).marks);const rows=await db.sql`SELECT DISTINCT ON(symbol) symbol,price,source,asof,exchange,delay_class,license_id,point_in_time,manual FROM paper_marks WHERE tenant_id=${tid} AND account_id=${paperAccountId} ORDER BY symbol,asof DESC`;return Object.fromEntries((rows||[]).map(r=>[r.symbol,{price:Number(r.price),source:r.source,asOf:new Date(r.asof).toISOString(),exchange:r.exchange,delay_class:r.delay_class,license_id:r.license_id,point_in_time:r.point_in_time===true,manual:r.manual===true}]));}
export async function replacePaperMarks(tenantId,marks={}){const tid=String(tenantId||'');const db=await database();if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');if(!db){localPaperTenant(tid).marks=clone(marks);return clone(marks);}await ensurePaperAccount(db,tid);for(const [symbol,m] of Object.entries(marks||{})){if(!m?.source||!m?.license_id)continue;await db.sql`INSERT INTO paper_marks(id,tenant_id,account_id,symbol,price,source,asof,exchange,delay_class,license_id,point_in_time,manual) VALUES(${crypto.randomUUID()},${tid},${paperAccountId},${symbol},${Number(m.price)},${m.source},${m.asOf}::timestamptz,${m.exchange||null},${m.delay_class||'unknown'},${m.license_id},${m.point_in_time===true},${m.manual===true}) ON CONFLICT(tenant_id,account_id,symbol,asof,source) DO NOTHING`; }return marks;}
export async function getRelationalPaperOrders(tenantId){const tid=String(tenantId||'');const db=await database();if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');if(!db)return clone(localPaperTenant(tid).orders);const rows=await db.sql`SELECT payload FROM paper_orders WHERE tenant_id=${tid} AND account_id=${paperAccountId} ORDER BY created_at`;return (rows||[]).map(r=>r.payload||{});}
export async function replaceRelationalPaperOrders(tenantId,orders=[]){const tid=String(tenantId||'');const db=await database();if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const rows=Array.isArray(orders)?orders:[];if(!db){localPaperTenant(tid).orders=clone(rows);return clone(rows);}await ensurePaperAccount(db,tid);const ids=new Set(rows.map(r=>String(r.id)));for(const r of rows){const id=String(r.id||crypto.randomUUID()),side=String(r.side||'BUY').toLowerCase(),status=String(r.status||'pending').toLowerCase()==='open'?'pending':String(r.status||'pending').toLowerCase(),payload=JSON.stringify({...r,id});await db.sql`INSERT INTO paper_orders(id,tenant_id,account_id,idempotency_key,symbol,side,quantity,filled_quantity,status,execution_price,source,asof,exchange,delay_class,license_id,point_in_time,payload,created_at,updated_at) VALUES(${id},${tid},${paperAccountId},${`paper-order:${id}`},${String(r.symbol||'').toUpperCase()},${side},${Number(r.quantity||0)},${Number(status==='filled'?r.quantity:0)},${status},${Number(r.fillPrice)||null},${r.marketEvidence?.source||null},${r.marketEvidence?.asof||null},${r.marketEvidence?.exchange||null},${r.marketEvidence?.delay_class||null},${r.marketEvidence?.license_id||null},${r.marketEvidence?.point_in_time===true},${payload}::jsonb,COALESCE(${r.createdAt||null}::timestamptz,now()),now()) ON CONFLICT(tenant_id,id) DO UPDATE SET status=EXCLUDED.status,filled_quantity=EXCLUDED.filled_quantity,execution_price=EXCLUDED.execution_price,payload=EXCLUDED.payload,updated_at=now()`;}if(ids.size)await db.sql`DELETE FROM paper_orders WHERE tenant_id=${tid} AND account_id=${paperAccountId} AND id <> ALL(${[...ids]})`;else await db.sql`DELETE FROM paper_orders WHERE tenant_id=${tid} AND account_id=${paperAccountId}`;return rows;}

export async function recordDecisionResponse({tenantId,userId,decision,response,paperOrderId=null,idempotencyKey}={}){
  const tid=String(tenantId||''),uid=String(userId||'').slice(0,96),decisionId=String(decision?.id||''),answer=String(response||''),idem=String(idempotencyKey||'');
  if(!tid||!decisionId||!['followed','overrode','no_action'].includes(answer)||!idem) throw new Error('DECISION_RESPONSE_INVALID');
  const row={id:crypto.randomUUID(),tenantId:tid,userId:uid||null,decisionId,response:answer,paperOrderId:paperOrderId?String(paperOrderId):null,idempotencyKey:idem,createdAt:new Date().toISOString()};
  const db=await database();
  if(!db){
    const rows=localDecisionResponses.get(tid)||[];const prior=rows.find(x=>x.idempotencyKey===idem);
    if(prior){if(prior.decisionId!==decisionId||prior.response!==answer||prior.paperOrderId!==row.paperOrderId)throw new Error('IDEMPOTENCY_KEY_REUSED');return {...clone(prior),idempotent:true};}
    rows.push(row);localDecisionResponses.set(tid,rows);return clone(row);
  }
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    // Keep the response relationally anchored even for older JSON-only decisions.
    // No price is copied here; only the licensed evidence pipeline writes price fields.
    await client.query(`INSERT INTO decisions(id,tenant_id,idempotency_key,symbol,payload,created_at)
      VALUES($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,now()))
      ON CONFLICT(tenant_id,id) DO NOTHING`,[decisionId,tid,`decision-response:${decisionId}`,String(decision.asset||'UNKNOWN'),JSON.stringify({id:decisionId,asset:decision.asset||null,createdAt:decision.createdAt||null}),decision.createdAt||null]);
    const inserted=await client.query(`INSERT INTO decision_responses(id,tenant_id,decision_id,user_id,response,paper_order_id,idempotency_key,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id,tenant_id,decision_id,user_id,response,paper_order_id,idempotency_key,created_at`,[row.id,tid,decisionId,row.userId,answer,row.paperOrderId,idem,row.createdAt]);
    let saved=inserted.rows[0];
    if(!saved){const existing=await client.query('SELECT id,tenant_id,decision_id,user_id,response,paper_order_id,idempotency_key,created_at FROM decision_responses WHERE tenant_id=$1 AND idempotency_key=$2',[tid,idem]);saved=existing.rows[0];if(!saved||saved.decision_id!==decisionId||saved.response!==answer||saved.paper_order_id!==(row.paperOrderId||null))throw new Error('IDEMPOTENCY_KEY_REUSED');}
    await client.query('COMMIT');
    return {id:saved.id,tenantId:saved.tenant_id,decisionId:saved.decision_id,userId:saved.user_id,response:saved.response,paperOrderId:saved.paper_order_id,idempotencyKey:saved.idempotency_key,createdAt:new Date(saved.created_at).toISOString(),idempotent:!inserted.rows.length};
  }catch(e){try{await client.query('ROLLBACK');}catch{}if(e?.code==='23503')throw new Error('DECISION_RESPONSE_REFERENCE_INVALID');throw e;}finally{client.release();}
}

export async function listDecisionResponseHistory(tenantId){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const db=await database();
  if(!db)return clone(localDecisionResponses.get(tid)||[]).reverse();
  const result=await db.sql`SELECT id,tenant_id,decision_id,user_id,response,paper_order_id,idempotency_key,created_at FROM decision_responses WHERE tenant_id=${tid} ORDER BY created_at DESC,id DESC LIMIT 10000`;
  return (result||[]).map(r=>({id:r.id,tenantId:r.tenant_id,decisionId:r.decision_id,userId:r.user_id,response:r.response,paperOrderId:r.paper_order_id,idempotencyKey:r.idempotency_key,createdAt:new Date(r.created_at).toISOString()}));
}

export async function listDecisionResponses(tenantId){
  const rows=await listDecisionResponseHistory(tenantId),latest={};for(const row of rows)if(!latest[row.decisionId])latest[row.decisionId]=row;return latest;
}

export async function replaceDecisionResponseHistory({tenantId,decisions=[],responses=[]}={}){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');const safeDecisions=Array.isArray(decisions)?decisions:[],safeRows=Array.isArray(responses)?responses:[];const db=await database();
  if(!db){localDecisionResponses.set(tid,safeRows.map(r=>({...clone(r),tenantId:tid,userId:null})));return {saved:safeRows.length};}
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('DELETE FROM decision_responses WHERE tenant_id=$1',[tid]);
    for(const d of safeDecisions){if(!d?.id)continue;await client.query(`INSERT INTO decisions(id,tenant_id,idempotency_key,symbol,payload,created_at) VALUES($1,$2,$3,$4,$5::jsonb,COALESCE($6::timestamptz,now())) ON CONFLICT(tenant_id,id) DO NOTHING`,[String(d.id),tid,`decision-response:${String(d.id)}`,String(d.asset||'UNKNOWN'),JSON.stringify({id:d.id,asset:d.asset||null,createdAt:d.createdAt||null}),d.createdAt||null]);}
    for(const r of safeRows){if(!r?.id||!r?.decisionId||!r?.idempotencyKey)continue;await client.query(`INSERT INTO decision_responses(id,tenant_id,decision_id,user_id,response,paper_order_id,idempotency_key,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6,COALESCE($7::timestamptz,now())) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,[String(r.id),tid,String(r.decisionId),String(r.response),r.paperOrderId?String(r.paperOrderId):null,String(r.idempotencyKey),r.createdAt||null]);}
    await client.query('COMMIT');return {saved:safeRows.length};
  }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}

export async function saveMarketSnapshots(tenantId,items=[]){
  const tid=String(tenantId||'');if(!tid)throw new Error('TENANT_CONTEXT_REQUIRED');
  const rows=(items||[]).slice(0,1000);const db=await database();
  if(!db)return {saved:rows.length,mode:'local_memory'};
  let saved=0;
  for(const r of rows){
    const price=Number(r.value);if(!r.symbol||!Number.isFinite(price)||price<=0||!r.source||!r.asof||!r.delay_class||!r.license_id)continue;
    const id=crypto.randomUUID();
    const out=await db.sql`INSERT INTO market_snapshots(id,tenant_id,symbol,value_kind,value,source,asof,exchange,delay_class,license_id,point_in_time) VALUES(${id},${tid},${String(r.symbol).toUpperCase()},${r.value_kind},${price},${r.source},${r.asof}::timestamptz,${r.exchange||null},${r.delay_class},${r.license_id},${r.point_in_time===true}) ON CONFLICT(tenant_id,symbol,value_kind,asof,source) DO NOTHING RETURNING id`;
    if(out?.length)saved++;
  }
  return {saved};
}

function dailyUsdCap(name){ const n=Number(getEnv(name)); return Number.isFinite(n)&&n>0?n:null; }
export async function reserveAIUsage({tenantId,provider,model,feature,requestId,inputTokens=0,outputTokens=0,estimatedUsd=0}={}){
  const tid=String(tenantId||'').slice(0,96),prov=String(provider||'').slice(0,60),mod=String(model||'').slice(0,120),feat=String(feature||'unknown').slice(0,80),rid=String(requestId||'').slice(0,180);
  const usd=Math.max(0,Number(estimatedUsd)||0),input=Math.max(0,Math.trunc(Number(inputTokens)||0)),output=Math.max(0,Math.trunc(Number(outputTokens)||0));
  if(!tid||!prov||!mod||!rid) throw new Error('AI_USAGE_INVALID');
  const tenantCap=dailyUsdCap('KAIROS_TENANT_DAILY_USD'),siteCap=dailyUsdCap('KAIROS_SITE_DAILY_USD');
  const start=new Date();start.setUTCHours(0,0,0,0);const key=`${tid}:${rid}`;
  let db;try{db=await database();}catch(e){if(isNetlifyRuntime())throw e;db=null;}
  if(!db){
    return withLocalLock('ai-usage-daily',async()=>{
      if(localAIUsage.has(key)) return {ok:true,idempotent:true};
      const rows=[...localAIUsage.values()].filter(r=>Date.parse(r.createdAt)>=start.getTime());
      const tenantUsed=rows.filter(r=>r.tenantId===tid).reduce((n,r)=>n+r.estimatedUsd,0),siteUsed=rows.reduce((n,r)=>n+r.estimatedUsd,0);
      if((tenantCap!=null&&tenantUsed+usd>tenantCap)||(siteCap!=null&&siteUsed+usd>siteCap)) return {ok:false,reason:'AI_DAILY_USD_CAP',tenantUsed,siteUsed,tenantCap,siteCap};
      localAIUsage.set(key,{tenantId:tid,provider:prov,model:mod,feature:feat,requestId:rid,inputTokens:input,outputTokens:output,estimatedUsd:usd,createdAt:new Date().toISOString()});
      return {ok:true,idempotent:false};
    });
  }
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['kairos:ai-usd-daily']);
    const prior=await client.query('SELECT id FROM usage_ledger WHERE tenant_id=$1 AND request_id=$2',[tid,rid]);
    if(prior.rowCount){await client.query('COMMIT');return {ok:true,idempotent:true};}
    const totals=await client.query(`SELECT COALESCE(SUM(estimated_usd) FILTER (WHERE tenant_id=$1),0) AS tenant_used, COALESCE(SUM(estimated_usd),0) AS site_used FROM usage_ledger WHERE created_at >= date_trunc('day',now())` ,[tid]);
    const tenantUsed=Number(totals.rows[0]?.tenant_used||0),siteUsed=Number(totals.rows[0]?.site_used||0);
    if((tenantCap!=null&&tenantUsed+usd>tenantCap)||(siteCap!=null&&siteUsed+usd>siteCap)){await client.query('ROLLBACK');return {ok:false,reason:'AI_DAILY_USD_CAP',tenantUsed,siteUsed,tenantCap,siteCap};}
    await client.query('INSERT INTO usage_ledger(id,tenant_id,idempotency_key,provider,model,input_tokens,output_tokens,estimated_usd,feature,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),tid,rid,prov,mod,input,output,usd,feat,rid]);
    await client.query('COMMIT');return {ok:true,idempotent:false};
  }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}
export async function updateAIUsage({tenantId,requestId,inputTokens,outputTokens,estimatedUsd}={}){
  const tid=String(tenantId||''),rid=String(requestId||'');const input=Math.max(0,Math.trunc(Number(inputTokens)||0)),output=Math.max(0,Math.trunc(Number(outputTokens)||0)),usd=Math.max(0,Number(estimatedUsd)||0);
  let db;try{db=await database();}catch(e){if(isNetlifyRuntime())throw e;db=null;}if(!db){const key=`${tid}:${rid}`,row=localAIUsage.get(key);if(row){row.inputTokens=input;row.outputTokens=output;row.estimatedUsd=usd;}return !!row;}
  const rows=await db.sql`UPDATE usage_ledger SET input_tokens=${input},output_tokens=${output},estimated_usd=${usd} WHERE tenant_id=${tid} AND request_id=${rid} RETURNING id`;return !!rows?.length;
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

export async function purgeTenantRelationalData(tenantId){
  const tid=String(tenantId||'').slice(0,96); if(!tid) throw new Error('TENANT_ID_REQUIRED');
  const databaseHandle=await database();
  if(!databaseHandle){
    let auditRemoved=0,usageRemoved=0,decisionResponseRemoved=0;
    for(let i=localAudit.length-1;i>=0;i--){ if(localAudit[i]?.tenantId===tid){ localAudit.splice(i,1); auditRemoved++; } }
    for(const [key,row] of [...localUsage.entries()]){ if(row?.tenantId===tid){ localUsage.delete(key); usageRemoved++; } }
    for(const [key,row] of [...localAIUsage.entries()]){ if(row?.tenantId===tid)localAIUsage.delete(key); }
    const responses=localDecisionResponses.get(tid)||[];decisionResponseRemoved=responses.length;localDecisionResponses.delete(tid);localPaper.delete(tid);
    return {auditRemoved,usageRemoved,decisionResponseRemoved};
  }
  const client=await databaseHandle.pool.connect();
  try{
    await client.query('BEGIN');
    const responses=await client.query('DELETE FROM decision_responses WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM decision_outcomes WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM decisions WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM market_snapshots WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM paper_transactions WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM paper_orders WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM paper_marks WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM paper_accounts WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM entitlements WHERE tenant_id=$1',[tid]);
    await client.query('DELETE FROM usage_ledger WHERE tenant_id=$1',[tid]);
    const audit=await client.query('DELETE FROM kairos_audit_events WHERE tenant_id=$1',[tid]);
    const usage=await client.query('DELETE FROM kairos_usage_events WHERE tenant_id=$1',[tid]);
    await client.query('COMMIT');
    return {auditRemoved:Number(audit.rowCount||0),usageRemoved:Number(usage.rowCount||0),decisionResponseRemoved:Number(responses.rowCount||0)};
  }catch(e){ try{await client.query('ROLLBACK');}catch{} throw e; }
  finally{ client.release(); }
}
