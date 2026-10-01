function norm(v){ return String(v||'').trim().toUpperCase(); }
function ageHours(iso){ const t=Date.parse(iso||''); return Number.isFinite(t)?Math.max(0,(Date.now()-t)/3600000):Infinity; }
function hostOf(url){ try{return new URL(String(url||'')).hostname.toLowerCase();}catch{return null;} }
function uniqueHosts(assetEvidence){
  const urls=[];
  for(const f of assetEvidence?.fundamentals_or_network?.facts||[]) if(f?.source_url) urls.push(f.source_url);
  for(const e of assetEvidence?.events||[]) if(e?.source_url) urls.push(e.source_url);
  for(const h of assetEvidence?.historical_context||[]) if(h?.source_url) urls.push(h.source_url);
  for(const c of assetEvidence?._meta?.citations||[]) if(c?.url) urls.push(c.url);
  return [...new Set(urls.map(hostOf).filter(Boolean))];
}
function authoritativeInstrument(worldState,assetEvidence){
  const sym=norm(assetEvidence?.asset);
  return (worldState?.instruments||[]).find(i=>norm(i?.symbol)===sym)||null;
}
function deterministicSourceQuality(worldState,assetEvidence){
  const inst=authoritativeInstrument(worldState,assetEvidence);
  const authority=String(worldState?._meta?.price_authority||worldState?._meta?.provider||'none').toLowerCase();
  const licensed=/twelve|finnhub|licensed/.test(authority) && authority!=='none';
  const stale=inst?.stale===true;
  const quoteOk=Number.isFinite(Number(inst?.price)) && Number(inst?.price)>0;
  const hosts=uniqueHosts(assetEvidence);
  if(!licensed || !quoteOk || stale) return {quality:'low',hosts,authority,quoteOk,stale};
  if(hosts.length>=2) return {quality:'high',hosts,authority,quoteOk,stale};
  return {quality:'moderate',hosts,authority,quoteOk,stale};
}
function deterministicFreshness(worldState,assetEvidence){
  const inst=authoritativeInstrument(worldState,assetEvidence);
  const asOf=inst?.as_of||inst?.asOf||assetEvidence?.market?.price_as_of||null;
  const age=ageHours(asOf);
  const staleFlag=inst?.stale===true;
  if(!staleFlag && age<=2) return {freshness:'FRESH',ageHours:age,asOf,staleFlag};
  if(!staleFlag && age<=12) return {freshness:'AGING',ageHours:age,asOf,staleFlag};
  return {freshness:'STALE',ageHours:age,asOf,staleFlag};
}

export function deriveDecisionConviction({worldState,assetEvidence,specialists=[],attacks={},finalGate,final,availableProviders=[]}={}){
  let score=0;
  const reasons=[];

  const fresh=deterministicFreshness(worldState,assetEvidence);
  if(fresh.freshness==='FRESH'){ score+=2; reasons.push('fresh_vendor_quote'); }
  else if(fresh.freshness==='AGING'){ score+=1; reasons.push('aging_vendor_quote'); }
  else reasons.push('stale_or_missing_vendor_quote');

  const src=deterministicSourceQuality(worldState,assetEvidence);
  if(src.quality==='high'){ score+=2; reasons.push('deterministic_high_source_quality'); }
  else if(src.quality==='moderate'){ score+=1; reasons.push('deterministic_moderate_source_quality'); }
  else reasons.push('deterministic_low_source_quality');

  const attackRows=Object.values(attacks||{});
  const attacksPass=attackRows.length>0 && attackRows.every(a=>a?.pass===true);
  if(attacksPass){ score+=2; reasons.push('all_attacks_passed'); }
  else reasons.push('attack_disagreement_or_failure');

  const stances=(specialists||[]).map(s=>norm(s?.recommended_stance)).filter(Boolean);
  const counts=new Map();
  for(const s of stances) counts.set(s,(counts.get(s)||0)+1);
  const maxAgreement=Math.max(0,...counts.values());
  const agreement=maxAgreement>=3?'STRONG':maxAgreement>=2?'MIXED':'LOW';
  if(maxAgreement>=3){ score+=2; reasons.push('specialists_strongly_agree'); }
  else if(maxAgreement>=2){ score+=1; reasons.push('specialists_partially_agree'); }
  else reasons.push('specialists_disagree');

  const providerFamilies=[...new Set((specialists||[]).map(s=>String(s?._meta?.provider||'').toLowerCase()).filter(Boolean))];
  const configured=[...new Set((availableProviders||[]).map(x=>String(x||'').toLowerCase()).filter(Boolean))];
  const providerDiversityPass=configured.length<2 ? false : providerFamilies.length>=2;
  if(providerDiversityPass) reasons.push('independent_provider_diversity');
  else reasons.push(configured.length<2?'single_provider_environment':'provider_diversity_insufficient');

  const unknowns=[...(assetEvidence?.unknowns||[]),...(assetEvidence?.fundamentals_or_network?.unknowns||[])].filter(Boolean);
  if(unknowns.length<=2){ score+=1; reasons.push('limited_unknowns'); }
  else if(unknowns.length>=6) reasons.push('many_unknowns');

  if(finalGate?.approved===true){ score+=1; reasons.push('final_gate_approved'); }
  else reasons.push('final_gate_not_approved');

  let conviction=score>=8?'HIGH':score>=5?'MODERATE':'LOW';
  if(!attacksPass || finalGate?.approved!==true || fresh.freshness==='STALE' || src.quality==='low') conviction='LOW';
  // A cross-model financial council without at least two independent providers can still inform,
  // but may never claim strong conviction or drive an actionable trade recommendation.
  if(!providerDiversityPass) conviction='LOW';
  if(['ABSTAIN','NO_ACTION','WATCH'].includes(norm(final?.status)) && conviction==='HIGH') conviction='MODERATE';

  return {
    conviction,
    score,
    maxScore:10,
    freshness:fresh.freshness,
    quoteAgeHours:Number.isFinite(fresh.ageHours)?Math.round(fresh.ageHours*100)/100:null,
    quoteAsOf:fresh.asOf||null,
    quoteStaleFlag:fresh.staleFlag,
    sourceQuality:src.quality.toUpperCase(),
    sourceAuthority:src.authority,
    independentSourceHosts:src.hosts,
    modelAgreement:agreement,
    specialistStances:stances,
    providerFamilies,
    availableProviders:configured,
    providerDiversityPass,
    unknownCount:unknowns.length,
    attacksPass,
    actionablePriceVerified:src.quoteOk && !src.stale && fresh.freshness!=='STALE',
    reasons
  };
}
