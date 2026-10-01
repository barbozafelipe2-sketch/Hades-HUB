import { getEnv } from './env.mjs';
/**
 * Sticky market quote shard: Twelve Data + Finnhub.
 * When BOTH keys present: hash(symbol)%2 picks primary; per-symbol failover only
 * (never dump the whole book to the other provider).
 * When only one key: all traffic there.
 * Last-good cache ~45s.
 */
import { twelveConfigured, twelveQuote } from './twelve-data.mjs';
import { finnhubConfigured, finnhubQuote, sleep } from './finnhub.mjs';

const DEFAULT_CONCURRENCY=Math.max(1,Math.min(2,Number(getEnv('HADES_MARKET_QUOTE_CONCURRENCY',2))));
const DEFAULT_GAP_MS=Math.max(250,Math.min(400,Number(getEnv('HADES_MARKET_QUOTE_GAP_MS',300))));
const CACHE_TTL_MS=Math.max(15000,Math.min(60000,Number(getEnv('HADES_QUOTE_CACHE_TTL_MS',45000))));

const lastGood=new Map(); // symbol → {quote, at}

export function marketQuotesConfigured(){
  return twelveConfigured()||finnhubConfigured();
}

/** Stable FNV-ish hash → 0 | 1. 0=twelve, 1=finnhub when both present. */
export function symbolShard(symbol){
  const s=String(symbol||'').trim().toUpperCase();
  let h=2166136261;
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0)%2;
}

export function primaryProviderForSymbol(symbol){
  const t=twelveConfigured();
  const f=finnhubConfigured();
  if(t&&f) return symbolShard(symbol)===0?'twelve':'finnhub';
  if(t) return 'twelve';
  if(f) return 'finnhub';
  return null;
}

function cacheGet(symbol){
  const hit=lastGood.get(String(symbol||'').toUpperCase());
  if(!hit) return null;
  if(Date.now()-hit.at>CACHE_TTL_MS) return null;
  return hit.quote;
}
function cacheSet(quote){
  if(!quote?.symbol||!(quote.price>0)) return;
  lastGood.set(String(quote.symbol).toUpperCase(),{quote,at:Date.now()});
}

function remaining(deadlineAt){ return Number.isFinite(deadlineAt)?Math.max(0,deadlineAt-Date.now()):Infinity; }
function quoteTimeout(deadlineAt){
  const left=remaining(deadlineAt);
  if(left!==Infinity && left<=750) throw new Error('MARKET_REFRESH_WALL');
  return left===Infinity?9000:Math.max(250,Math.min(9000,left-500));
}

async function fetchFrom(provider,symbol,{deadlineAt}={}){
  const timeoutMs=quoteTimeout(deadlineAt);
  if(provider==='twelve'){
    const q=await twelveQuote(symbol,{timeoutMs});
    return {...q,provider:'twelve_data'};
  }
  if(provider==='finnhub'){
    return await finnhubQuote(symbol,{timeoutMs});
  }
  throw new Error('NO_MARKET_QUOTE_PROVIDER');
}

/**
 * One symbol: sticky primary, fail over to the other only for THIS symbol.
 * Falls back to last-good cache on total failure.
 */
export async function marketQuote(symbol,{deadlineAt}={}){
  const requested=String(symbol||'').toUpperCase();
  const primary=primaryProviderForSymbol(requested);
  if(!primary) throw new Error('NO_MARKET_QUOTE_PROVIDER');
  const secondary=primary==='twelve'
    ?(finnhubConfigured()?'finnhub':null)
    :(twelveConfigured()?'twelve':null);
  const order=[primary,secondary].filter(Boolean);
  const errors=[];
  for(const p of order){
    if(remaining(deadlineAt)!==Infinity && remaining(deadlineAt)<=750) break;
    try{
      const q=await fetchFrom(p,requested,{deadlineAt});
      cacheSet(q);
      return q;
    }catch(e){
      errors.push({provider:p,error:String(e.message||e).slice(0,160)});
    }
  }
  const cached=cacheGet(requested);
  if(cached) return {...cached,stale:true,cacheHit:true,failoverErrors:errors};
  throw new Error(`MARKET_QUOTE_FAILED:${requested}:${errors.map(e=>`${e.provider}:${e.error}`).join('|')}`);
}

/**
 * Batch quotes with low concurrency + inter-batch gap.
 * Sticky per symbol — never whole-book failover.
 */
export async function marketQuotes(symbols,{concurrency=DEFAULT_CONCURRENCY,batchGapMs=DEFAULT_GAP_MS,deadlineAt}={}){
  const list=[...new Set((symbols||[]).map(s=>String(s||'').toUpperCase()).filter(Boolean))];
  const out=[]; const errors=[];
  const conc=Math.max(1,Math.min(2,Number(concurrency)||2));
  const gap=Math.max(250,Math.min(400,Number(batchGapMs)||300));
  const shardStats={twelve:0,finnhub:0,cache:0,failover:0};
  for(let i=0;i<list.length;i+=conc){
    if(remaining(deadlineAt)!==Infinity && remaining(deadlineAt)<=750){ errors.push({symbol:'_wall',error:'MARKET_REFRESH_WALL',primary:null}); break; }
    if(i>0){
      const left=remaining(deadlineAt);
      if(left!==Infinity && left<=gap+750){ errors.push({symbol:'_wall',error:'MARKET_REFRESH_WALL',primary:null}); break; }
      await sleep(gap);
    }
    const batch=list.slice(i,i+conc);
    const rows=await Promise.all(batch.map(async s=>{
      try{
        const q=await marketQuote(s,{deadlineAt});
        if(q.cacheHit) shardStats.cache++;
        else if(q.provider==='finnhub') shardStats.finnhub++;
        else shardStats.twelve++;
        if(q.failoverErrors?.length) shardStats.failover++;
        return q;
      }catch(e){
        errors.push({symbol:s,error:String(e.message||e).slice(0,180),primary:primaryProviderForSymbol(s)});
        return null;
      }
    }));
    out.push(...rows.filter(Boolean));
  }
  if(!out.length){
    if(errors.some(e=>e.error==='MARKET_REFRESH_WALL')) throw new Error('MARKET_REFRESH_WALL');
    throw new Error(`MARKET_QUOTES_FAILED:${errors.slice(0,3).map(e=>e.error).join('|')}`);
  }
  return {quotes:out,errors,meta:{shard:'sticky_hash_mod2',throttle:{concurrency:conc,batchGapMs:gap},cacheTtlMs:CACHE_TTL_MS,stats:shardStats,providers:{twelve:twelveConfigured(),finnhub:finnhubConfigured()}}};
}

/** Test helper — clear in-memory last-good cache. */
export function clearQuoteCache(){ lastGood.clear(); }
