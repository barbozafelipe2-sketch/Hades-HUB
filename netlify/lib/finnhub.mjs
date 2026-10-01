import { getEnv } from './env.mjs';
/** Finnhub quote client — free-tier friendly; never log tokens. */
const BASE='https://finnhub.io/api/v1';
/** Equity tickers that collide with crypto short names on Finnhub. */
const CRYPTO_MAP={BTC:'BINANCE:BTCUSDT',ETH:'BINANCE:ETHUSDT'};
const CRYPTO_CANONICAL_RE=/^([A-Z0-9]{1,18})-USD$/;

function key(){ return String(getEnv('FINNHUB_API_KEY')).trim(); }
export function finnhubConfigured(){ return !!key(); }
export async function finnhubCryptoCatalog({exchange='BINANCE',timeoutMs=12000}={}){
  const ex=String(exchange||'BINANCE').trim().toUpperCase().replace(/[^A-Z0-9._-]/g,'').slice(0,24)||'BINANCE';
  const d=await fh('/crypto/symbol',{exchange:ex},Math.max(1000,Math.min(15000,Number(timeoutMs)||12000)));
  const rows=Array.isArray(d)?d:[];
  const out=[];
  for(const row of rows.slice(0,30000)){
    const vendor=String(row?.symbol||'').trim().toUpperCase();
    const display=String(row?.displaySymbol||row?.display_symbol||'').trim().toUpperCase();
    let base='';
    let m=display.match(/^([A-Z0-9]{1,18})[\/-]USDT$/);
    if(m) base=m[1];
    if(!base){ m=vendor.match(/^[A-Z0-9._-]+:([A-Z0-9]{1,18})USDT$/); if(m) base=m[1]; }
    if(!base) continue;
    out.push({symbol:`${base}/USD`,currencyBase:String(row?.description||base).trim()||base,currencyQuote:'US Dollar',availableExchanges:[ex],vendorSymbol:vendor});
  }
  return out;
}
export function finnhubSymbol(symbol){
  const s=String(symbol||'').trim().toUpperCase();
  const m=s.match(CRYPTO_CANONICAL_RE);
  return m?`BINANCE:${m[1]}USDT`:(CRYPTO_MAP[s]||s);
}
export function finnhubIsCryptoSymbol(symbol){ const s=String(symbol||'').trim().toUpperCase(); return !!CRYPTO_MAP[s] || CRYPTO_CANONICAL_RE.test(s); }

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fh(path,params={},timeoutMs=9000){
  if(!key()) throw new Error('FINNHUB_API_KEY_MISSING');
  const u=new URL(BASE+path);
  for(const [k,v] of Object.entries(params)) if(v!=null&&v!=='') u.searchParams.set(k,String(v));
  u.searchParams.set('token',key());
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch(u,{headers:{Accept:'application/json'},signal:ctl.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(`FINNHUB_HTTP_${r.status}:${String(data?.error||data?.message||'').slice(0,140)}`);
    if(data?.error) throw new Error(`FINNHUB_ERROR:${String(data.error).slice(0,180)}`);
    return data;
  }catch(e){ if(e?.name==='AbortError') throw new Error('FINNHUB_TIMEOUT'); throw e; }
  finally{ clearTimeout(timer); }
}

/**
 * Map Finnhub /quote → same shape as twelveQuote.
 * { c,d,dp,h,l,o,pc,t } — c=current, d=change, dp=%change, t=unix seconds
 */
export async function finnhubQuote(symbol,{timeoutMs=9000}={}){
  const requested=String(symbol||'').toUpperCase();
  const vendor=finnhubSymbol(requested);
  const d=await fh('/quote',{symbol:vendor},Math.max(250,Math.min(9000,Number(timeoutMs)||9000)));
  const price=Number(d.c);
  if(!Number.isFinite(price)||price<=0) throw new Error(`FINNHUB_BAD_QUOTE:${requested}`);
  const asOf=Number.isFinite(Number(d.t))&&Number(d.t)>0
    ? new Date(Number(d.t)*1000).toISOString()
    : new Date().toISOString();
  return {
    symbol:requested,
    vendorSymbol:vendor,
    price,
    asOf,
    currency:'USD',
    exchange:null,
    change:Number.isFinite(Number(d.d))?Number(d.d):null,
    percentChange:Number.isFinite(Number(d.dp))?Number(d.dp):null,
    provider:'finnhub'
  };
}

export async function finnhubHealth(){
  const t=Date.now();
  if(!key()) return {provider:'finnhub',keyDetected:false,requestOk:false,authOk:false,latencyMs:0,lastError:'FINNHUB_API_KEY_MISSING'};
  try{
    const q=await finnhubQuote('SPY');
    return {provider:'finnhub',keyDetected:true,requestOk:true,authOk:true,latencyMs:Date.now()-t,lastError:null,sample:{symbol:q.symbol,price:q.price,asOf:q.asOf}};
  }catch(e){
    const msg=String(e.message||e);
    const authFail=/MISSING|REJECTED|401|403|invalid.?api.?key/i.test(msg);
    return {provider:'finnhub',keyDetected:true,requestOk:false,authOk:!authFail,latencyMs:Date.now()-t,lastError:msg.slice(0,240)};
  }
}


/**
 * Daily candles via /stock/candle (or /crypto/candle for BTC/ETH).
 * Free-tier: resolution=D; returns {symbol, points:[{date,price,...}]}.
 */
export async function finnhubSeries(symbol,{outputsize=32,startDate=null,endDate=null}={}){
  const requested=String(symbol||'').toUpperCase();
  const vendor=finnhubSymbol(requested);
  const isCrypto=finnhubIsCryptoSymbol(requested);
  const n=Math.max(2,Math.min(90,Number(outputsize)||32));
  const to=endDate?Math.floor(Date.parse(`${String(endDate).slice(0,10)}T23:59:59Z`)/1000):Math.floor(Date.now()/1000);
  const from=startDate?Math.floor(Date.parse(`${String(startDate).slice(0,10)}T00:00:00Z`)/1000):to - Math.ceil(n*1.6)*86400; // weekdays buffer
  const path=isCrypto?'/crypto/candle':'/stock/candle';
  const d=await fh(path,{symbol:vendor,resolution:'D',from,to});
  if(String(d?.s||'')==='no_data') throw new Error(`FINNHUB_NO_DATA:${requested}`);
  if(String(d?.s||'')!=='ok') throw new Error(`FINNHUB_CANDLE_${d?.s||'ERROR'}:${requested}`);
  const closes=Array.isArray(d.c)?d.c:[];
  const times=Array.isArray(d.t)?d.t:[];
  const points=[];
  for(let i=0;i<Math.min(closes.length,times.length);i++){
    const price=Number(closes[i]);
    const ts=Number(times[i]);
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(ts)) continue;
    const date=new Date(ts*1000).toISOString().slice(0,10);
    points.push({date,price,confidence:'high',source:'finnhub'});
  }
  points.sort((a,b)=>a.date.localeCompare(b.date));
  const map=new Map(); for(const pt of points) map.set(pt.date,pt);
  const out=[...map.values()];
  if(out.length<2) throw new Error(`FINNHUB_THIN_SERIES:${requested}`);
  return {symbol:requested,vendorSymbol:vendor,points:out.slice(-n)};
}


export async function finnhubHistoricalClose(symbol,date,{lookbackDays=10}={}){
  const target=String(date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('HISTORICAL_DATE_INVALID');
  const end=new Date(`${target}T00:00:00Z`); const start=new Date(end); start.setUTCDate(start.getUTCDate()-Math.max(3,Math.min(20,Number(lookbackDays)||10)));
  const r=await finnhubSeries(symbol,{outputsize:Math.max(8,Math.min(30,Number(lookbackDays)||10)+6),startDate:start.toISOString().slice(0,10),endDate:target});
  const pts=(r.points||[]).filter(p=>p.date<=target).sort((a,b)=>a.date.localeCompare(b.date));
  const pt=pts.at(-1); if(!pt) throw new Error(`FINNHUB_NO_HISTORICAL_CLOSE:${String(symbol||'').toUpperCase()}:${target}`);
  return {symbol:String(symbol||'').toUpperCase(),price:Number(pt.price),date:pt.date,asOf:`${pt.date}T23:59:59Z`,source:'finnhub',provider:'finnhub',requestedDate:target,exact:pt.date===target};
}

export async function finnhubSeriesBundle(symbols,{outputsize=32,concurrency=1,batchGapMs=350,deadlineAt}={}){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').toUpperCase()).filter(Boolean))];
  const series={}; const errors=[];
  const conc=Math.max(1,Math.min(2,Number(concurrency)||1));
  const gap=Math.max(250,Math.min(500,Number(batchGapMs)||350));
  for(let i=0;i<list.length;i+=conc){
    if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt){ errors.push({symbol:'_wall',error:'MARKET_REFRESH_WALL'}); break; }
    if(i>0) await sleep(gap);
    const batch=list.slice(i,i+conc);
    await Promise.all(batch.map(async s=>{
      try{ series[s]=(await finnhubSeries(s,{outputsize})).points; }
      catch(e){ series[s]=[]; errors.push({symbol:s,error:String(e.message||e).slice(0,180)}); }
    }));
  }
  const ready=Object.values(series).filter(v=>v.length>=2).length;
  if(!ready) throw new Error(`FINNHUB_SERIES_FAILED:${errors.slice(0,3).map(e=>e.error).join('|')}`);
  return {
    asOf:new Date().toISOString().slice(0,10),
    generatedAt:new Date().toISOString(),
    grade:'licensed_market_data',
    disclaimer:'Price history supplied by Finnhub. Coverage depends on Finnhub plan.',
    provider:'finnhub',
    series,
    meta:{readySymbols:ready,findings:errors.map(e=>`${e.symbol}:${e.error}`).slice(0,18),market_source:'finnhub',fallback_used:false,partial:Number.isFinite(deadlineAt)&&Date.now()>=deadlineAt}
  };
}

export { sleep };
