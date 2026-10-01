import crypto from 'node:crypto';
import { requireSession, requireRole } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import {
  getProfile,getSettings,getTransactions,getMarks,getWorldState,getTraceStatus,getDecisionIndex,
  saveProfile,saveSettings,saveTransactions,saveMarks,saveTraceStatus,saveDecisionIndex,
  getAIMirror,getAIMirrorHistory,getWalletMirror,getEvolutionState,getPaperOrders,savePaperOrders,
  getWatchlist,saveWatchlist,sanitizeProfile,sanitizeSettings
} from '../lib/state.mjs';
import { getJSON, setJSON, listKeys, deleteKey, withKeyLock, pruneJSONCollection, configurePersistenceForRequest } from '../lib/store.mjs';
import { derivePortfolio, normalizeSymbol, validateTransactionLedger } from '../lib/portfolio.mjs';
import { normalizeSymbolList } from '../lib/input.mjs';

const MAX_RESTORE_BYTES=5*1024*1024;
const SAFE_ID=/^[A-Za-z0-9._:-]{1,160}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ORDER_TYPES=new Set(['MARKET','LIMIT','STOP','STOP_LIMIT']);
const ORDER_STATUS=new Set(['OPEN','FILLED','CANCELLED','REJECTED']);
const SIDES=new Set(['BUY','SELL']);
const RESTORE_PREFIXES={
  snapshots:{prefix:'snapshots/',key:/^snapshots\/\d{4}-\d{2}-\d{2}$/},
  traces:{prefix:'traces/',key:/^traces\/\d{4}-\d{2}-\d{2}$/},
  worldStates:{prefix:'trace/world-state/',key:/^trace\/world-state\/(?:latest|\d{4}-\d{2}-\d{2})$/}
};

function obj(v){ return v&&typeof v==='object'&&!Array.isArray(v); }
function valueSize(v){ try{return Buffer.byteLength(JSON.stringify(v));}catch{return Infinity;} }
function finitePositive(v,max=1e12){ const n=Number(v); return Number.isFinite(n)&&n>0&&n<=max?n:null; }
function safeDateTime(v,{required=false}={}){ if(v==null||v===''){ if(required) throw new Error('INVALID_TIMESTAMP'); return null; } const s=String(v); if(!Number.isFinite(Date.parse(s))) throw new Error('INVALID_TIMESTAMP'); return s; }
function boundedObject(v,name,maxBytes=512000){ if(!obj(v)) throw new Error(`INVALID_${name}`); if(valueSize(v)>maxBytes) throw new Error(`${name}_TOO_LARGE`); return structuredClone(v); }
function safeDecision(d){ if(!obj(d)||!SAFE_ID.test(String(d.id||''))) throw new Error('INVALID_DECISION'); if(valueSize(d)>512000) throw new Error('DECISION_TOO_LARGE'); return structuredClone(d); }
function safeWorldState(v){
  if(!obj(v)||!DATE.test(String(v.date||''))) throw new Error('INVALID_WORLD_STATE');
  if(valueSize(v)>1000000) throw new Error('WORLD_STATE_TOO_LARGE');
  if(v.instruments!=null && (!Array.isArray(v.instruments)||v.instruments.length>500)) throw new Error('INVALID_WORLD_STATE_INSTRUMENTS');
  return structuredClone(v);
}
function normalizeMarksObject(v){
  if(v==null) return {};
  if(!obj(v)) throw new Error('INVALID_BACKUP_MARKS');
  const out={}; const entries=Object.entries(v); if(entries.length>500) throw new Error('BACKUP_TOO_MANY_MARKS');
  for(const [raw,m] of entries){
    const symbol=normalizeSymbol(raw),price=finitePositive(m?.price,1e9); if(!symbol||!price) throw new Error('INVALID_BACKUP_MARK');
    const asOf=safeDateTime(m?.asOf,{required:true});
    out[symbol]={...m,price,asOf,source:String(m?.source||'unknown').slice(0,80)};
  }
  return out;
}
function normalizeStoredPaperOrder(v){
  if(!obj(v)||!SAFE_ID.test(String(v.id||''))) throw new Error('INVALID_PAPER_ORDER');
  const symbol=normalizeSymbol(v.symbol); const side=String(v.side||'').toUpperCase(); const orderType=String(v.orderType||'').toUpperCase(); const status=String(v.status||'').toUpperCase();
  const quantity=finitePositive(v.quantity,1e9); if(!symbol||!SIDES.has(side)||!ORDER_TYPES.has(orderType)||!ORDER_STATUS.has(status)||!quantity) throw new Error('INVALID_PAPER_ORDER');
  const fees=Math.max(0,Number(v.fees)||0); if(!Number.isFinite(fees)||fees>1e9) throw new Error('INVALID_PAPER_ORDER_FEES');
  const limitPrice=v.limitPrice==null?null:finitePositive(v.limitPrice,1e9); const stopPrice=v.stopPrice==null?null:finitePositive(v.stopPrice,1e9); const fillPrice=v.fillPrice==null?null:finitePositive(v.fillPrice,1e9);
  if(orderType.includes('LIMIT')&&!limitPrice) throw new Error('INVALID_PAPER_ORDER_LIMIT');
  if(orderType.includes('STOP')&&!stopPrice) throw new Error('INVALID_PAPER_ORDER_STOP');
  if(status==='FILLED'&&!fillPrice) throw new Error('INVALID_PAPER_ORDER_FILL');
  const transactionId=v.transactionId==null?null:String(v.transactionId); if(transactionId&&!SAFE_ID.test(transactionId)) throw new Error('INVALID_PAPER_ORDER_TRANSACTION_ID');
  return {...structuredClone(v),symbol,side,orderType,status,quantity,fees,limitPrice,stopPrice,fillPrice,transactionId,createdAt:safeDateTime(v.createdAt)||new Date(0).toISOString(),updatedAt:safeDateTime(v.updatedAt)||safeDateTime(v.createdAt)||new Date(0).toISOString()};
}
function safePrefixMap(values,group,{maxEntries=2000,maxValueBytes=1000000}={}){
  if(values==null) return {};
  if(!obj(values)) throw new Error(`INVALID_BACKUP_${group.toUpperCase()}`);
  const spec=RESTORE_PREFIXES[group]; const entries=Object.entries(values); if(entries.length>maxEntries) throw new Error('BACKUP_PREFIX_TOO_MANY_ENTRIES');
  const out={};
  for(const [k,v] of entries){
    if(!spec.key.test(k)||k.includes('..')||k.includes('auth/')||k.length>600) throw new Error(`INVALID_BACKUP_KEY:${group}`);
    if(valueSize(v)>maxValueBytes) throw new Error('BACKUP_VALUE_TOO_LARGE');
    if(!obj(v)) throw new Error(`INVALID_BACKUP_VALUE:${group}`);
    out[k]=structuredClone(v);
  }
  return out;
}

export function normalizeBackupPayload(b={}){
  if(!obj(b)||![2,3,4,5].includes(Number(b.version))) throw new Error('BACKUP_VERSION_UNSUPPORTED');
  const transactions=validateTransactionLedger(Array.isArray(b.transactions)?b.transactions:[]); if(transactions.length>10000) throw new Error('TOO_MANY_TRANSACTIONS');
  const ids=new Set(); for(const t of transactions){ if(ids.has(t.id)) throw new Error('DUPLICATE_TRANSACTION_ID'); ids.add(t.id); }
  const marks=normalizeMarksObject(b.marks||{}); derivePortfolio(transactions,marks);
  const paperOrders=Array.isArray(b.paperOrders)?b.paperOrders.map(normalizeStoredPaperOrder):[]; if(paperOrders.length>500) throw new Error('TOO_MANY_PAPER_ORDERS');
  const txIds=new Set(transactions.map(t=>t.id));
  for(const o of paperOrders){ if(o.status==='FILLED' && (!o.transactionId || !txIds.has(o.transactionId))) throw new Error(`FILLED_ORDER_TRANSACTION_MISSING:${o.id}`); }
  const decisions=Array.isArray(b.decisions)?b.decisions.map(safeDecision):[]; if(decisions.length>500) throw new Error('TOO_MANY_DECISIONS');
  const decisionIds=new Set(); for(const d of decisions){ if(decisionIds.has(d.id)) throw new Error('DUPLICATE_DECISION_ID'); decisionIds.add(d.id); }
  const worldState=b.worldState?safeWorldState(b.worldState):null;
  return {
    version:5,
    exportedAt:safeDateTime(b.exportedAt)||new Date().toISOString(),
    profile:sanitizeProfile(b.profile||{}), settings:sanitizeSettings(b.settings||{}),
    transactions,marks,paperOrders,watchlist:normalizeSymbolList(Array.isArray(b.watchlist)?b.watchlist:[],{max:100}),
    worldState,traceStatus:b.traceStatus?boundedObject(b.traceStatus,'TRACE_STATUS',128000):null,
    decisions,
    snapshots:safePrefixMap(b.snapshots,'snapshots'),traces:safePrefixMap(b.traces,'traces'),worldStates:safePrefixMap(b.worldStates,'worldStates'),
    aiMirror:b.aiMirror?boundedObject(b.aiMirror,'AI_MIRROR',512000):null,
    aiMirrorHistory:Array.isArray(b.aiMirrorHistory)?b.aiMirrorHistory.slice(-250).map(v=>boundedObject(v,'AI_MIRROR_HISTORY_ITEM',512000)):[],
    walletMirror:b.walletMirror?boundedObject(b.walletMirror,'WALLET_MIRROR',512000):null,
    evolution:b.evolution?boundedObject(b.evolution,'EVOLUTION',1000000):null
  };
}

async function exportPrefix(prefix){ const keys=await listKeys(prefix); const out={}; for(const k of keys){ const v=await getJSON(k,null); if(v!==null) out[k]=v; } return out; }
async function captureBackup(){
  const idx=await getDecisionIndex(); const decisions=[];
  for(const id of idx.slice(-500)){ const d=await getJSON(`decisions/${id}`,null); if(d) decisions.push(d); }
  const [snapshots,traces,worldStates]=await Promise.all([exportPrefix('snapshots/'),exportPrefix('traces/'),exportPrefix('trace/world-state/')]);
  return {version:5,exportedAt:new Date().toISOString(),profile:await getProfile(),settings:await getSettings(),transactions:await getTransactions(),marks:await getMarks(),paperOrders:await getPaperOrders(),watchlist:await getWatchlist(),worldState:await getWorldState(),traceStatus:await getTraceStatus(),decisions,snapshots,traces,worldStates,aiMirror:await getAIMirror(),aiMirrorHistory:await getAIMirrorHistory(),walletMirror:await getWalletMirror(),evolution:await getEvolutionState()};
}
async function clearPrefix(prefix){ for(const k of await listKeys(prefix)) await deleteKey(k); }
async function setOrDelete(key,value){ if(value==null) await deleteKey(key); else await setJSON(key,value); }

async function applyNormalizedBackup(b){
  // Collections that can contain orphaned records are replaced, never overlaid.
  await Promise.all([clearPrefix('decisions/'),clearPrefix('snapshots/'),clearPrefix('traces/'),clearPrefix('trace/world-state/')]);
  await saveProfile(b.profile); await saveSettings(b.settings);
  await saveTransactions(b.transactions); await saveMarks(b.marks); await savePaperOrders(b.paperOrders); await saveWatchlist(b.watchlist);
  if(b.traceStatus) await saveTraceStatus(b.traceStatus); else await deleteKey('trace/status');
  await setOrDelete('mirror/ai/latest',b.aiMirror); await setJSON('mirror/ai/history',b.aiMirrorHistory||[]); await setOrDelete('mirror/wallet/latest',b.walletMirror); await setOrDelete('evolution/state',b.evolution);
  for(const d of b.decisions) await setJSON(`decisions/${d.id}`,d); await saveDecisionIndex(b.decisions.map(d=>d.id));
  for(const group of Object.keys(RESTORE_PREFIXES)) for(const [k,v] of Object.entries(b[group]||{})) await setJSON(k,v);
  if(b.worldState){ await setJSON('trace/world-state/latest',b.worldState); await setJSON(`trace/world-state/${b.worldState.date}`,b.worldState); }
}

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method==='GET') return json(await captureBackup());
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner','admin']); }catch{ return json({error:'FORBIDDEN'},403); }
  let raw; try{ raw=await readJSON(req,{maxBytes:MAX_RESTORE_BYTES}); }catch(e){ return json({error:String(e.message||e)},413); }
  let incoming; try{ incoming=normalizeBackupPayload(raw); }catch(e){ return json({error:String(e.message||e)},400); }
  return await withKeyLock('backup-restore',async()=>{
    const restoreId=crypto.randomUUID(); const snapshotKey=`restore/snapshots/${restoreId}`; const stagingKey=`restore/staging/${restoreId}`; const statusKey=`restore/status/${restoreId}`;
    let previous;
    try{
      previous=normalizeBackupPayload(await captureBackup());
      await setJSON(snapshotKey,{...previous,recoverySnapshot:true,restoreId});
      await setJSON(stagingKey,{...incoming,restoreId,stagedAt:new Date().toISOString()});
      await setJSON(statusKey,{restoreId,status:'APPLYING',startedAt:new Date().toISOString(),snapshotKey});
      await applyNormalizedBackup(incoming);
      await setJSON(statusKey,{restoreId,status:'COMPLETE',startedAt:(await getJSON(statusKey,{}))?.startedAt||null,finishedAt:new Date().toISOString(),snapshotKey});
      await deleteKey(stagingKey).catch(()=>{});
      await pruneJSONCollection('restore/snapshots/',{maxEntries:5,minIntervalMs:0,timestampFields:['exportedAt']}).catch(()=>{});
      await pruneJSONCollection('restore/status/',{maxEntries:20,minIntervalMs:0,timestampFields:['finishedAt','startedAt']}).catch(()=>{});
      return json({ok:true,restoreId,recoverySnapshotKey:snapshotKey,version:5});
    }catch(e){
      let rollbackSucceeded=false; let rollbackError=null;
      if(previous){ try{ await applyNormalizedBackup(previous); rollbackSucceeded=true; }catch(rb){ rollbackError=String(rb?.message||rb); } }
      try{ await setJSON(statusKey,{restoreId,status:'FAILED',finishedAt:new Date().toISOString(),error:String(e?.message||e),rollbackSucceeded,rollbackError,snapshotKey}); }catch{}
      return json({error:'BACKUP_RESTORE_FAILED',detail:String(e?.message||e),restoreId,rollbackSucceeded,rollbackError,recoverySnapshotKey:previous?snapshotKey:null},500);
    }
  },{ttlMs:120000,waitMs:10000});
};
