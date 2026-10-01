import { getEnv, cleanSecret } from './env.mjs';
import { twelveConfigured, twelveQuote, twelveSeries } from './twelve-data.mjs';
import { finnhubConfigured, finnhubQuote, finnhubSeries } from './finnhub.mjs';

const CACHE_TTL_MS=Math.max(5000,Math.min(60000,Number(getEnv('KAIROS_QUOTE_CACHE_TTL_MS','20000'))||20000));
const quotes=new Map();
const inflight=new Map();
const stickyFallback=new Map();
const canon=s=>String(s||'').trim().toUpperCase();
const configured=(name)=>!!cleanSecret(getEnv(name));
const nowISO=()=>new Date().toISOString();

export function licensedMarketConfigured(){return !!String(getEnv('KAIROS_LICENSED_MARKET_BASE_URL')||'').trim()&&configured('KAIROS_LICENSED_MARKET_API_KEY');}
function metadata(symbol,data,source,{pointInTime=false}={}){
  const licenseId=String(data?.license_id||data?.licenseId||getEnv(`${source.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_LICENSE_ID`)||'operator-attested').slice(0,120);
  const price=Number(data?.price??data?.close??data?.value);
  if(!Number.isFinite(price)||price<=0) throw new Error('MARKET_VALUE_INVALID');
  return {symbol:canon(symbol),price,source:String(data?.source||source).slice(0,80),asof:String(data?.asof||data?.asOf||data?.datetime||nowISO()),exchange:data?.exchange?String(data.exchange).slice(0,80):null,delay_class:String(data?.delay_class||data?.delayClass||getEnv('KAIROS_MARKET_DELAY_CLASS','unknown')).slice(0,40),license_id:licenseId,point_in_time:pointInTime===true,provider:String(data?.provider||source),currency:String(data?.currency||'USD'),change:Number.isFinite(Number(data?.change))?Number(data.change):null,percentChange:Number.isFinite(Number(data?.percentChange??data?.percent_change))?Number(data.percentChange??data.percent_change):null};
}
async function primary(path,params={}){
  if(!licensedMarketConfigured()) throw new Error('LICENSED_MARKET_NOT_CONFIGURED');
  const base=String(getEnv('KAIROS_LICENSED_MARKET_BASE_URL')).replace(/\/$/,'');
  const url=new URL(`${base}/${path.replace(/^\//,'')}`);
  for(const [k,v] of Object.entries(params)) if(v!=null) url.searchParams.set(k,String(v));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(9000,Number(getEnv('KAIROS_MARKET_TIMEOUT_MS','7000'))||7000));
  try{
    const res=await fetch(url,{headers:{Accept:'application/json','Authorization':`Bearer ${cleanSecret(getEnv('KAIROS_LICENSED_MARKET_API_KEY'))}`,'X-API-Key':cleanSecret(getEnv('KAIROS_LICENSED_MARKET_API_KEY'))},signal:controller.signal});
    const body=await res.json().catch(()=>null);
    if(!res.ok||!body||body.error) throw new Error(`LICENSED_MARKET_HTTP_${res.status}`);
    return body.data||body;
  }finally{clearTimeout(timer);}
}
async function fallbackQuote(symbol,preferred=null){
  const providers=[];
  if(preferred==='twelve'&&twelveConfigured()) providers.push('twelve');
  if(preferred==='finnhub'&&finnhubConfigured()) providers.push('finnhub');
  if(!providers.includes('twelve')&&twelveConfigured()) providers.push('twelve');
  if(!providers.includes('finnhub')&&finnhubConfigured()) providers.push('finnhub');
  let last;
  for(const p of providers){try{
    const q=p==='twelve'?await twelveQuote(symbol):await finnhubQuote(symbol);
    stickyFallback.set(symbol,p);
    return metadata(symbol,q,p==='twelve'?'twelve_data':'finnhub',{pointInTime:false});
  }catch(e){last=e;}}
  throw last||new Error('MARKET_SYMBOL_UNAVAILABLE');
}
export async function quote(symbol,{force=false,deadlineAt}={}){
  const s=canon(symbol); if(!s) throw new Error('MARKET_SYMBOL_REQUIRED');
  if(Number.isFinite(deadlineAt)&&Date.now()>=deadlineAt-750)throw new Error('MARKET_REFRESH_WALL');
  const hit=quotes.get(s); if(!force&&hit&&Date.now()-hit.at<CACHE_TTL_MS) return {...hit.value,cache_hit:true};
  if(inflight.has(s)) return {...await inflight.get(s),deduped:true};
  const task=(async()=>{
    let value;
    try{const raw=await primary('quote',{symbol:s});value=metadata(s,raw,raw.source||'licensed_market_feed',{pointInTime:false});}
    catch(primaryError){
      if(Number.isFinite(deadlineAt)&&Date.now()>deadlineAt) throw new Error('MARKET_REFRESH_WALL');
      try{value=await fallbackQuote(s,stickyFallback.get(s));}
      catch(fallbackError){
        if(hit) return {...hit.value,stale:true,cache_hit:true};
        const err=new Error(`MARKET_DATA_UNAVAILABLE:${s}`);err.cause=fallbackError;throw err;
      }
      value.fallback_from='licensed_market_feed';
    }
    quotes.set(s,{value,at:Date.now()}); return value;
  })();
  inflight.set(s,task);
  try{return await task;}finally{if(inflight.get(s)===task)inflight.delete(s);}
}
export async function closes(symbol,from,to){
  const s=canon(symbol); if(!s) throw new Error('MARKET_SYMBOL_REQUIRED');
  let rows,source;
  try{const d=await primary('closes',{symbol:s,from,to});rows=Array.isArray(d)?d:(d.closes||d.points||d.data||[]);source=d.source||'licensed_market_feed';}
  catch{
    const preferred=stickyFallback.get(s);
    const order=[preferred,'twelve','finnhub'].filter((x,i,a)=>x&&a.indexOf(x)===i);
    let last;
    for(const p of order){if((p==='twelve'&&!twelveConfigured())||(p==='finnhub'&&!finnhubConfigured()))continue;try{const result=p==='twelve'?await twelveSeries(s,{startDate:from,endDate:to,outputsize:90}):await finnhubSeries(s,{startDate:from,endDate:to,outputsize:90});rows=result.points;source=p==='twelve'?'twelve_data':'finnhub';stickyFallback.set(s,p);break;}catch(e){last=e;}}
    if(!rows) throw new Error(`MARKET_CLOSES_UNAVAILABLE:${s}:${String(last?.message||'no covered fallback')}`);
  }
  return rows.map(r=>metadata(s,{...r,asof:r.asof||r.asOf||`${String(r.date||'').slice(0,10)}T23:59:59Z`},source,{pointInTime:true})).filter(r=>r.asof>=String(from||'')&&r.asof.slice(0,10)<=String(to||'9999-12-31'));
}
export async function benchmark(symbol,window){
  const s=canon(symbol); const w=typeof window==='string'?window:JSON.stringify(window||{});
  let data,source;
  try{data=await primary('benchmark',{symbol:s,window:w});source=data.source||'licensed_market_feed';}
  catch{
    const points=await closes(s,typeof window==='object'?window.from:null,typeof window==='object'?window.to:null);
    if(points.length<2) throw new Error(`BENCHMARK_UNAVAILABLE:${s}`);
    data={price:points.at(-1).price,asof:points.at(-1).asof,exchange:points.at(-1).exchange,delay_class:points.at(-1).delay_class,license_id:points.at(-1).license_id,relative_return:null}; source=points.at(-1).source;
  }
  return {...metadata(s,data,source,{pointInTime:true}),relative_return:Number.isFinite(Number(data.relative_return??data.relativeReturn))?Number(data.relative_return??data.relativeReturn):null};
}
export async function universe(){
  try{const d=await primary('universe');return Array.isArray(d)?d:(d.instruments||d.universe||[]);}
  catch{return [];}
}
export async function marketQuotes(symbols,options={}){
  const list=[...new Set((symbols||[]).map(canon).filter(Boolean))]; const values=[],errors=[];
  for(const s of list){try{values.push(await quote(s,options));}catch(e){errors.push({symbol:s,error:String(e.message||e)});}}
  if(!values.length&&errors.some(e=>/MARKET_REFRESH_WALL/.test(e.error))) throw new Error('MARKET_REFRESH_WALL');
  if(!values.length&&errors.length) throw new Error(`MARKET_QUOTES_UNAVAILABLE:${errors[0].symbol}`);
  return {quotes:values,errors,meta:{cacheTtlMs:CACHE_TTL_MS,primaryConfigured:licensedMarketConfigured(),stickyFallback:Object.fromEntries(stickyFallback)}};
}
export function clearMarketTruthCache(){quotes.clear();inflight.clear();stickyFallback.clear();}
