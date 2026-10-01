import { getEnv } from './env.mjs';
import { anyAIConfigured } from './llm.mjs';
import { getJSON, setJSON } from './store.mjs';
import { twelveConfigured, twelveSeriesBundle } from './twelve-data.mjs';
import { finnhubConfigured, finnhubSeriesBundle } from './finnhub.mjs';
import { symbolShard } from './market-quotes.mjs';

// Local copy avoids circular import with market-universe.mjs — keep in sync with INVESTMENT_UNIVERSE symbols.
const UNIVERSE_SYMBOLS=[
  'AAPL','KO','MSFT','AMZN','GOOGL','META','NVDA','TSLA','JPM','XOM',
  'QQQ','SPY','IWM','XLK','XLE','BTC','ETH','VNQ','GLD','SLV','TLT','BIL','LQD','VT','VWO'
];

/** Soft cap so Netlify refresh walls don't kill the whole book when universe grows. */
const SERIES_MAX=Math.max(12,Math.min(40,Number(getEnv('HADES_SERIES_MAX_SYMBOLS',28))));

const KEY='market/research-series';
const MAX_AGE_MS=18*60*60*1000; // refresh ~twice daily

function marketDate(d=new Date()){
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:getEnv('SAURON_MARKET_TIME_ZONE','America/New_York'),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d));
    const get=(type)=>parts.find(p=>p.type===type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }catch{ return new Date().toISOString().slice(0,10); }
}

function normalizePoints(raw){
  if(!Array.isArray(raw)) return [];
  const out=[];
  for(const p of raw){
    const date=String(p?.date||p?.d||'').slice(0,10);
    const price=Number(p?.price??p?.p??p?.close);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if(!Number.isFinite(price)||price<=0) continue;
    out.push({date,price,confidence:p?.confidence||'moderate',source:p?.source||'licensed'});
  }
  out.sort((a,b)=>a.date.localeCompare(b.date));
  const map=new Map();
  for(const p of out) map.set(p.date,p);
  return [...map.values()];
}

function validateBundle(data,symbols){
  if(!data||typeof data!=='object') return {pass:false,findings:['bundle_missing'],ready:0};
  const series=data.series&&typeof data.series==='object'?data.series:{};
  const findings=[];
  let ready=0;
  for(const sym of symbols){
    const pts=normalizePoints(series[sym]||[]);
    if(pts.length>=2) ready++;
    else findings.push(`thin:${sym}`);
  }
  return {pass:ready>=Math.min(4,symbols.length),findings,ready};
}

export async function getResearchSeries(){
  return await getJSON(KEY,null);
}

export async function saveResearchSeries(v){
  await setJSON(KEY,v);
  return v;
}

/**
 * DEPRECATED for chart OHLC — charts use Twelve + Finnhub only (V6).
 * Kept as inert helper; ensureResearchSeries never calls this for price series.
 * LLMs may narrate chart context, but never invent series points.
 */
export async function buildResearchSeries({symbols=UNIVERSE_SYMBOLS,asOf=marketDate(),deadlineAt}={}){
  throw new Error('AI_PRICE_SERIES_DISABLED:Charts use Twelve Data + Finnhub only (V6). LLMs must not invent OHLC.');
}

/**
 * Seed / refresh chart series from licensed market APIs only.
 * Never invents prices with an LLM.
 */
export async function ensureResearchSeries({force=false,maxAgeMs=MAX_AGE_MS,deadlineAt}={}){
  const existing=await getResearchSeries();
  const age=existing?.generatedAt?Date.now()-Date.parse(existing.generatedAt):Infinity;
  const readyCount=existing?.series ? Object.values(existing.series).filter(s=>Array.isArray(s)&&s.length>=2).length : 0;
  const ready=readyCount>=Math.min(4,UNIVERSE_SYMBOLS.length);
  if(!force && ready && Number.isFinite(age) && age<maxAgeMs) return existing;
  if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt) throw new Error('MARKET_REFRESH_WALL');

  const list=UNIVERSE_SYMBOLS.slice(0,SERIES_MAX);
  const licensed = await buildLicensedSeriesBundle(list, deadlineAt);
  if(licensed && (licensed.meta?.readySymbols||0) >= 1){
    // Merge with prior licensed points for symbols we didn't refresh (wall / cap)
    if(existing?.series && existing?.grade==='licensed_market_data'){
      const merged={...licensed, series:{...(existing.series||{}),...(licensed.series||{})}};
      for(const [sym,pts] of Object.entries(licensed.series||{})){
        if(Array.isArray(pts) && pts.length>=2) merged.series[sym]=pts;
      }
      const readyN=Object.values(merged.series).filter(s=>Array.isArray(s)&&s.length>=2).length;
      merged.meta={...(merged.meta||{}),readySymbols:readyN,cappedTo:SERIES_MAX};
      await saveResearchSeries(merged);
      return merged;
    }
    await saveResearchSeries(licensed);
    return licensed;
  }
  if(existing?.series && readyCount>=1) return existing;
  if(!twelveConfigured() && !finnhubConfigured()){
    const empty={
      asOf:marketDate(),
      generatedAt:new Date().toISOString(),
      grade:'unavailable',
      disclaimer:'No Twelve Data / Finnhub keys — chart series unavailable. KAIROS will not invent prices with an LLM.',
      provider:null,
      series:Object.fromEntries(UNIVERSE_SYMBOLS.map(s=>[s,[]])),
      meta:{readySymbols:0,findings:['NO_MARKET_API_KEYS'],market_source:'none',aiConfigured:anyAIConfigured()}
    };
    await saveResearchSeries(empty);
    return empty;
  }
  throw new Error('LICENSED_SERIES_UNAVAILABLE');
}

/** Twelve + Finnhub sticky history: each symbol uses its quote shard primary, failover other. */
async function buildLicensedSeriesBundle(symbols, deadlineAt){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').toUpperCase()).filter(Boolean))];
  if(!twelveConfigured() && !finnhubConfigured()) return null;
  const series={}; const errors=[]; let twelveN=0, finnhubN=0;
  let twelveBundle=null, finnhubBundle=null;
  if(twelveConfigured()){
    try{
      if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt) throw new Error('MARKET_REFRESH_WALL');
      twelveBundle=await twelveSeriesBundle(list,{outputsize:32,deadlineAt});
    }catch(e){
      if(/MARKET_REFRESH_WALL/i.test(String(e.message||e))) throw e;
      errors.push({provider:'twelve',error:String(e.message||e).slice(0,160)});
    }
  }
  const thin=list.filter(s=>!((twelveBundle?.series?.[s]||[]).length>=2));
  if(thin.length && finnhubConfigured()){
    try{
      if(Number.isFinite(deadlineAt) && Date.now()>=deadlineAt) throw new Error('MARKET_REFRESH_WALL');
      finnhubBundle=await finnhubSeriesBundle(thin,{outputsize:32,deadlineAt});
    }catch(e){
      if(/MARKET_REFRESH_WALL/i.test(String(e.message||e))) {
        // keep partial twelve
      } else {
        errors.push({provider:'finnhub',error:String(e.message||e).slice(0,160)});
      }
    }
  }
  for(const s of list){
    const tPts=twelveBundle?.series?.[s]||[];
    const fPts=finnhubBundle?.series?.[s]||[];
    if(tPts.length>=2 && fPts.length>=2){
      const primary=symbolShard(s)===0?'twelve':'finnhub';
      if(primary==='twelve'){ series[s]=tPts; twelveN++; }
      else { series[s]=fPts; finnhubN++; }
    }else if(tPts.length>=2){ series[s]=tPts; twelveN++; }
    else if(fPts.length>=2){ series[s]=fPts; finnhubN++; }
    else { series[s]=[]; }
  }
  const ready=Object.values(series).filter(v=>v.length>=2).length;
  if(!ready) return null;
  const both=twelveConfigured()&&finnhubConfigured();
  return {
    asOf:new Date().toISOString().slice(0,10),
    generatedAt:new Date().toISOString(),
    grade:'licensed_market_data',
    disclaimer:'Price history from Twelve Data + Finnhub sticky shard (per-symbol). LLMs never invent OHLC.',
    provider:both?'twelve_data+finnhub_sticky':(twelveConfigured()?'twelve_data':'finnhub'),
    series,
    meta:{
      readySymbols:ready,
      findings:errors.map(e=>`${e.provider}:${e.error}`).slice(0,12),
      market_source:both?'twelve_data+finnhub_sticky':'licensed',
      stats:{twelve:twelveN,finnhub:finnhubN},
      partial:Number.isFinite(deadlineAt)&&Date.now()>=deadlineAt,
      cappedTo:SERIES_MAX
    }
  };
}

export function seriesForSymbol(bundle,symbol){
  if(!bundle?.series) return [];
  const sym=String(symbol||'').toUpperCase();
  return normalizePoints(bundle.series[sym]||[]);
}

export { UNIVERSE_SYMBOLS as RESEARCH_UNIVERSE_SYMBOLS, SERIES_MAX };
