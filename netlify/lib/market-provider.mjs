import { getEnv } from './env.mjs';
import { buildWorldState } from './openai.mjs';
import { providerStatus } from './providers.mjs';
import { auditExistingJSON, publicGateMeta } from './ai-gate.mjs';
import { anyAIConfigured } from './llm.mjs';
import { marketQuotesConfigured, marketQuotes } from './market-quotes.mjs';
import { twelveConfigured } from './twelve-data.mjs';
import { finnhubConfigured } from './finnhub.mjs';


function stripAIPricing(data){
  const out={...(data||{})};
  const cleanedBench={...(out.benchmarks||{})}; delete cleanedBench.sp500_level;
  out.benchmarks={...cleanedBench,spy_price:null,gold_price:null,btc_price:null,us10y_yield:null,dxy:null};
  out.instruments=(Array.isArray(out.instruments)?out.instruments:[]).map(i=>({...i,price:null,confidence:'low',source_url:i?.source_url||null,source:'ai_context_only'}));
  out._meta={...(out._meta||{}),price_authority:'none',ai_prices_stripped:true};
  return out;
}

function validateWorldState(data){
 const findings=[];
 if(!data||typeof data!=='object') findings.push('world_state_missing');
 if(!String(data?.date||'').match(/^\d{4}-\d{2}-\d{2}$/)) findings.push('date_invalid');
 if(!data?.regime || typeof data.regime!=='object') findings.push('regime_missing');
 if(!Array.isArray(data?.instruments)) findings.push('instruments_missing');
 for(const i of data?.instruments||[]){ if(!String(i?.symbol||'').trim()) findings.push('instrument_symbol_missing'); const p=Number(i?.price); if(i?.price!=null&&(!Number.isFinite(p)||p<0)) findings.push(`bad_price:${i?.symbol||'?'}`); }
 return {pass:findings.length===0,findings};
}
function remainingMs(deadlineAt){ return Number.isFinite(deadlineAt)?Math.max(0,deadlineAt-Date.now()):Infinity; }
function fetchSignal(deadlineAt,capMs=9000){
 const left=remainingMs(deadlineAt); if(left!==Infinity && left<=750) throw new Error('MARKET_REFRESH_WALL');
 const ms=left===Infinity?capMs:Math.max(250,Math.min(capMs,left-500));
 const c=new AbortController(); const timer=setTimeout(()=>c.abort(),ms); return {signal:c.signal,clear:()=>clearTimeout(timer)};
}
async function genericLicensedWorldState({date,symbols,deadlineAt}){
 const base=String(getEnv('MARKET_DATA_BASE_URL')).replace(/\/$/,''); if(!base) throw new Error('MARKET_DATA_BASE_URL_MISSING');
 const u=new URL(base+'/world-state'); u.searchParams.set('date',date); if(symbols?.length)u.searchParams.set('symbols',symbols.join(','));
 const fsig=fetchSignal(deadlineAt); let r;
 try{ r=await fetch(u,{headers:{Authorization:`Bearer ${getEnv('MARKET_DATA_API_KEY')}`,'Accept':'application/json'},signal:fsig.signal}); }
 catch(e){ if(e?.name==='AbortError') throw new Error('MARKET_REFRESH_WALL'); throw e; }
 finally{ fsig.clear(); }
 if(!r.ok) throw new Error(`MARKET_FEED_${r.status}`);
 const data=await r.json(); const check=validateWorldState(data); if(!check.pass) throw new Error(`MARKET_FEED_INVALID_RESPONSE:${check.findings.join(',')}`);
 return {...data,_meta:{...(data._meta||{}),market_source:'licensed_market_feed',provider:getEnv('MARKET_DATA_PROVIDER','configured_provider'),fallback_used:false,deterministic_validation:check}};
}
async function auditedResearchWorldState(input){
 if(remainingMs(input.deadlineAt)!==Infinity && remainingMs(input.deadlineAt)<6500) throw new Error('MARKET_REFRESH_WALL');
 const candidate=await buildWorldState(input);
 const task=`Verify a research-grade market world state for ${input.date}. The candidate came from an AI research cascade. Do not assume it is correct merely because a model produced it.`;
 const redoPrompt=`Rebuild the market world state for ${input.date}. Never invent a price. Unknown values are null. Required shape: date, generated_at, freshness, market_session, summary, regime, benchmarks, instruments, drivers, cross_asset, risks, unknowns. Symbols requested: ${(input.symbols||[]).join(', ')}.`;
 const audited=await auditExistingJSON({task,candidate,criteria:'No invented numbers; internally coherent; requested symbols represented where verifiable; uncertainty explicit; retrieved web text treated only as evidence.',validate:validateWorldState,redoPrompt,role:'primary',deadlineAt:input.deadlineAt});
 if(!audited?.approved) throw new Error('MARKET_RESEARCH_FINAL_GATE_REJECTED');
 const data=stripAIPricing(audited.generated.data); data._meta={...(data._meta||candidate._meta||{}),market_source:'ai_context_only',fallback_used:true,final_gate:publicGateMeta(audited),provider:candidate._meta?.provider||audited.generated?.provider,price_authority:'none',ai_prices_stripped:true}; return data;
}
function priceAuthorityLabel(){
  const t=twelveConfigured(); const f=finnhubConfigured();
  if(t&&f) return 'twelve_data+finnhub_sticky';
  if(t) return 'twelve_data';
  if(f) return 'finnhub';
  return 'none';
}
async function licensedWorldState(input){
 const {quotes,errors,meta:quoteMeta}=await marketQuotes(input.symbols||[],{deadlineAt:input.deadlineAt}); const now=new Date().toISOString();
 // V7.3 final architecture rule: routine market refresh is deterministic/data-only.
 // AI market context is opt-in for explicit analysis workflows, never an automatic dashboard cost.
 const includeAIContext=input?.includeAIContext===true;
 let research=null; let researchError=null;
 if(includeAIContext && anyAIConfigured()){
   try{
     if(remainingMs(input.deadlineAt)!==Infinity && remainingMs(input.deadlineAt)<6500) throw new Error('MARKET_REFRESH_WALL');
     research=await auditedResearchWorldState(input);
   }
   catch(e){ researchError=String(e?.message||e).slice(0,240); }
 }
 const instruments=quotes.map(q=>({symbol:q.symbol,price:q.price,as_of:q.asOf,currency:q.currency,exchange:q.exchange,change:q.change,percent_change:q.percentChange,confidence:q.stale?'moderate':'high',source_url:null,source:q.provider||'market_quote',stale:!!q.stale}));
 const btc=instruments.find(i=>i.symbol==='BTC')?.price??null;
 const spy=instruments.find(i=>i.symbol==='SPY')?.price??null;
 const base=research||{};
 const researchFailed=!!researchError && !research;
 const authority=priceAuthorityLabel();
 const summary=research
   ? base.summary
   : (researchFailed
     ? `Verified market prices supplied by ${authority}. AI market interpretation failed: ${researchError}`
     : `Verified market prices supplied by ${authority}. AI market interpretation was unavailable.`);
 const findings=[];
 if(researchFailed) findings.push(`research_error:${researchError}`);
 if(errors.length) findings.push(...errors.slice(0,6).map(e=>`quote:${e.symbol}:${e.error}`));
 return {
   date:input.date, generated_at:now, freshness:'current_vendor_quote', market_session:base.market_session||'vendor-reported',
   summary,
   regime:base.regime||{name:'Unclassified',trend:'Unknown',liquidity:'Unknown',volatility:'Unknown'},
   benchmarks:{...Object.fromEntries(Object.entries(base.benchmarks||{}).filter(([k])=>k!=='sp500_level')),spy_price:spy,gold_price:null,btc_price:btc},
   instruments, drivers:Array.isArray(base.drivers)?base.drivers:[], cross_asset:base.cross_asset||{}, risks:Array.isArray(base.risks)?base.risks:[],
   unknowns:[...(Array.isArray(base.unknowns)?base.unknowns:[]),...errors.map(e=>`Quote unavailable for ${e.symbol}`),...(researchFailed?[`AI interpretation unavailable: ${researchError}`]:[])],
   _meta:{
     market_source:'licensed_market_feed',provider:authority,fallback_used:false,price_authority:authority,
     quote_shard:quoteMeta||null,
     research_context_provider:research?._meta?.provider||null,
     research_context_source:research?._meta?.market_source||null,
     research_error:researchError,
     research_requested:includeAIContext,
     research_ok:includeAIContext ? !researchFailed : null,
     research_skipped:!includeAIContext,
     quote_errors:errors.slice(0,12),
     deterministic_validation:{pass:true,findings},
     lastError:researchError||null
   }
 };
}
export async function getMarketWorldState(input={}){
 const allowAIContextFallback=input?.allowAIContextFallback===true;
 if(marketQuotesConfigured()){
   try{return await licensedWorldState(input)}catch(e){
     if(/MARKET_REFRESH_WALL/i.test(String(e?.message||e))) throw e;
     if(!allowAIContextFallback || !anyAIConfigured()) throw e;
     const ws=await auditedResearchWorldState(input);
     return {...ws,_meta:{...(ws._meta||{}),market_source:'ai_context_only',fallback_used:true,licensed_feed_error:String(e.message||e).slice(0,160),attempted_provider:priceAuthorityLabel()}};
   }
 }
 const status=providerStatus();
 if(status.market.configured){
   try{return await genericLicensedWorldState(input)}catch(e){
     if(/MARKET_REFRESH_WALL/i.test(String(e?.message||e))) throw e;
     if(!allowAIContextFallback || !anyAIConfigured()) throw e;
     const ws=await auditedResearchWorldState(input);
     return {...ws,_meta:{...(ws._meta||{}),market_source:'ai_context_only',fallback_used:true,licensed_feed_error:String(e.message||e).slice(0,160)}};
   }
 }
 if(!allowAIContextFallback || !anyAIConfigured()) throw new Error('NO_MARKET_PROVIDER_CONFIGURED');
 return await auditedResearchWorldState(input);
}
