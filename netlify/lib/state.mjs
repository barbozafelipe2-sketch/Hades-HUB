import { getJSON, setJSON, listKeys, withKeyLock } from './store.mjs';
import { derivePortfolio, performanceFromSnapshots, normalizeTransaction, normalizeSymbol, validateTransactionLedger } from './portfolio.mjs';
import { normalizeSymbolList } from './input.mjs';

export const DEFAULT_PROFILE={
  name:'Private User',email:'',country:'United States',baseCurrency:'USD',goal:'Long-term wealth',targetAmount:250000,horizon:'10y+',riskStyle:'Moderate',contributionAmount:1000,contributionFrequency:'Monthly',investorType:'Long-term builder',experience:'Intermediate',riskCapacity:'Moderate',maxDrawdownTolerance:20,liquidityNeed:'Moderate',emergencyReserveMonths:6,incomeStability:'Stable',taxResidency:'United States'
};
export const DEFAULT_SETTINGS={displayMode:'auto',autoMarketMarks:true,onboardingComplete:false,evolutionAutoRun:true,evolutionAutoPromote:false};

function text(v, fallback='', max=100){
  const s=String(v ?? fallback).replace(/[\u0000-\u001F\u007F]/g,'').trim();
  return (s || fallback).slice(0,max);
}
function boundedNumber(v,{min=0,max=1000000000,fallback=0}={}){
  const n=Number(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.min(max,Math.max(min,n));
}
function pick(v, allowed, fallback){
  return allowed.includes(v) ? v : fallback;
}
export function sanitizeProfile(input={}){
  const p={...DEFAULT_PROFILE,...(input||{})};
  return {
    ...DEFAULT_PROFILE,
    name:text(p.name,DEFAULT_PROFILE.name,80),
    email:text(p.email,'',120),
    country:text(p.country,DEFAULT_PROFILE.country,80),
    baseCurrency:pick(String(p.baseCurrency||'USD').toUpperCase(),['USD','EUR','BRL','GBP'],DEFAULT_PROFILE.baseCurrency),
    goal:text(p.goal,DEFAULT_PROFILE.goal,80),
    targetAmount:boundedNumber(p.targetAmount,{min:0,max:100000000, fallback:DEFAULT_PROFILE.targetAmount}),
    horizon:pick(p.horizon,['<1y','1-3y','3-10y','10y+'],DEFAULT_PROFILE.horizon),
    riskStyle:pick(p.riskStyle,['Conservative','Moderate','Aggressive'],DEFAULT_PROFILE.riskStyle),
    contributionAmount:boundedNumber(p.contributionAmount,{min:0,max:10000000,fallback:DEFAULT_PROFILE.contributionAmount}),
    contributionFrequency:pick(p.contributionFrequency,['Weekly','Biweekly','Monthly','Quarterly','Annual'],DEFAULT_PROFILE.contributionFrequency),
    investorType:text(p.investorType,DEFAULT_PROFILE.investorType,80),
    experience:pick(p.experience,['Beginner','Intermediate','Advanced'],DEFAULT_PROFILE.experience),
    riskCapacity:pick(p.riskCapacity,['Low','Moderate','High'],DEFAULT_PROFILE.riskCapacity),
    maxDrawdownTolerance:boundedNumber(p.maxDrawdownTolerance,{min:0,max:95,fallback:DEFAULT_PROFILE.maxDrawdownTolerance}),
    liquidityNeed:pick(p.liquidityNeed,['Low','Moderate','High'],DEFAULT_PROFILE.liquidityNeed),
    emergencyReserveMonths:boundedNumber(p.emergencyReserveMonths,{min:0,max:60,fallback:DEFAULT_PROFILE.emergencyReserveMonths}),
    incomeStability:pick(p.incomeStability,['Stable','Variable','Unstable'],DEFAULT_PROFILE.incomeStability),
    taxResidency:text(p.taxResidency,p.country||DEFAULT_PROFILE.taxResidency,80),
  };
}
export function sanitizeSettings(input={}){
  const s={...DEFAULT_SETTINGS,...(input||{})};
  return {
    displayMode:pick(s.displayMode,['auto','compact','desktop'],DEFAULT_SETTINGS.displayMode),
    autoMarketMarks:s.autoMarketMarks!==false,
    onboardingComplete:s.onboardingComplete===true,
    evolutionAutoRun:true, // always on
    evolutionAutoPromote:s.evolutionAutoPromote===true,
  };
}
export function modelSafeProfile(profile={}){
  const p=sanitizeProfile(profile);
  const {name,email,...safe}=p;
  return safe;
}

export async function getProfile(){ return sanitizeProfile(await getJSON('user/profile',{})); }
export async function saveProfile(p){ const current=await getJSON('user/profile',{}); const v={...sanitizeProfile({...current,...p}),updatedAt:new Date().toISOString()}; await setJSON('user/profile',v); return v; }
export async function getSettings(){ return sanitizeSettings(await getJSON('user/settings',{})); }
export async function saveSettings(s){ const current=await getJSON('user/settings',{}); const v={...sanitizeSettings({...current,...s}),updatedAt:new Date().toISOString()}; await setJSON('user/settings',v); return v; }
export async function getTransactions(){ return await getJSON('portfolio/transactions',[]); }
export async function saveTransactions(t){
  if(!Array.isArray(t) || t.length>10000) throw new Error('INVALID_TRANSACTIONS');
  const rows=validateTransactionLedger(t);
  const ids=new Set(); for(const x of rows){ if(ids.has(x.id)) throw new Error('DUPLICATE_TRANSACTION_ID'); ids.add(x.id); }
  derivePortfolio(rows,await getMarks());
  await setJSON('portfolio/transactions',rows); return rows;
}
export async function getMarks(){ return await getJSON('portfolio/marks',{}); }
export async function saveMarks(m){
  if(!m || typeof m!=='object' || Array.isArray(m)) throw new Error('INVALID_MARKS');
  const out={};
  for(const [raw,v] of Object.entries(m).slice(0,500)){
    const symbol=normalizeSymbol(raw); const price=Number(v?.price);
    if(!symbol || !Number.isFinite(price) || price<=0 || price>1e9) throw new Error('INVALID_MARK');
    const asOf=String(v?.asOf||''); if(!Number.isFinite(Date.parse(asOf))) throw new Error('INVALID_MARK_TIMESTAMP');
    out[symbol]={...v,price,source:String(v?.source||'unknown').slice(0,80),asOf};
  }
  await setJSON('portfolio/marks',out); return out;
}
export async function getPortfolio(opts={}){ const [tx,marks]=await Promise.all([getTransactions(),getMarks()]); return {transactions:tx,marks,derived:derivePortfolio(tx,marks,opts)}; }
export async function getWorldState(){ return await getJSON('trace/world-state/latest',null); }
export async function saveWorldState(ws){ await setJSON('trace/world-state/latest',ws); await setJSON(`trace/world-state/${ws.date}`,ws); return ws; }
export async function getTraceStatus(){ return await getJSON('trace/status',{lastSuccessfulDate:null,lastAttemptAt:null,lastError:null,catchupRunning:false}); }
export async function saveTraceStatus(v){ await setJSON('trace/status',v); return v; }
export async function getDecisionIndex(){ return await getJSON('decisions/index',[]); }
export async function saveDecisionIndex(v){ await setJSON('decisions/index',v); return v; }
export async function getDecisions(){
  const ids=await getDecisionIndex(); const out=[];
  for(const id of ids.slice().reverse().slice(0,200)){ const d=await getJSON(`decisions/${id}`,null); if(d) out.push(d); }
  return out;
}
export async function getSnapshots(){
  const keys=(await listKeys('snapshots/')).filter(k=>/^snapshots\/\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const out=[]; for(const k of keys.slice(-730)){ const s=await getJSON(k,null); if(s) out.push(s); }
  return out;
}
export async function getPerformance(){ return performanceFromSnapshots(await getSnapshots()); }


export async function getAIMirror(){ return await getJSON('mirror/ai/latest',null); }
export async function getAIMirrorHistory(){ return await getJSON('mirror/ai/history',[]); }
export async function saveAIMirrorHistory(v){ const rows=Array.isArray(v)?v.slice(-250):[]; await setJSON('mirror/ai/history',rows); return rows; }
export async function saveAIMirror(v){
  await setJSON('mirror/ai/latest',v);
  if(v?.status==='APPROVED') {
    await withKeyLock('ai-mirror-history',async()=>{
      const rows=await getAIMirrorHistory();
      if(!rows.some(r=>r?.generatedAt===v.generatedAt)) rows.push(v);
      await saveAIMirrorHistory(rows);
    });
  }
  return v;
}
export async function getWalletMirror(){ return await getJSON('mirror/wallet/latest',null); }
export async function saveWalletMirror(v){ await setJSON('mirror/wallet/latest',v); return v; }

// Paper broker state: server-side and persistent when the active store is persistent.
export async function getPaperOrders(){
  const rows=await getJSON('broker/orders',[]);
  return Array.isArray(rows)?rows.slice(-500):[];
}
export async function savePaperOrders(v){
  const rows=Array.isArray(v)?v.slice(-500):[];
  await setJSON('broker/orders',rows);
  return rows;
}
export async function getWatchlist(){
  const rows=await getJSON('broker/watchlist',[]);
  return normalizeSymbolList(rows,{max:100});
}
export async function saveWatchlist(v){
  const rows=normalizeSymbolList(v,{max:100});
  await setJSON('broker/watchlist',rows);
  return rows;
}
export async function getEvolutionState(){ return await getJSON('evolution/state',{champion:{version:'1.0.0',name:'Baseline Decision Review',promotedAt:null,score:null,criteria:{}},challenger:null,lastCycleAt:null,lastObservationAt:null,history:[]}); }
export async function saveEvolutionState(v){ await setJSON('evolution/state',v); return v; }
export async function getMarketHistory(limit=180){
  const keys=(await listKeys('trace/world-state/')).filter(k=>/^trace\/world-state\/\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-Math.max(2,Math.min(730,limit)));
  const out=[]; for(const k of keys){ const v=await getJSON(k,null); if(v) out.push(v); }
  return out;
}
