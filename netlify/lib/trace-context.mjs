import { getEnv } from './env.mjs';

/**
 * Historical context is supplied by the owner's licensed, point-in-time source.
 * This module validates provenance and timestamps; it does not infer market
 * causality or manufacture observations.
 */
export const TRACE_FACTOR_CATALOG=Object.freeze([
  {code:'policy_rates',category:'monetary_policy',label:'Policy rates'},
  {code:'sovereign_yields',category:'monetary_policy',label:'Sovereign yields'},
  {code:'inflation',category:'prices',label:'Inflation'},
  {code:'labor_market',category:'labor',label:'Labor market'},
  {code:'growth_activity',category:'growth',label:'Growth and activity'},
  {code:'consumer_demand',category:'growth',label:'Consumer demand'},
  {code:'credit_conditions',category:'credit',label:'Credit conditions'},
  {code:'financial_stress',category:'credit',label:'Financial stress'},
  {code:'currency_fx',category:'markets',label:'Currency and FX'},
  {code:'energy_supply',category:'commodities',label:'Energy supply'},
  {code:'industrial_commodities',category:'commodities',label:'Industrial commodities'},
  {code:'food_commodities',category:'commodities',label:'Food commodities'},
  {code:'trade_flows',category:'trade',label:'Trade flows'},
  {code:'supply_chain_disruption',category:'trade',label:'Supply chain disruption'},
  {code:'shipping_disruption',category:'geopolitics',label:'Shipping disruption'},
  {code:'armed_conflict',category:'geopolitics',label:'Armed conflict'},
  {code:'sanctions_controls',category:'geopolitics',label:'Sanctions and export controls'},
  {code:'election_policy',category:'geopolitics',label:'Election and policy transition'},
  {code:'fiscal_policy',category:'public_finance',label:'Fiscal policy'},
  {code:'regulatory_policy',category:'public_policy',label:'Regulatory policy'},
  {code:'public_health',category:'public_health',label:'Public health'},
  {code:'climate_disaster',category:'climate',label:'Climate and disaster disruption'}
]);

const CATALOG_BY_CODE=new Map(TRACE_FACTOR_CATALOG.map(x=>[x.code,x]));
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const cache=new Map();
const inflight=new Map();
const CACHE_TTL_MS=60_000;
const MAX_FACTORS=160;
const MAX_EVENTS=120;

function unavailable(asOf,reason='source_not_configured'){
  return {status:'UNAVAILABLE',as_of:asOf,cutoff:`${asOf}T23:59:59.999Z`,reason,factors:[],events:[],coverage:[]};
}
function validDate(value){ return typeof value==='string'&&!Number.isNaN(Date.parse(value)); }
function safeSourceUrl(value){
  try{ const u=new URL(String(value||'')); return u.protocol==='https:'?u.toString():null; }
  catch{ return null; }
}
function atOrBefore(value,cutoff){ return validDate(value)&&Date.parse(value)<=Date.parse(cutoff); }
function cleanText(value,max=400){
  const text=String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  return text?text.slice(0,max):null;
}
function validateRows(payload,asOf,licenseId){
  const cutoff=`${asOf}T23:59:59.999Z`;
  const factors=[]; const events=[]; let rejected=0;
  for(const row of (Array.isArray(payload?.factors)?payload.factors:[]).slice(0,MAX_FACTORS)){
    const catalog=CATALOG_BY_CODE.get(String(row?.factor_code||''));
    const value=Number(row?.value); const source=cleanText(row?.source,120); const url=safeSourceUrl(row?.source_url);
    const published=String(row?.published_at||''); const available=String(row?.available_at||'');
    if(!catalog||!Number.isFinite(value)||!source||!url||row?.license_id!==licenseId||row?.point_in_time!==true||
      !atOrBefore(published,cutoff)||!atOrBefore(available,cutoff)||!atOrBefore(row?.observed_at,cutoff)) { rejected++; continue; }
    factors.push({factor_code:catalog.code,category:catalog.category,label:catalog.label,value,unit:cleanText(row.unit,40),period:cleanText(row.period,80),
      observed_at:String(row.observed_at),published_at:published,available_at:available,source,source_url:url,license_id:licenseId,
      point_in_time:true,revision_id:cleanText(row.revision_id,100)});
  }
  for(const row of (Array.isArray(payload?.events)?payload.events:[]).slice(0,MAX_EVENTS)){
    const title=cleanText(row?.title,220); const category=cleanText(row?.category,60); const source=cleanText(row?.source,120);
    const url=safeSourceUrl(row?.source_url); const published=String(row?.published_at||''); const available=String(row?.available_at||'');
    const occurred=String(row?.occurred_at||'');
    if(!title||!category||!source||!url||row?.license_id!==licenseId||row?.point_in_time!==true||
      !atOrBefore(published,cutoff)||!atOrBefore(available,cutoff)||!atOrBefore(occurred,cutoff)) { rejected++; continue; }
    events.push({event_id:cleanText(row.event_id,100),title,summary:cleanText(row.summary,700),category,
      regions:Array.isArray(row.regions)?row.regions.map(x=>cleanText(x,60)).filter(Boolean).slice(0,12):[],occurred_at:occurred,
      published_at:published,available_at:available,source,source_url:url,license_id:licenseId,point_in_time:true});
  }
  const coverage=[...new Set([...factors.map(x=>x.category),...events.map(x=>`event:${x.category}`)])].sort();
  return {status:factors.length||events.length?'AVAILABLE':'UNAVAILABLE',as_of:asOf,cutoff,
    reason:factors.length||events.length?null:(rejected?'no_rows_passed_provenance_and_lookahead_checks':'source_returned_no_context'),
    factors,events,coverage,rejected_rows:rejected,source_kind:'owner_licensed_point_in_time_context'};
}

export async function getHistoricalTraceContext(asOf){
  const date=String(asOf||'').slice(0,10);
  if(!ISO_DATE.test(date)||Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return unavailable(date,'invalid_as_of_date');
  const base=String(getEnv('KAIROS_TRACE_CONTEXT_BASE_URL','')||'').trim();
  const apiKey=String(getEnv('KAIROS_TRACE_CONTEXT_API_KEY','')||'').trim();
  const licenseId=String(getEnv('KAIROS_TRACE_CONTEXT_LICENSE_ID','')||'').trim();
  if(!base||!apiKey||!licenseId) return unavailable(date);
  const key=`${base}|${licenseId}|${date}`; const now=Date.now();
  const prior=cache.get(key); if(prior&&now-prior.at<CACHE_TTL_MS) return prior.value;
  if(inflight.has(key)) return inflight.get(key);
  const work=(async()=>{
    try{
      const endpoint=new URL('trace-context',base.endsWith('/')?base:`${base}/`); endpoint.searchParams.set('as_of',date);
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Math.max(1200,Math.min(5000,Number(getEnv('KAIROS_TRACE_CONTEXT_TIMEOUT_MS','3500'))||3500)));
      let response;
      try{ response=await fetch(endpoint,{headers:{'accept':'application/json','x-api-key':apiKey},signal:controller.signal}); }
      finally{ clearTimeout(timer); }
      if(!response.ok) return unavailable(date,`source_http_${response.status}`);
      const payload=await response.json();
      if(payload?.as_of!==date) return unavailable(date,'source_as_of_mismatch');
      const result=validateRows(payload,date,licenseId);
      cache.set(key,{at:Date.now(),value:result}); return result;
    }catch(e){ return unavailable(date,e?.name==='AbortError'?'source_timeout':'source_unavailable'); }
    finally{ inflight.delete(key); }
  })();
  inflight.set(key,work); return work;
}

export function resetTraceContextCacheForTests(){ cache.clear(); inflight.clear(); }
