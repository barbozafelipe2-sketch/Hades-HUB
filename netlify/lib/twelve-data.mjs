import { getEnv } from './env.mjs';
const BASE='https://api.twelvedata.com';
const MAP={BTC:'BTC/USD',ETH:'ETH/USD'};
const CRYPTO_CANONICAL_RE=/^([A-Z0-9]{1,18})-USD$/;
/** Tiny-plan friendly defaults: low concurrency + spacing so ~8/min plans don't 429 as hard. */
const DEFAULT_QUOTE_CONCURRENCY=Math.max(1,Math.min(2,Number(getEnv('HADES_TWELVE_QUOTE_CONCURRENCY',2))));
const DEFAULT_SERIES_CONCURRENCY=Math.max(1,Math.min(2,Number(getEnv('HADES_TWELVE_SERIES_CONCURRENCY',1))));
const DEFAULT_BATCH_GAP_MS=Math.max(250,Math.min(400,Number(getEnv('HADES_TWELVE_BATCH_GAP_MS',300))));

function key(){ return String(getEnv('TWELVE_DATA_API_KEY')).trim(); }
export function twelveConfigured(){ return !!key(); }
export function twelveSymbol(symbol){ const s=String(symbol||'').trim().toUpperCase(); const m=s.match(CRYPTO_CANONICAL_RE); return m?`${m[1]}/USD`:(MAP[s]||s); }
export function twelveIsCryptoSymbol(symbol){ const s=String(symbol||'').trim().toUpperCase(); return !!MAP[s] || CRYPTO_CANONICAL_RE.test(s); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function td(path,params={},timeoutMs=9000){
  if(!key()) throw new Error('TWELVE_DATA_API_KEY_MISSING');
  const u=new URL(BASE+path); for(const [k,v] of Object.entries(params)) if(v!=null&&v!=='') u.searchParams.set(k,String(v));
  u.searchParams.set('apikey',key());
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch(u,{headers:{Accept:'application/json'},signal:ctl.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`TWELVE_DATA_HTTP_${r.status}:${String(data?.message||'').slice(0,140)}`);
    if(data?.status==='error' || data?.code) throw new Error(`TWELVE_DATA_${data.code||'ERROR'}:${String(data?.message||'').slice(0,180)}`);
    return data;
  }catch(e){ if(e?.name==='AbortError') throw new Error('TWELVE_DATA_TIMEOUT'); throw e; }
  finally{ clearTimeout(timer); }
}
export async function twelveCryptoCatalog({timeoutMs=12000}={}){
  const d=await td('/cryptocurrencies',{},Math.max(1000,Math.min(15000,Number(timeoutMs)||12000)));
  const rows=Array.isArray(d?.data)?d.data:[];
  return rows.slice(0,25000).map(row=>({
    symbol:String(row?.symbol||'').toUpperCase(),
    currencyBase:String(row?.currency_base||'').trim(),
    currencyQuote:String(row?.currency_quote||'').trim(),
    availableExchanges:Array.isArray(row?.available_exchanges)?row.available_exchanges.slice(0,100):[]
  })).filter(row=>row.symbol);
}

export async function twelveQuote(symbol,{timeoutMs=9000}={}){
  const requested=String(symbol||'').toUpperCase(); const vendor=twelveSymbol(requested);
  const d=await td('/quote',{symbol:vendor},Math.max(250,Math.min(9000,Number(timeoutMs)||9000)));
  const price=Number(d.close??d.price); if(!Number.isFinite(price)||price<=0) throw new Error(`TWELVE_DATA_BAD_QUOTE:${requested}`);
  return {symbol:requested,vendorSymbol:vendor,price,asOf:d.datetime||d.timestamp||new Date().toISOString(),currency:d.currency||'USD',exchange:d.exchange||null,change:Number.isFinite(Number(d.change))?Number(d.change):null,percentChange:Number.isFinite(Number(d.percent_change))?Number(d.percent_change):null};
}
export async function twelveSeries(symbol,{outputsize=32,interval='1day',startDate=null,endDate=null}={}){
  const requested=String(symbol||'').toUpperCase(); const vendor=twelveSymbol(requested);
  const params={symbol:vendor,interval,outputsize:Math.max(2,Math.min(90,Number(outputsize)||32)),order:'ASC',timezone:twelveIsCryptoSymbol(requested)?'UTC':'America/New_York'};
  if(startDate) params.start_date=String(startDate).slice(0,10);
  if(endDate) params.end_date=`${String(endDate).slice(0,10)} 23:59:59`;
  const d=await td('/time_series',params);
  const points=(Array.isArray(d.values)?d.values:[]).map(v=>({date:String(v.datetime||'').slice(0,10),price:Number(v.close),confidence:'high',source:'twelve_data'})).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(p.price)&&p.price>0);
  if(points.length<2) throw new Error(`TWELVE_DATA_THIN_SERIES:${requested}`);
  return {symbol:requested,vendorSymbol:vendor,points};
}

export async function twelveHistoricalClose(symbol,date,{lookbackDays=10}={}){
  const target=String(date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('HISTORICAL_DATE_INVALID');
  const end=new Date(`${target}T00:00:00Z`); const start=new Date(end); start.setUTCDate(start.getUTCDate()-Math.max(3,Math.min(20,Number(lookbackDays)||10)));
  const startDate=start.toISOString().slice(0,10);
  const r=await twelveSeries(symbol,{outputsize:Math.max(8,Math.min(30,Number(lookbackDays)||10)+6),startDate,endDate:target});
  const pts=(r.points||[]).filter(p=>p.date<=target).sort((a,b)=>a.date.localeCompare(b.date));
  const pt=pts.at(-1); if(!pt) throw new Error(`TWELVE_DATA_NO_HISTORICAL_CLOSE:${String(symbol||'').toUpperCase()}:${target}`);
  return {symbol:String(symbol||'').toUpperCase(),price:Number(pt.price),date:pt.date,asOf:`${pt.date}T23:59:59Z`,source:'twelve_data',provider:'twelve_data',requestedDate:target,exact:pt.date===target};
}

export async function twelveQuotes(symbols,{concurrency=DEFAULT_QUOTE_CONCURRENCY,batchGapMs=DEFAULT_BATCH_GAP_MS}={}){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').toUpperCase()).filter(Boolean))]; const out=[]; const errors=[];
  const conc=Math.max(1,Math.min(2,Number(concurrency)||2));
  const gap=Math.max(250,Math.min(400,Number(batchGapMs)||300));
  for(let i=0;i<list.length;i+=conc){
    if(i>0) await sleep(gap);
    const batch=list.slice(i,i+conc); const rows=await Promise.all(batch.map(async s=>{try{return await twelveQuote(s)}catch(e){errors.push({symbol:s,error:String(e.message||e).slice(0,180)});return null}})); out.push(...rows.filter(Boolean));
  }
  if(!out.length) throw new Error(`TWELVE_DATA_QUOTES_FAILED:${errors.slice(0,3).map(e=>e.error).join('|')}`);
  return {quotes:out,errors};
}
export async function twelveSeriesBundle(symbols,{outputsize=32,concurrency=DEFAULT_SERIES_CONCURRENCY,batchGapMs=DEFAULT_BATCH_GAP_MS,deadlineAt}={}){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').toUpperCase()).filter(Boolean))]; const series={}; const errors=[];
  const conc=Math.max(1,Math.min(2,Number(concurrency)||1));
  const gap=Math.max(250,Math.min(400,Number(batchGapMs)||300));
  for(let i=0;i<list.length;i+=conc){
    if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt){ errors.push({symbol:'_wall',error:'MARKET_REFRESH_WALL'}); break; }
    if(i>0) await sleep(gap);
    const batch=list.slice(i,i+conc); await Promise.all(batch.map(async s=>{try{series[s]=(await twelveSeries(s,{outputsize})).points}catch(e){series[s]=[];errors.push({symbol:s,error:String(e.message||e).slice(0,180)})}}));
  }
  const ready=Object.values(series).filter(v=>v.length>=2).length; if(!ready) throw new Error(`TWELVE_DATA_SERIES_FAILED:${errors.slice(0,3).map(e=>e.error).join('|')}`);
  return {asOf:new Date().toISOString().slice(0,10),generatedAt:new Date().toISOString(),grade:'licensed_market_data',disclaimer:'Price history supplied by Twelve Data. Exchange coverage and entitlement depend on the Twelve Data plan.',provider:'twelve_data',series,meta:{readySymbols:ready,findings:errors.map(e=>`${e.symbol}:${e.error}`).slice(0,18),market_source:'twelve_data',fallback_used:false,throttle:{concurrency:conc,batchGapMs:gap},partial:Number.isFinite(deadlineAt)&&Date.now()>=deadlineAt}};
}
export async function twelveHealth(){ const t=Date.now(); if(!key()) return {provider:'twelve_data',keyDetected:false,requestOk:false,authOk:false,latencyMs:0,lastError:'TWELVE_DATA_API_KEY_MISSING'}; try{const q=await twelveQuote('SPY');return {provider:'twelve_data',keyDetected:true,requestOk:true,authOk:true,latencyMs:Date.now()-t,lastError:null,sample:{symbol:q.symbol,price:q.price,asOf:q.asOf}}}catch(e){const msg=String(e.message||e); const authFail=/MISSING|REJECTED|401|403|invalid.?api.?key/i.test(msg); return {provider:'twelve_data',keyDetected:true,requestOk:false,authOk:!authFail,latencyMs:Date.now()-t,lastError:msg.slice(0,240)}} }
