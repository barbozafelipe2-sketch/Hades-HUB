const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
let state=null, currentSection='home', perfRange='1Y', decisionRange='all', selectedAsset=null, marketUniverse=[], selectedMarketId='nasdaq', mirrorFocus='all', brokerTradeSide='BUY', insightPane='queue', brokerSearch='', brokerCategory='ALL';
let cryptoCatalogMeta={total:0,offset:0,limit:100,hasMore:false,provider:null,stale:false}; let cryptoCatalogLoading=false; let cryptoSearchTimer=null;

async function api(path,options={}){
  const timeoutMs=Number(options.timeoutMs??20000);
  const {timeoutMs:_drop,...rest}=options;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const opts={...rest,credentials:'include',signal:ctrl.signal,headers:{'content-type':'application/json',...(rest.headers||{})}};
    const r=await fetch(`/.netlify/functions/${path}`,opts);
    let data={}; try{data=await r.json();}catch{}
    if(r.status===401){ showLogin(); throw new Error('UNAUTHORIZED'); }
    if(!r.ok){
      const nested=data?.error?.message||data?.message||data?.error||data?.answer;
      let msg=typeof nested==='string'?nested:`HTTP ${r.status}`;
      if((r.status===504||r.status===502) && /ai-chat|chat/i.test(path)) msg=data?.answer||'AI Gateway timed out — retry, then check System Health / Netlify AI credits';
      if((r.status===504||r.status===502) && /ai-mirror/i.test(path)) msg=data?.message||data?.error||'AI Mirror timed out — retry, then check Netlify AI Gateway health/credits';
      if(r.status===404 && /ai-chat/i.test(path) && (!data?.error || data?.error==='Not Found')) msg='AI Gateway timed out — retry, then check System Health / Netlify AI credits (function may have been killed before JSON returned)';
      if(r.status===404 && /ai-mirror/i.test(path) && (!data?.error || data?.error==='Not Found')) msg='AI Mirror timed out — retry, then check Netlify AI Gateway health/credits (function may have been killed before JSON returned)';
      throw new Error(msg);
    }
    return data;
  }catch(e){
    if(e?.name==='AbortError') throw new Error('Request timed out');
    throw e;
  }finally{ clearTimeout(timer); }
}
function esc(v=''){return String(v).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}
function safeHttpUrl(v=''){try{const u=new URL(String(v));return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function money(v){const n=Number(v||0); const c=state?.profile?.baseCurrency||'USD'; return new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:Math.abs(n)>999?0:2}).format(n);}
function pct(v,d=2){if(v==null||v===''||Number.isNaN(Number(v))) return '—'; const n=Number(v); if(!Number.isFinite(n)) return '—'; const x=n*100; return `${x>0?'+':''}${x.toFixed(d)}%`;}
function dateLabel(s){ if(!s) return 'Not yet'; const d=new Date(s); return isNaN(d)?s:d.toLocaleString(); }
function friendlyError(msg){
  const m=String(msg||'');
  if(/TRIAL_EXPIRED/i.test(m)) return 'Your KAIROS trial has ended. Open Settings → Subscription & Usage to activate access.';
  if(/SUBSCRIPTION_REQUIRED/i.test(m)) return 'An active KAIROS subscription is required for this action. Open Settings → Subscription & Usage.';
  if(/USAGE_BUDGET_EXCEEDED/i.test(m)) return 'This workspace reached its monthly AI usage limit. Your paper data remains available; AI workflows resume when the limit resets or the plan changes.';
  if(/PRIVATE_OWNER_DELETE_BLOCKED/i.test(m)) return 'The original private owner workspace is protected from self-service deletion.';
  if(/DELETION_CONFIRMATION_REQUIRED/i.test(m)) return 'Deletion confirmation phrase did not match.';
  if(/STRIPE_CANCELLATION_FAILED/i.test(m)) return 'KAIROS could not confirm subscription cancellation, so no workspace purge was performed. Try again or contact support.';
  if(/COMMERCIAL_RELEASE_GATE_CLOSED/i.test(m)) return 'Public signup is still locked by the KAIROS commercial release gate.';
  if(/FRESH_MARK_REQUIRED/i.test(m)) return 'Refresh market prices before placing a Market order. KAIROS will not execute against a stale mark.';
  if(/INSUFFICIENT_TRACKED_CASH|INSUFFICIENT_BUYING_POWER/i.test(m)) return 'Not enough simulated buying power for this order.';
  if(/SELL_EXCEEDS_POSITION|INSUFFICIENT_HOLDINGS_FOR_ORDER/i.test(m)) return 'That sell exceeds the shares currently available in Wallet Mirror.';
  if(/ORDER_NOT_OPEN/i.test(m)) return 'That paper order is no longer open.';
  if(/ORDER_NOT_FOUND/i.test(m)) return 'Paper order not found. Refresh the Broker and try again.';
  if(/QUANTITY_REQUIRED/i.test(m)) return 'Enter a quantity greater than zero.';
  if(/LIMIT_PRICE_REQUIRED/i.test(m)) return 'Enter a limit price for this order.';
  if(/STOP_PRICE_REQUIRED/i.test(m)) return 'Enter a stop price for this order.';
  if(/INVALID_MARKET_ORDER|INVALID_ORDER_SIDE|INVALID_ORDER_TYPE/i.test(m)) return 'Review the order ticket. One or more order fields are invalid.';
  if(/AI_MIRROR_TIMEOUT/i.test(m) || /AI Mirror timed out/i.test(m)) return 'AI Mirror timed out — retry, then check Netlify AI Gateway health/credits';
  if(/HTTP\s*504|\b504\b|Gateway Timeout/i.test(m)) return 'AI request timed out — retry, then check Netlify AI Gateway health/credits if it persists. KAIROS uses bounded multi-provider fallback and hard deadlines.';
  if(/Providers timed out|providers timed out/i.test(m)) return m;
  // Prefer real lastError (model/billing/400) over generic "timed out" when ALL_PROVIDERS_FAILED embeds them
  if(/ALL_PROVIDERS_FAILED/i.test(m)){
    console.error('[KAIROS] ALL_PROVIDERS_FAILED', m);
    if(/MODEL_NOT_FOUND/i.test(m)) return 'AI model route not available through the Gateway. Detail: '+m.slice(0,160);
    if(/CREDIT|billing|insufficient_quota|insufficient.?credit/i.test(m)) return 'Netlify AI Gateway credit/quota issue. Detail: '+m.slice(0,140);
    if(/_400:|OPENAI_400|\b400\b/i.test(m)) return 'AI Gateway request rejected (400). Detail: '+m.slice(0,140);
    if(/429|_429|rate.?limit/i.test(m)) return 'AI Gateway/provider rate limited (429) — wait and retry.';
    if(/OPENAI|web.?search|JSON/i.test(m)) return 'AI Gateway stack failed. Check System Health and Netlify function logs.';
    if(/_TIMEOUT|TIMEOUT/i.test(m)) return 'AI provider attempts timed out. KAIROS bounds each hop so the workflow fails cleanly.';
    return 'AI Gateway stack failed. Detail: '+m.slice(0,120);
  }
  if(/timed out|TIMEOUT|_TIMEOUT|AbortError/i.test(m)) return 'AI Gateway timed out — retry, then check System Health / Netlify AI credits. Heavy jobs can take longer; chat and AI Mirror use bounded attempt budgets so failures return cleanly.';
  if(/OPENAI_MODEL_NOT_FOUND/i.test(m)) return 'AI Gateway model route not found. KAIROS will use its built-in supported model policy unless an override is configured.';
  if(/MODEL_NOT_FOUND/i.test(m)) return 'AI Gateway model route not found. Check System Health.';
  if(/AI_MIRROR_REQUIRED/i.test(m)) return 'Run AI Mirror (Build Whole Portfolio) first, then Apply to Wallet (paper).';
  if(/NO_BUYS_APPLIED|price_missing/i.test(m)) return 'Could not apply buys — missing verified market marks for allocated symbols. Refresh licensed market data and retry.';
  if(/OPENAI_API_KEY_MISSING/i.test(m)) return 'Netlify AI Gateway is unavailable. Enable Netlify AI Features for the site/team and redeploy.';
  if(m.length>180 || /^\s*[{\[]/.test(m)){ console.error('[KAIROS] technical error', m); return 'Something went wrong with the AI Gateway stack. Details are in the console / System panel.'; }
  return m;
}
function toast(t){const x=$('#toast');x.textContent=friendlyError(t);x.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>x.style.display='none',4200);}
function loading(btn,on,label='Working…'){if(!btn)return; if(on){btn.dataset.old=btn.innerHTML;btn.innerHTML=`<span class="spinner"></span> ${label}`;btn.disabled=true;btn.setAttribute('aria-busy','true')}else{btn.innerHTML=btn.dataset.old||btn.innerHTML;btn.disabled=false;btn.removeAttribute('aria-busy')}}

function showLogin(){
  const app=$('#appRoot'), login=$('#loginScreen');
  if(app){ app.classList.add('hidden'); app.style.display=''; }
  if(login){
    login.classList.remove('hidden');
    login.style.display='';
    login.style.visibility='';
    login.style.pointerEvents='';
    login.style.zIndex='';
  }
  document.documentElement.classList.add('login-locked');
  document.body.classList.add('login-locked');
  try{ window.scrollTo(0,0); }catch{}
}
function showApp(){
  const app=$('#appRoot'), login=$('#loginScreen');
  // CSS specificity bug: #loginScreen.login-screen{display:grid!important} beat .hidden
  if(login){
    login.classList.add('hidden');
    login.style.display='none';
    login.style.visibility='hidden';
    login.style.pointerEvents='none';
    login.style.zIndex='-1';
  }
  if(app){ app.classList.remove('hidden'); app.style.display=''; }
  document.documentElement.classList.remove('login-locked');
  document.body.classList.remove('login-locked');
  const reset=()=>{
    try{ window.scrollTo(0,0); document.documentElement.scrollTop=0; document.body.scrollTop=0; }catch{}
    const root=$('#appRoot'); if(root) root.scrollTop=0;
    const content=$('#content'); if(content) content.scrollTop=0;
    const layout=document.querySelector('.layout'); if(layout) layout.scrollTop=0;
  };
  reset();
  requestAnimationFrame(reset);
  setTimeout(reset, 50);
}

async function login(){
  const btn=$('#loginBtn'); $('#loginError').textContent=''; loading(btn,true,'Signing in');
  try{
    const result=await api('auth-login',{method:'POST',body:JSON.stringify({identifier:$('#loginUser').value.trim(),password:$('#loginPass').value})});
    loading(btn,false);
    showApp();
    try{ await loadState(); }
    catch(e){
      if(e.message==='UNAUTHORIZED'){ showLogin(); $('#loginError').textContent='Invalid credentials.'; return; }
      toast(e.message||'Could not load portfolio state.');
    }
  }catch(e){
    $('#loginError').textContent=e.message==='UNAUTHORIZED'?'Invalid credentials.':e.message;
    loading(btn,false);
  }
}
let authConfig={signupAllowed:false,termsVersion:null,riskDisclosureVersion:null,termsUrl:null,riskDisclosureUrl:null,privacyUrl:null,legalEntity:null};
async function loadAuthConfig(){
  try{
    const r=await api('auth-config',{method:'GET'}); authConfig=r||authConfig;
    const b=$('#signupOpenBtn'); if(b) b.classList.toggle('hidden',!authConfig.signupAllowed);
    const links=[['#signupTermsLink',authConfig.termsUrl],['#signupRiskLink',authConfig.riskDisclosureUrl],['#signupPrivacyLink',authConfig.privacyUrl]];
    for(const [sel,url] of links){ const a=$(sel); if(a&&url){ a.href=url; a.classList.remove('hidden'); } }
    const entity=$('#signupLegalEntity'); if(entity&&authConfig.legalEntity) entity.textContent=authConfig.legalEntity;
  }catch{}
}
function openSignup(){ const m=$('#signupModal'); if(!m)return; m.classList.remove('hidden'); $('#signupEmail')?.focus(); }
function closeSignup(){ $('#signupModal')?.classList.add('hidden'); }
async function signup(){
  const btn=$('#signupBtn'), err=$('#signupError'); if(err)err.textContent='';
  const email=$('#signupEmail')?.value.trim(), fullName=$('#signupName')?.value.trim(), password=$('#signupPassword')?.value||'';
  if(!$('#signupTerms')?.checked){ if(err)err.textContent='Accept the current Terms and paper-trading risk disclosure.'; return; }
  loading(btn,true,'Creating');
  try{
    const result=await api('auth-signup',{method:'POST',body:JSON.stringify({email,fullName,password,acceptedTermsVersion:authConfig.termsVersion,acceptedRiskDisclosure:true})});
    if(result?.verificationRequired){ closeSignup(); const loginErr=$('#loginError'); if(loginErr) loginErr.textContent='Check your email to confirm the account, then sign in.'; return; }
    closeSignup(); location.reload();
  }catch(e){ if(err)err.textContent=friendlyError(e.message); } finally{ loading(btn,false); }
}
async function processIdentityCallback(){
  const raw=String(location.hash||'').replace(/^#/,'');
  if(!raw) return false;
  const params=new URLSearchParams(raw);
  const confirmationToken=params.get('confirmation_token');
  if(!confirmationToken) return false;
  const loginErr=$('#loginError');
  if(loginErr) loginErr.textContent='Confirming your account…';
  try{
    await api('auth-confirm',{method:'POST',body:JSON.stringify({token:confirmationToken})});
    history.replaceState(null,'',location.pathname+location.search);
    if(loginErr) loginErr.textContent='Email confirmed. Opening your workspace…';
    return true;
  }catch(e){
    if(loginErr) loginErr.textContent='Email confirmation failed or expired. Sign in if the account is already confirmed.';
    return false;
  }
}
async function logout(){try{await api('auth-logout',{method:'POST',body:'{}'});}catch{} location.reload();}
async function checkSession(){
  try{
    await api('auth-session');
    showApp();
    try{ await loadState(); }
    catch(e){
      if(e.message==='UNAUTHORIZED'){ showLogin(); return; }
      toast(e.message||'Could not load portfolio state.');
    }
  }catch{ showLogin(); }
}

async function runLaunchReadiness(btn){
  loading(btn,true,'Checking');
  try{
    const r=await api('launch-readiness',{timeoutMs:20000});
    const el=$('#launchReadinessResult');
    if(el) el.textContent=r.ready?'READY — all technical release gates are green.':'LOCKED — '+(r.blockers||[]).join(', ');
    toast(r.ready?'Commercial release gate is green.':'Commercial release remains locked.');
  }catch(e){ toast(e.message||'Could not evaluate release readiness.'); }
  finally{ loading(btn,false); }
}
async function deleteWorkspace(){
  if(state.auth?.user?.role!=='owner') return toast('Only the workspace owner can delete it.');
  if(String(state.commercial?.tenant?.plan||'').toLowerCase()==='private') return toast('The original private owner workspace is protected from self-service deletion.');
  const ok=confirm('This permanently deletes the KAIROS workspace, paper ledger, Decision History, mirrors, usage history and account mappings. Any active Stripe subscription will be cancelled first. Export a backup before continuing. Continue?');
  if(!ok) return;
  const phrase=prompt('Type exactly: DELETE MY KAIROS WORKSPACE');
  if(phrase!=='DELETE MY KAIROS WORKSPACE') return toast('Deletion cancelled — confirmation phrase did not match.');
  try{
    const r=await api('privacy-delete',{method:'POST',body:JSON.stringify({confirmation:phrase}),timeoutMs:30000});
    alert(r.message||'Workspace deletion queued. Access is now blocked.');
    location.reload();
  }catch(e){ toast(e.message||'Could not queue workspace deletion.'); }
}
async function exportTrackRecord(){
  try{
    const r=await api('track-record',{method:'GET',timeoutMs:20000});
    const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url; a.download=`kairos-track-record-${String(r.period?.endDate||new Date().toISOString().slice(0,10))}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Track record evidence exported.');
  }catch(e){ toast(e.message||'Could not export track record.'); }
}

async function loadState(){
  const prevHealth=state?._providerHealthSummary;
  state=await api('state');
  if(prevHealth) state._providerHealthSummary=prevHealth;
  try{const u=await api('market-universe'); marketUniverse=u.assets||[];}catch{marketUniverse=[];}
  try{state.performanceMirror=await api('performance-mirror');}catch{state.performanceMirror=null;}
  applyDisplayMode(); render(); renderTraceMini(); renderHealth(); await checkTraceGap();
  if(state.auth?.mustChangeDefault) toast('Security: change the initial password in Settings.');
  // Startup is read-only: render cached state immediately. Market refresh is always explicit/background.
  state._marketHistoryThin=!marketUniverse.some(x=>(x.series||[]).length>=2);
  if(state.settings?.onboardingComplete===false) setTimeout(showOnboarding,300);
}
function applyDisplayMode(){ document.body.classList.remove('compact','desktop'); const m=state?.settings?.displayMode||'auto'; if(m==='compact')document.body.classList.add('compact'); if(m==='desktop')document.body.classList.add('desktop'); }
async function checkTraceGap(){
  try{
    const t=await api('trace-status');
    if(t.needsCatchup&&!t.status?.catchupRunning){
      state.traceStatus={...(state.traceStatus||{}),catchupRunning:true,catchupStartedAt:new Date().toISOString(),catchupMissing:t.missing};
      renderTraceMini(); renderHealth();
      api('trace-catchup-background',{method:'POST',body:'{}'}).catch(()=>{});
      toast(`Trace recovery started for ${(t.missing||[]).length} missed day(s).`);
    }
  }catch{}
}

function nav(section){currentSection=section; $$('.nav-btn,.footer-btn').forEach(b=>b.classList.toggle('active',b.dataset.section===section)); render(); try{window.scrollTo(0,0); $('#content')&&($('#content').scrollTop=0); $('#appRoot')&&($('#appRoot').scrollTop=0);}catch{}}

function syncTopbar(){
  if(!state) return;
  const p=state.portfolio?.derived||{};
  const el=$('#topbarSimValue'); if(el) el.textContent=money(p.totalValue??p.equity??0);
  const risk=(state.profile?.riskStyle||state.profile?.riskTolerance||state.profile?.riskProfile||state.profile?.style||'Moderate');
  const meta=$('#topbarMeta'); if(meta) meta.textContent=`PAPER BROKER · V7.3 · ${String(risk).toUpperCase()}`;
  const av=$('#userAvatar'); if(av){ const u=(state.auth?.username||'A')[0].toUpperCase(); av.textContent=u; }
}

function render(){ if(!state)return; const c=$('#content'); c.innerHTML=({home:renderHome,broker:renderBrokerHome,aimirror:renderAIMirror,wallet:renderWalletMirror,performance:renderPerformanceMirror,insight:renderInsight,settings:renderSettings,asset:renderAssetDetail}[currentSection]||renderHome)(); wireScreen(); syncTopbar(); renderTraceMini(); renderHealth();}
function renderTraceMini(){ if(!state)return; const s=state.traceStatus||{}; const el=$('#traceMini'); if(!el)return; el.innerHTML=`<div class="row"><strong>Living Decision History</strong><span class="badge ${s.lastError?'abstain':'action'}">${s.catchupRunning?'RECOVERING':s.lastError?'ERROR':'ACTIVE'}</span></div><div class="tiny" style="margin-top:8px">Last completed: ${esc(s.lastSuccessfulDate||'No daily trace yet')}</div>${s.lastError?`<div class="tiny red" style="margin-top:6px">${esc(s.lastError.slice(0,140))}</div>`:''}`; }
function renderHealth(){
 if(!state)return;
 const d=state.portfolio?.derived||{}, pr=state.providers||{}, pers=state.persistence||{};
 const label=p=>p?.verified?'VERIFIED':p?.configured?'CONFIGURED / UNVERIFIED':'NOT CONFIGURED';
 $('#healthPanel').innerHTML=`<div class="section-title"><div><h3>System Health</h3><p>KAIROS Private · broker simulator + Wallet Mirror + AI Mirror + guarded evolution.</p></div></div><div class="list-compact">
 <div class="row"><span>Authentication</span><strong class="green">Server-side</strong></div>
 <div class="row"><span>Persistence</span><strong class="${pers.persistent?'green':'gold'}">${esc(pers.provider||'ephemeral')}</strong></div>
 <div class="row"><span>AI Gateway</span><strong class="${pr.aiGateway?.configured?'green':'gold'}">${pr.aiGateway?.configured?'NETLIFY GATEWAY':'AWAITING RUNTIME'}</strong></div>
 <div class="row"><span>AI mode</span><strong class="${pr.mode==='LIMITED_NO_AI'?'red':'green'}">${esc(pr.mode||'—')}</strong></div>
 <div class="row"><span>Final gate chain</span><strong class="${pr.finalGate?.configured?'green':'red'}">${pr.finalGate?.configured?esc((pr.finalGate.chain||['failover']).join(' → ')):'UNAVAILABLE'}</strong></div>
 <div class="row"><span>Coach route</span><strong class="${pr.finalGate?.configured?'green':'red'}">${esc((pr.fallbackChains?.chat||[]).join(' → ')||'UNAVAILABLE')}</strong></div>
 <div class="row"><span>Deep verification</span><strong class="${pr.finalGate?.configured?'green':'gold'}">${esc((pr.fallbackChains?.coach_verify||[]).join(' → ')||'BOUNDED')}</strong></div>
 <div class="tiny" style="margin-top:6px">Chains — market: ${(pr.finalGate?.marketChain||pr.fallbackChains?.market_research||[]).join(' → ')||'n/a'} · critic: ${(pr.finalGate?.criticChain||pr.fallbackChains?.critic||[]).join(' → ')||'n/a'} · final: ${(pr.finalGate?.chain||[]).join(' → ')||'n/a'}</div>
 <div class="tiny" style="margin-top:8px">${esc(pr.aiNote||'Netlify AI Gateway routes KAIROS across supported model providers.')}</div>
 <div class="row"><span>Market feed</span><strong class="${pr.market?.verified?'green':pr.market?.configured?'gold':'gold'}">${pr.market?.verified?'VERIFIED LICENSED':pr.market?.configured?'CONFIGURED / UNVERIFIED':'RESEARCH FALLBACK'}</strong></div>
 <div class="row"><span>Evolution champion</span><strong class="green">${esc(state.evolution?.champion?.version||'1.0.0')}</strong></div>
 <div class="row"><span>Trace recovery</span><strong class="${state.traceStatus?.catchupRunning?'gold':'green'}">${state.traceStatus?.catchupRunning?'Running':'Idle'}</strong></div>
 <div class="row"><span>Marks complete</span><strong class="${d.completeMarks?'green':'gold'}">${d.completeMarks?'Yes':'No'}</strong></div>
 </div>
 <div class="card" style="margin-top:14px" id="providerHealthCard">
  <div class="row"><div><h4 style="margin:0">Provider diagnostics</h4><div class="tiny">Live Gateway + market-feed diagnostics. LLM credentials are injected by Netlify AI Gateway.</div></div>
  <button class="primary-btn" id="runProviderTestBtn" type="button">RUN PROVIDER TEST</button></div>
  <div id="providerHealthResults" class="tiny" style="margin-top:10px">${esc(state._providerHealthSummary||'Not run yet this session.')}</div>
 </div>`;
 $('#runProviderTestBtn')?.addEventListener('click',e=>runProviderHealthTest(e.currentTarget));
}


function crownCard(){
 const d=state.decisions?.[0];
 if(!d) return `<div class="hero-card"><div class="section-title"><div><h3>Decision Review</h3><p>No audited decision has been run yet.</p></div></div><div class="alert warn">KAIROS will not display a fake PASS. Pick an asset in Insight and run the real specialist → Decision Review → 3 attack pipeline.</div><button class="primary-btn" style="margin-top:14px" data-go="insight">Run first audit</button></div>`;
 const f=d.final||{}; const pass=f.audit_status==='PASS';
 return `<div class="hero-card"><div class="row"><div><div class="mini-tag">Latest audited decision · ${esc(d.asset)}</div><h2 style="font-size:38px;margin-top:12px" class="${pass?'green':'gold'}">${esc(f.status||'UNKNOWN')}</h2><p>${esc(f.decision||f.why?.[0]||'No explanation returned.')}</p></div><div class="ring" style="width:84px;height:84px"></div></div><div class="cards-3" style="margin-top:14px"><div class="card"><strong>${esc(f.confidence||'UNKNOWN')}</strong><div class="tiny">System conviction</div></div><div class="card"><strong class="${pass?'green':'red'}">${pass?'PASS':'BLOCKED'}</strong><div class="tiny">Audit</div></div><div class="card"><strong>3 + Decision Review</strong><div class="tiny">Core architecture</div></div></div></div>`;
}
function renderDashboard(){ const p=state.portfolio.derived; const goal=Number(state.profile.targetAmount||0); const progress=goal>0?Math.min(100,p.totalValue/goal*100):0; const perf=state.performance;
 return `<div class="hero"><div class="hero-card"><span class="mini-tag">Discipline outperforms emotion</span><h2>Good ${greeting()}.</h2><p>Know what changed, why it matters to you, and what—if anything—you should do.</p><div class="meta" style="margin-top:18px"><span>${esc(state.profile.name)}</span><span>·</span><span>${esc(state.profile.goal)}</span><span>·</span><span>${esc(state.profile.riskStyle)}</span><span>·</span><span>${esc(state.profile.horizon)}</span></div>${state.auth.mustChangeDefault?`<div class="alert warn" style="margin-top:14px">Initial password still active. Change it in Settings.</div>`:''}</div>${crownCard()}</div>
 <div class="stats-grid"><div class="stat"><div class="label">Portfolio Value</div><div class="value">${money(p.totalValue)}</div><div class="muted">${p.positions.length} tracked position(s)</div></div><div class="stat"><div class="label">Unrealized P/L</div><div class="value ${p.unrealizedPnL>=0?'green':'red'}">${money(p.unrealizedPnL)}</div><div class="muted">Realized ${money(p.realizedPnL)}</div></div><div class="stat"><div class="label">Tracked Cash</div><div class="value">${money(p.cash)}</div><div class="muted">Ledger-derived</div></div><div class="stat"><div class="label">Goal Progress</div><div class="value">${progress.toFixed(0)}%</div><div class="status-line"><span style="width:${progress}%"></span></div></div></div>
 <div class="panel market-source-strip"><div class="row"><div><div class="mini-tag">MARKET FEED</div><strong>${state.providers?.market?.verified?esc(state.providers.market.activeProvider||state.providers.market.provider||'Licensed provider'):state.providers?.market?.configured?'Licensed feed configured · not yet verified':'AI context only · prices unavailable'}</strong><div class="tiny">${state.providers?.market?.verified?'Verified licensed market data active · AI is used only for interpretation':state.providers?.market?.configured?'Credentials are configured, but no successful licensed world-state has verified the feed yet':'Licensed feed not configured · AI context may load, but price/chart fields stay unavailable'}</div></div><span class="badge ${state.providers?.market?.configured?'action':'watch'}">${state.providers?.market?.verified?'VERIFIED FEED':state.providers?.market?.configured?'UNVERIFIED':'FALLBACK'}</span></div></div>
 <div class="two-col"><div class="panel"><div class="section-title"><div><h3>Portfolio Performance</h3><p>Calculated from saved daily snapshots — never sample returns.</p></div><button class="ghost-btn" data-go="performance">Open Mirror</button></div>${performanceMini(perf)}</div><div class="panel"><div class="section-title"><div><h3>What matters now</h3><p>Latest persisted market state.</p></div><button class="primary-btn" id="marketRefreshDash">Refresh market data</button></div>${worldStateSummary()}</div></div>`; }
function performanceMini(perf){ if(!perf?.ready) return `<div class="alert warn">${esc(perf?.reason||'Performance tracking begins after daily snapshots are recorded.')} Current recorded snapshots: ${state.snapshots?.length||0}.</div>`; return `<div class="cards-3"><div class="card"><strong class="${perf.totalReturn>=0?'green':'red'}">${pct(perf.totalReturn)}</strong><div class="tiny">Time-weighted return</div></div><div class="card"><strong>${pct(perf.maxDrawdown)}</strong><div class="tiny">Max drawdown</div></div><div class="card"><strong>${perf.riskAdjusted==null?'N/A':Number(perf.riskAdjusted).toFixed(2)}</strong><div class="tiny">Risk-adjusted estimate</div></div></div>${lineChart(perf.series||[],null,null,['#1B4C93'])}`; }
function worldStateSummary(){const w=state.worldState;if(!w)return `<div class="alert warn">No market World State has been generated yet. Use Refresh. The app will not invent one.</div>`;const re=w._meta?.research_error||w._meta?.lastError;return `<div class="card"><div class="row"><div><strong style="font-size:24px" class="green">${esc(w.regime?.name||'Unclassified')}</strong><div class="tiny">As of ${esc(w.date||'unknown')} · ${esc(w.regime?.confidence||'unknown')} confidence</div></div></div><div class="tiny" style="margin-top:10px">${esc(w.summary||'')}</div>${re?`<div class="alert warn" style="margin-top:10px"><strong>AI interpretation failed.</strong> ${esc(String(re).slice(0,200))}</div>`:''}</div><div class="cards-3" style="margin-top:12px"><div class="card"><strong>${esc(w.regime?.trend||'Unknown')}</strong><div class="tiny">Trend</div></div><div class="card"><strong>${esc(w.regime?.liquidity||'Unknown')}</strong><div class="tiny">Liquidity</div></div><div class="card"><strong>${esc(w.regime?.volatility||'Unknown')}</strong><div class="tiny">Volatility</div></div></div>`;}

function filterSnapshots(range){const all=state.snapshots||[]; if(range==='ALL')return all; const days={ '1M':31,'3M':93,'1Y':366}[range]||366; const cut=Date.now()-days*86400000; return all.filter(s=>Date.parse(s.date)>=cut);}
function calcPerf(snaps){if(snaps.length<2)return {ready:false,points:snaps}; let growth=1,series=[100],returns=[];for(let i=1;i<snaps.length;i++){const a=+snaps[i-1].portfolioValue,b=+snaps[i].portfolioValue,flow=+snaps[i].netExternalFlow||0;if(a<=0){series.push(series.at(-1));continue}const r=(b-flow-a)/a;returns.push(r);growth*=1+r;series.push(growth*100)}let peak=series[0],dd=0;for(const v of series){peak=Math.max(peak,v);dd=Math.min(dd,(v-peak)/peak)}const b=snaps.map(x=>({...x,_spy:+(x.spyPrice??x.sp500Level)})).filter(x=>Number.isFinite(x._spy)&&x._spy>0);return {ready:true,totalReturn:growth-1,maxDrawdown:dd,series,benchmarkReturn:b.length>=2?(b.at(-1)._spy/b[0]._spy-1):null,complete:snaps.every(x=>x.completeMarks!==false)};}
function renderPerformance(){const snaps=filterSnapshots(perfRange),p=calcPerf(snaps); const decisionStats=scoredDecisionStats();return `<div class="panel"><div class="section-title"><div><h3>Performance Mirror</h3><p>Only recorded KAIROS history appears here.</p></div><div class="subtabs">${['1M','3M','1Y','ALL'].map(r=>`<button class="tab-btn ${perfRange===r?'active':''}" data-perf-range="${r}">${r}</button>`).join('')}</div></div>${!p.ready?`<div class="alert warn">Need at least two snapshots inside this range. Recorded: ${snaps.length}. Daily Decision History will build this automatically after deployment.</div>`:`<div class="cards-4"><div class="card"><div class="muted">Portfolio TWR</div><div class="value ${p.totalReturn>=0?'green':'red'}">${pct(p.totalReturn)}</div></div><div class="card"><div class="muted">Max Drawdown</div><div class="value">${pct(p.maxDrawdown)}</div></div><div class="card"><div class="muted">SPY benchmark</div><div class="value">${p.benchmarkReturn==null?'N/A':pct(p.benchmarkReturn)}</div></div><div class="card"><div class="muted">Mark integrity</div><div class="value ${p.complete?'green':'gold'}" style="font-size:24px">${p.complete?'Complete':'Mixed'}</div></div></div><div class="chart-wrap" style="margin-top:16px">${lineChart(p.series,null,null,['#1B4C93'])}</div>`}</div>
 <div class="two-col"><div class="panel"><div class="section-title"><div><h3>Decision Scorecard</h3><p>Only matured ADD/REDUCE decisions are directionally scored.</p></div></div><div class="cards-3"><div class="card"><strong>${decisionStats.eligible}</strong><div class="tiny">Eligible outcomes</div></div><div class="card"><strong>${decisionStats.hitRate==null?'N/A':(decisionStats.hitRate*100).toFixed(0)+'%'}</strong><div class="tiny">Directional hit rate</div></div><div class="card"><strong>${decisionStats.noAction}</strong><div class="tiny">No Action / Hold observations</div></div></div></div><div class="panel"><div class="section-title"><div><h3>The Mirror speaks</h3><p>What can honestly be claimed today.</p></div></div>${p.ready?`<div class="alert good">KAIROS has ${snaps.length} recorded snapshots in this range. Metrics are calculated from those observations.</div>`:`<div class="alert warn">There is not enough recorded history to claim performance yet. That is intentional.</div>`}<div class="tiny" style="margin-top:10px">Deposits and withdrawals are separated from investment return in the TWR calculation.</div></div></div>`;}
function scoredDecisionStats(){let eligible=0,hits=0,noAction=0;for(const d of state.decisions||[]){if(['NO_ACTION','HOLD','WATCH','ABSTAIN'].includes(d.final?.status))noAction++;const mature=(d.outcomes||[]).filter(o=>o.daysSinceDecision>=7);if(['ADD','REDUCE'].includes(d.final?.status)&&mature.length){eligible++;if(mature.at(-1).directionalCorrect)hits++;}}return {eligible,hitRate:eligible?hits/eligible:null,noAction};}

function renderPortfolio(){const p=state.portfolio.derived;return `<div class="panel"><div class="section-title"><div><h3>Portfolio Digital Twin</h3><p>Transaction ledger is the source of truth.</p></div><div class="action-row"><button class="primary-btn" id="addTxBtn">Add transaction</button><button class="ghost-btn" id="addOpeningBtn">Add opening position</button></div></div><div class="cards-4"><div class="card"><div class="muted">Total Value</div><div class="value">${money(p.totalValue)}</div></div><div class="card"><div class="muted">Cash</div><div class="value">${money(p.cash)}</div></div><div class="card"><div class="muted">Income</div><div class="value green">${money(p.income)}</div></div><div class="card"><div class="muted">Fees + Taxes</div><div class="value">${money(p.totalFees+p.totalTaxes)}</div></div></div>${p.warnings?.length?`<div class="alert bad" style="margin-top:14px">${p.warnings.map(esc).join('<br>')}</div>`:''}</div>
 <div class="two-col"><div class="panel"><div class="section-title"><div><h3>Holdings</h3><p>Derived from ledger + current marks.</p></div></div>${holdingTable()}</div><div class="panel"><div class="section-title"><div><h3>Allocation</h3><p>Current market-value weights.</p></div></div>${allocation()}</div></div>
 <div class="panel"><div class="section-title"><div><h3>Transaction Ledger</h3><p>Buy, sell, cash, income, fees, taxes.</p></div></div>${txTable()}</div>`;}
function holdingTable(){const p=state.portfolio.derived;if(!p.positions.length)return `<div class="alert warn">No positions tracked. Add an opening position or deposit cash and record a buy.</div>`;return `<div class="chart-wrap" style="overflow:auto"><table><thead><tr><th>Asset</th><th>Qty</th><th>Avg Cost</th><th>Mark</th><th>Value</th><th>P/L</th><th>Source</th><th></th></tr></thead><tbody>${p.positions.map(x=>`<tr><td><button class="tiny-btn" data-asset="${esc(x.symbol)}"><strong>${esc(x.symbol)}</strong></button></td><td>${x.quantity.toFixed(6).replace(/0+$/,'').replace(/\.$/,'')}</td><td>${money(x.avgCost)}</td><td>${money(x.price)}</td><td>${money(x.marketValue)}</td><td class="${x.unrealizedPnL>=0?'green':'red'}">${money(x.unrealizedPnL)}</td><td class="tiny">${esc(x.priceSource)}</td><td><button class="tiny-btn" data-mark="${esc(x.symbol)}">Set mark</button></td></tr>`).join('')}</tbody></table></div>`;}
function allocation(){const p=state.portfolio.derived,total=p.totalValue||1;const rows=[...p.positions.map(x=>[x.symbol,x.marketValue]),['Cash',p.cash]].filter(x=>Math.abs(x[1])>0).sort((a,b)=>b[1]-a[1]);if(!rows.length)return '<div class="alert warn">No allocation yet.</div>';const pcts=rows.slice(0,3).map(([,v])=>Math.max(0,Math.min(100,v/total*100)));const p1=pcts[0]||0,p2=p1+(pcts[1]||0),p3=p2+(pcts[2]||0);return `<div class="alloc-donut"><div class="alloc-ring" style="--p1:${p1}%;--p2:${p2}%;--p3:${p3}%"></div><div class="list-compact">${rows.map(([k,v])=>`<div class="card"><div class="row"><strong>${esc(k)}</strong><strong>${(v/total*100).toFixed(1)}%</strong></div><div class="status-line" style="margin-top:8px"><span style="width:${Math.max(0,Math.min(100,v/total*100))}%"></span></div></div>`).join('')}</div></div>`;}
function txTable(){const tx=state.portfolio.transactions||[];if(!tx.length)return `<div class="alert warn">Ledger is empty.</div>`;return `<div class="chart-wrap" style="overflow:auto"><table><thead><tr><th>Date</th><th>Type</th><th>Asset</th><th>Qty</th><th>Price/Amount</th><th>Note</th><th></th></tr></thead><tbody>${[...tx].reverse().map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.symbol||'—')}</td><td>${t.quantity||'—'}</td><td>${money(t.amount||t.unitPrice||0)}</td><td>${esc(t.note||'')}</td><td><button class="tiny-btn" data-del-tx="${esc(t.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;}

function decisionWithin(d,range){if(range==='all')return true;const days={today:1,week:7,month:31}[range]||99999;return Date.now()-Date.parse(d.createdAt)<days*86400000;}
function renderDecisions(){const assets=state.portfolio.derived.positions.map(p=>p.symbol);const ds=(state.decisions||[]).filter(d=>decisionWithin(d,decisionRange));return `<div class="panel"><div class="section-title"><div><h3>Audited Decisions</h3><p>3 specialist cores → provisional Decision Review → 3 attacks → final Decision Review.</p></div></div><div class="action-row"><select id="decisionAsset" class="select" style="max-width:220px">${assets.map(a=>`<option>${esc(a)}</option>`).join('')}<option value="__CUSTOM__">Other symbol…</option></select><input id="decisionCustom" class="text-input hidden" style="max-width:180px" placeholder="AAPL"><button class="primary-btn" id="runDecisionBtn">Run full audit</button><label class="tiny"><input type="checkbox" id="forceMarketRefresh"> refresh market evidence first</label></div>${!assets.length?`<div class="alert warn" style="margin-top:14px">No tracked holdings yet. Choose “Other symbol” to research an asset, or add a portfolio position first.</div>`:''}<div class="subtabs" style="margin-top:14px">${[['today','Today'],['week','Week'],['month','Month'],['all','All']].map(([k,l])=>`<button class="tab-btn ${decisionRange===k?'active':''}" data-decision-range="${k}">${l}</button>`).join('')}</div></div><div class="panel"><div class="decision-list">${ds.length?ds.map(decisionCard).join(''):'<div class="alert warn">No audited decisions in this range.</div>'}</div></div>`;}
function decisionCard(d){const f=d.final||{},pass=f.audit_status==='PASS';const core=Object.values(d.specialists||{});const attacks=Object.values(d.attacks||{});return `<div class="decision"><div class="decision-header"><div><strong style="font-size:26px">${esc(d.asset)}</strong><div class="meta"><span>${dateLabel(d.createdAt)}</span><span>Ref. ${d.referencePrice?money(d.referencePrice):'unavailable'}</span></div></div><span class="badge ${pass?'action':'abstain'}">${esc(f.status||'UNKNOWN')} · ${pass?'AUDITED':'BLOCKED'}</span></div><div class="cards-3" style="margin-top:14px"><div class="card"><strong>Why</strong><div class="tiny" style="margin-top:8px">${esc((f.why||[]).join(' · ')||f.decision||'')}</div></div><div class="card"><strong>Downside</strong><div class="tiny" style="margin-top:8px">${esc((f.downside||[]).join(' · ')||'Not specified')}</div></div><div class="card"><strong>What changes the view</strong><div class="tiny" style="margin-top:8px">${esc((f.what_changes_view||[]).join(' · ')||'Not specified')}</div></div></div><div class="cards-3" style="margin-top:12px"><div class="card"><strong>${core.filter(x=>x.status==='PASS').length}/${core.length}</strong><div class="tiny">Specialist PASS</div></div><div class="card"><strong>${attacks.filter(x=>x.pass===true).length}/${attacks.length}</strong><div class="tiny">Attacks survived</div></div><div class="card"><strong>${esc(f.confidence||'UNKNOWN')}</strong><div class="tiny">System conviction</div></div></div></div>`;}


function renderAssetDetail(){
  const symbol=selectedAsset || state.portfolio.derived.positions[0]?.symbol;
  if(!symbol) return `<div class="panel"><div class="alert warn">No asset selected. Add a holding first.</div></div>`;
  const pos=state.portfolio.derived.positions.find(p=>p.symbol===symbol)||null;
  const snaps=(state.snapshots||[]).map(s=>({date:s.date,p:(s.positions||[]).find(x=>x.symbol===symbol)})).filter(x=>x.p&&Number.isFinite(+x.p.price));
  const universeAsset=(marketUniverse||[]).find(x=>x.symbol===symbol)||null;
  const prices=snaps.length>=2?snaps.map(x=>+x.p.price):(universeAsset?.series||[]).map(x=>Number(x.price)).filter(Number.isFinite);
  const decisions=(state.decisions||[]).filter(d=>d.asset===symbol);
  const latest=decisions[0]?.final||null;
  const market=(state.worldState?.instruments||[]).find(i=>String(i.symbol||'').toUpperCase()===symbol)||null;
  const price=pos?.price ?? (market?.price!=null?Number(market.price):null) ?? universeAsset?.current?.price;
  const ret=universeAsset?.periodReturn;
  const cat=categoryOfKind(universeAsset?.kind||'');
  return `<section class="broker-screen"><div class="row"><div class="action-row"><button class="ghost-btn" data-go="broker">← Broker</button>${pos?`<button class="ghost-btn" data-go="wallet">Wallet</button>`:''}</div><div class="muted tiny">Asset Detail</div></div>
  <div class="asset-hero" style="margin-top:10px">
    <div class="row" style="align-items:flex-start"><div><div class="eyebrow">${esc(universeAsset?.label||symbol)}</div><h2 class="ticker-primary" style="font-size:28px;margin:4px 0">${esc(symbol)}</h2><p class="tiny">${esc(universeAsset?.description|| (pos?'Tracked position':'Research-only asset'))}</p>
    <div class="asset-tags"><span>${esc(cat||'Market')}</span><span>${esc(universeAsset?.kind||'Proxy')}</span>${pos?`<span>Held</span>`:`<span>Watch</span>`}</div></div>
    <div style="text-align:right"><div class="asset-price-xl">${price!=null&&Number(price)>0?money(price):'—'}</div><div class="asset-chg-xl ${ret==null?'muted':ret>=0?'green':'red'}">${ret==null?(pos?money(pos.unrealizedPnL):'History building'):pct(ret)}</div></div></div>
    <div class="timeframe-row"><span class="active">RECORDED</span><span>${prices.length} PTS</span><span>${esc((universeAsset?.current?.confidence||'unverified')+'').toUpperCase()}</span></div>
    <div class="market-big-chart chart-wrap" style="margin-top:8px;border:0;background:transparent;padding:0">${prices.length>=2?lineChart(prices,null,null,[ret!=null&&ret<0?'#FF5A5A':'#1B4C93']):`<div class="alert warn">Chart needs ≥2 recorded points (${prices.length}).</div>`}</div>
    <div class="simulate-row"><button class="primary-btn" data-broker-trade="BUY" data-symbol="${esc(symbol)}">Buy</button><button class="ghost-btn" data-broker-trade="SELL" data-symbol="${esc(symbol)}">Sell</button></div>
  </div>
  <div class="two-col" style="margin-top:12px"><div class="panel"><div class="section-title"><div><h3>Your Position</h3><p>Ledger-derived.</p></div></div>${pos?`<div class="cards-3"><div class="card"><strong>${pos.quantity}</strong><div class="tiny">Qty</div></div><div class="card"><strong>${money(pos.avgCost)}</strong><div class="tiny">Avg cost</div></div><div class="card"><strong class="${pos.unrealizedPnL>=0?'green':'red'}">${money(pos.unrealizedPnL)}</strong><div class="tiny">Unrealized</div></div></div>`:`<div class="alert warn">Not currently held.</div>`}</div>
  <div class="panel"><div class="section-title"><div><h3>KAIROS View</h3><p>Latest Decision Review.</p></div></div>${latest?`<div class="card"><div class="row"><strong class="${latest.audit_status==='PASS'?'green':'gold'}">${esc(latest.status)}</strong><span>${esc(latest.confidence||'UNKNOWN')}</span></div><div class="tiny" style="margin-top:8px">${esc(latest.decision||latest.why?.[0]||'')}</div></div>`:`<div class="alert warn">No Decision Review yet for ${esc(symbol)}.</div>`}<button class="primary-btn" style="margin-top:12px;width:100%" id="assetAuditBtn">Run ${esc(symbol)} audit</button></div></div>
  <div class="panel"><div class="section-title"><div><h3>Decision Timeline</h3><p>Nothing fabricated.</p></div></div>${decisions.length?decisions.map(decisionCard).join(''):`<div class="alert warn">No decision history yet.</div>`}</div></section>`;
}

function renderMarkets(){const w=state.worldState;return `<div class="panel"><div class="section-title"><div><h3>Markets</h3><p>${state.providers?.market?.configured?'Licensed market feed primary · Gateway interpretation only':'Context-only AI fallback · prices unavailable without licensed feed'}.</p></div><button class="primary-btn" id="marketRefreshBtn">Refresh now</button></div>${w?marketWorld(w):`<div class="alert warn">No market state exists yet. Refresh now or wait for the scheduled daily Decision History job.</div>`}</div>`;}
function marketWorld(w){const b=w.benchmarks||{};const vals=[['SPY',b.spy_price],['Gold',b.gold_price],['Bitcoin',b.btc_price],['US 10Y',b.us10y_yield],['DXY',b.dxy]];return `<div class="cards-4">${vals.map(([k,v])=>`<div class="card"><div class="muted">${k}</div><div class="value" style="font-size:28px">${v==null?'UNKNOWN':Number(v).toLocaleString()}</div></div>`).join('')}</div><div class="two-col" style="margin-top:16px"><div class="card"><div class="value green" style="font-size:32px">${esc(w.regime?.name||'Unclassified')}</div><div class="tiny">${esc(w.summary||'')}</div><div class="cards-3" style="margin-top:12px"><div class="card"><strong>${esc(w.regime?.trend||'Unknown')}</strong><div class="tiny">Trend</div></div><div class="card"><strong>${esc(w.regime?.liquidity||'Unknown')}</strong><div class="tiny">Liquidity</div></div><div class="card"><strong>${esc(w.regime?.volatility||'Unknown')}</strong><div class="tiny">Volatility</div></div></div></div><div class="card"><strong>Drivers</strong><div class="list-compact" style="margin-top:10px">${(w.drivers||[]).map(d=>`<div class="alert"><strong>${esc(d.title)}</strong><div class="tiny">${esc(d.why)}</div></div>`).join('')||'<div class="tiny">No verified drivers returned.</div>'}</div></div></div>${citations(w._meta?.citations||[],'World State sources')}`;}
function citations(cs,title='Sources'){const safe=(cs||[]).map(c=>({...c,_url:safeHttpUrl(c?.url)})).filter(c=>c._url);if(!safe.length)return '';return `<div style="margin-top:16px"><strong>${esc(title)}</strong><div class="list-compact" style="margin-top:8px">${safe.slice(0,12).map(c=>`<a class="citation-link" target="_blank" rel="noopener noreferrer" href="${esc(c._url)}">${esc(c.title||c._url)}</a>`).join('')}</div></div>`;}

function renderResearch(){const w=state.worldState, traces=state.snapshots||[];return `<div class="panel research-hero"><div class="section-title"><div><div class="mini-tag">RESEARCH · DECISION HISTORY</div><h3 style="margin-top:10px">Today in context</h3><p>Inspect verified evidence and institutional memory. Questions now live in one KAIROS Advisor conversation.</p></div><button class="primary-btn" id="researchOpenAdvisor">Open Advisor</button></div></div><div class="two-col"><div class="panel"><div class="section-title"><div><h3>Current World State</h3><p>${w?esc(w.date):'No state yet'}</p></div></div>${w?worldStateSummary():'<div class="alert warn">Generate a Market World State first.</div>'}</div><div class="panel"><div class="section-title"><div><h3>Living Decision History</h3><p>Daily snapshots stored through the active persistence provider.</p></div></div><div class="cards-3"><div class="card"><strong>${traces.length}</strong><div class="tiny">Portfolio snapshots</div></div><div class="card"><strong>${state.decisions?.length||0}</strong><div class="tiny">Audited decisions</div></div><div class="card"><strong>${esc(state.traceStatus?.lastSuccessfulDate||'None')}</strong><div class="tiny">Last daily trace</div></div></div>${state.traceStatus?.lastError?`<div class="alert bad" style="margin-top:12px">${esc(state.traceStatus.lastError)}</div>`:''}</div></div>`;}


function sparkline(series=[],color='#1B4C93',h=36){
  const vals=(series||[]).map(x=>Number(x?.price??x)).filter(Number.isFinite);
  if(vals.length<2) return `<div class="spark-empty" style="height:${h}px"><span>HISTORY</span></div>`;
  const W=180,H=h,P=3,min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  const gid='sg'+Math.random().toString(36).slice(2,8);
  const pts=vals.map((v,i)=>`${(P+i*(W-2*P)/(vals.length-1)).toFixed(1)},${(H-P-(v-min)/span*(H-2*P)).toFixed(1)}`).join(' ');
  const area=`${P},${H-P} ${pts} ${W-P},${H-P}`;
  return `<svg class="sparkline chart-glow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#${gid})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.1" vector-effect="non-scaling-stroke"/></svg>`;
}
function categoryOfKind(kind=''){
  const k=String(kind||'').toLowerCase();
  if(k.includes('crypto')) return 'Crypto';
  if(k.includes('bond')||k.includes('cash')) return 'Bonds';
  if(k.includes('commodity')) return 'Commodities';
  if(k.includes('reit')||k.includes('real')) return 'Alts';
  if(k.includes('global')||k.includes('emerg')) return 'Intl';
  if(k.includes('us')||k.includes('sector')||k.includes('growth')||k.includes('equity')) return 'US';
  return 'Other';
}
function categoryChips(){
  const wl=(state?.watchlist||[]).length;
  const cats=[['ALL','All'],['WATCH',`Watchlist${wl?` · ${wl}`:''}`],['US','U.S.'],['Crypto','Crypto'],['Bonds','Bonds'],['Commodities','Commodities'],['Alts','Real Assets'],['Intl','Global']];
  return `<div class="category-chips">${cats.map(([c,l])=>`<button type="button" class="cat-chip ${brokerCategory===c?'active':''}" data-broker-cat="${c}">${l}</button>`).join('')}</div>`;
}
function renderMarketCollections(){
  const defs=[
    ['US','U.S. Markets','Stocks · indexes · sectors','gold'],
    ['Crypto','Crypto',cryptoCatalogMeta.total?`${cryptoCatalogMeta.total.toLocaleString()} supported USD pairs`:'All supported USD pairs',''],
    ['Bonds','Fixed Income','Treasuries · credit · T-bills',''],
    ['Commodities','Commodities','Gold · silver','gold'],
    ['Alts','Real Assets','Listed real estate',''],
    ['Intl','Global','World · emerging markets','']
  ];
  return `<div class="v7-market-collections">${defs.map(([id,label,sub,tone])=>{const list=(marketUniverse||[]).filter(x=>categoryOfKind(x.kind)===id);const ready=list.filter(x=>Number.isFinite(Number(x.periodReturn)));const avg=ready.length?ready.reduce((a,x)=>a+Number(x.periodReturn),0)/ready.length:null;return `<button type="button" class="v7-market-collection ${tone} ${brokerCategory===id?'active':''}" data-broker-cat="${id}"><span>MARKET</span><strong>${esc(label)}</strong><small>${esc(sub)}</small><b class="${avg==null?'muted':avg>=0?'green':'red'}">${avg==null?`${list.length} assets`:pct(avg,1)}</b></button>`}).join('')}</div>`;
}
function renderMarketPulse(){
  const rows=(marketUniverse||[]).filter(x=>Number.isFinite(Number(x.periodReturn))).slice().sort((a,b)=>Math.abs(Number(b.periodReturn))-Math.abs(Number(a.periodReturn))).slice(0,6);
  if(!rows.length) return `<div class="v7-empty compact"><span>Market pulse appears after fresh prices / history are available.</span></div>`;
  return `<div class="v7-market-pulse">${rows.map(x=>`<button type="button" class="v7-pulse-item" data-market-open="${esc(x.id)}"><strong>${esc(x.symbol)}</strong><b class="${Number(x.periodReturn)>=0?'green':'red'}">${pct(x.periodReturn)}</b><small>${esc(x.label)}</small><span>${esc(categoryOfKind(x.kind))}</span></button>`).join('')}</div>`;
}
function universeSymbolSet(){return [...new Set([...(marketUniverse||[]).map(x=>x.symbol),...(state?.portfolio?.derived?.positions||[]).map(x=>x.symbol)])];}
function marketSwitcher(active=selectedMarketId,includeAll=false){
  const all=includeAll?`<button class="market-chip ${active==='all'?'active':''}" data-market-id="all"><span>ALL</span><small>Universe</small></button>`:'';
  return `<div class="market-switcher">${all}${(marketUniverse||[]).map(x=>`<button class="market-chip ${active===x.id?'active':''}" data-market-id="${esc(x.id)}"><span class="chip-ticker">${esc(x.symbol)}</span><small>${esc(x.label)}</small></button>`).join('')}</div>`;
}
function confPct(raw){
  if(raw==null||raw==='') return null;
  if(typeof raw==='number' && Number.isFinite(raw)) return Math.max(0,Math.min(100,raw<=1?Math.round(raw*100):Math.round(raw)));
  const s=String(raw).toLowerCase();
  if(s.includes('high')||s==='h') return 78;
  if(s.includes('med')||s==='m') return 62;
  if(s.includes('low')||s==='l') return 42;
  const n=Number(raw); if(Number.isFinite(n)) return Math.max(0,Math.min(100,n<=1?Math.round(n*100):Math.round(n)));
  return null;
}
function sentimentBadge(ret){
  if(ret==null||!Number.isFinite(ret)) return {label:'WATCH',cls:'watch'};
  if(ret>=0.08) return {label:'STRONG BULL',cls:'bull strong'};
  if(ret>=0.02) return {label:'BULLISH',cls:'bull'};
  if(ret<=-0.08) return {label:'STRONG BEAR',cls:'bear strong'};
  if(ret<=-0.02) return {label:'BEARISH',cls:'bear'};
  return {label:'NEUTRAL',cls:'watch'};
}
function universeCard(x){
  const p=x?.current?.price, ret=x?.periodReturn;
  const down=ret!=null&&ret<0;
  const up=ret!=null&&ret>=0;
  const color=down?'#FF5A5A':'#7CFFB2';
  const active=selectedMarketId===x.id?'active':'';
  const badge=sentimentBadge(ret);
  const conf=confPct(x?.current?.confidence);
  const confShow=conf!=null?conf:((x.series&&x.series.length>2)?58:null);
  const whyBits=[];
  const decision=(state.decisions||[]).find(d=>d.asset===x.symbol);
  if(decision?.final?.why?.[0]) whyBits.push(decision.final.why[0]);
  else if(decision?.final?.decision) whyBits.push(decision.final.decision);
  else whyBits.push(marketContextInsight(x));
  const whyText=whyBits[0]||'';
  const chg=ret==null?'—':pct(ret);
  return `<article class="mkt-card dense-ref ${down?'down':''} ${up?'up':''} ${active}" data-market-open="${esc(x.id)}">
  <div class="mkt-card-top">
    <div class="mkt-id">
      <div class="mkt-sym">${esc(x.symbol)}</div>
      <div class="mkt-name">${esc(x.label)}</div>
    </div>
    <span class="mkt-chg ${ret==null?'flat':ret>=0?'pos':'neg'}">${chg}</span>
  </div>
  <div class="mkt-card-bot">
    <div class="mkt-price">${p==null?'—':money(p)}</div>
    <div class="mkt-spark">${sparkline(x.series,color,28)}</div>
  </div>
  <div class="mkt-card-foot">
    <span class="mkt-badge ${badge.cls}">${badge.label}</span>
    ${confShow!=null?`<span class="mkt-conf-mini">${confShow}%</span>`:''}
    <button type="button" class="mkt-star ${(state?.watchlist||[]).includes(x.symbol)?'active':''}" data-watch-toggle="${esc(x.symbol)}" aria-label="Toggle watchlist">${(state?.watchlist||[]).includes(x.symbol)?'★':'☆'}</button>
    <button type="button" class="mkt-why" data-mkt-why="${esc(x.id)}" data-mkt-sym="${esc(x.symbol)}">Why?</button>
    <button type="button" class="mkt-sim" data-broker-trade="BUY" data-symbol="${esc(x.symbol)}" aria-label="Simulate Buy">↗</button>
  </div>
  <div class="mkt-why-panel hidden" data-why-panel="${esc(x.id)}"><strong>KAIROS:</strong> ${esc(String(whyText).slice(0,280))}${String(whyText).length>280?'…':''} <button type="button" class="tiny-btn" data-asset="${esc(x.symbol)}">Detail</button></div>
</article>`;
}

function gateBadge(gate){
  if(!gate) return `<span class="badge watch">NOT RUN</span>`;
  if(gate.approved){
    const label=gate.conservativeRelease?'APPROVED · CONSERVATIVE':'FINAL APPROVED';
    return `<span class="badge action">${label}</span>`;
  }
  return `<span class="badge abstain">FINAL REJECTED</span>`;
}
function formatRejectReasons(gateOrMirror){
  const reasons=gateOrMirror?.rejectionReasons||gateOrMirror?.gate?.rejectionReasons||[];
  if(Array.isArray(reasons)&&reasons.length) return reasons.map(r=>String(r)).filter(Boolean).slice(0,8);
  const summary=gateOrMirror?.rejectionSummary||gateOrMirror?.report||'';
  if(summary && /withheld|rejected/i.test(summary)) return [summary];
  return [];
}
function selectedMarket(){ return (marketUniverse||[]).find(x=>x.id===selectedMarketId)||marketUniverse?.[0]||null; }
function marketContextInsight(x){
  if(!x) return 'Select a market to inspect its recorded context.';
  const ret=Number(x.periodReturn); const regime=state.worldState?.regime?.name||'unclassified regime';
  if(!Number.isFinite(ret)) return `${x.label} history is still building. KAIROS will not invent momentum before enough verified observations exist.`;
  const direction=ret>0.08?'strong positive recorded momentum':ret>0.02?'positive recorded momentum':ret<-0.08?'strong negative recorded momentum':ret<-0.02?'negative recorded momentum':'mostly flat recorded momentum';
  return `${x.label} currently shows ${direction} across KAIROS recorded states while the broader environment is ${regime}. This is context, not an automatic trade signal.`;
}
function marketWatchText(x){
  const r=state.worldState?.regime||{}; const risks=(state.worldState?.risks||[]).slice(0,3);
  const base=[r.volatility?`Volatility: ${r.volatility}`:null,r.liquidity?`Liquidity: ${r.liquidity}`:null,r.trend?`Trend: ${r.trend}`:null,...risks].filter(Boolean);
  return base.length?base:[`Watch verified price history, concentration impact, and what would invalidate the thesis before changing ${x?.symbol||'this exposure'}.`];
}
function renderBrokerMarketPanel(){
  const x=selectedMarket(); if(!x) return `<div class="alert warn empty-broker"><h2>No market selected</h2><p>Refresh intelligence to load the curated universe, then tap a ticker.</p></div>`;
  const decision=(state.decisions||[]).find(d=>d.asset===x.symbol); const pos=(state.portfolio?.derived?.positions||[]).find(p=>p.symbol===x.symbol);
  const price=x.current?.price==null?null:Number(x.current.price); const ret=x.periodReturn;
  const cat=categoryOfKind(x.kind);
  return `<div class="market-focus premium-card asset-hero"><div class="market-focus-head"><div class="symbol-orb large ticker-orb">${esc(x.symbol)}</div><div class="market-focus-title"><div class="eyebrow">${esc(x.kind)}</div><h2 class="ticker-primary">${esc(x.symbol)}</h2><p><strong>${esc(x.label)}</strong> — ${esc(x.description)}</p><div class="asset-tags"><span>${esc(cat)}</span><span>${esc(x.kind||'Market')}</span>${pos?`<span>HELD</span>`:''}</div></div><div class="market-focus-price"><strong>${price==null?'—':money(price)}</strong><span class="asset-chg-xl ${ret==null?'muted':ret>=0?'green':'red'}">${ret==null?'History building':pct(ret)}</span></div></div>
  <div class="timeframe-row"><span class="active">${x.seriesSource==='research'?'RESEARCH':x.seriesSource==='mixed'?'MIXED':'RECORDED'}</span><span>${x.series.length} POINTS</span><span>${x.current?.confidence?esc(x.current.confidence).toUpperCase():'UNVERIFIED'}</span><span>${pos?`OWN ${Number(pos.quantity).toFixed(4)}`:'NOT HELD'}</span></div>
  <div class="market-big-chart">${x.series.length>=2?`${lineChart(x.series.map(p=>p.price),null,null,[ret!=null&&ret<0?'#FF5A5A':'#1B4C93'])}${x.seriesSource&&x.seriesSource!=='recorded'?`<div class="tiny muted" style="margin-top:8px">History via ${esc(x.researchMeta?.provider||'licensed market feed')}. LLMs never manufacture chart prices.</div>`:''}`:`<div class="empty-chart"><strong>No chart yet.</strong><span>Tap Refresh market data to seed Twelve Data / Finnhub history, or wait for recorded daily states.</span></div>`}</div>
  <div class="simulate-row"><button class="primary-btn" data-broker-trade="BUY" data-symbol="${esc(x.symbol)}">Buy</button><button class="ghost-btn" data-broker-trade="SELL" data-symbol="${esc(x.symbol)}">Sell</button></div>
  <div class="broker-trade-row"><button class="ghost-btn" data-run-crown="${esc(x.symbol)}">Run Decision Review</button><button class="ghost-btn" data-asset="${esc(x.symbol)}">Asset detail</button><button class="ghost-btn" data-watch-toggle="${esc(x.symbol)}">${(state?.watchlist||[]).includes(x.symbol)?'★ Watching':'☆ Watch'}</button></div>
  <div class="two-col" style="margin-top:14px"><div class="panel market-insight-panel"><div class="eyebrow">KAIROS CONTEXT</div><h3>${esc(decision?.final?.status||'MARKET VIEW')}</h3><p class="report-text">${esc(decision?.final?.decision||decision?.final?.why?.[0]||marketContextInsight(x))}</p>${decision?gateBadge(decision.final?.final_gate):''}</div><div class="panel"><div class="eyebrow">WHAT TO WATCH</div>${(decision?.final?.what_changes_view||marketWatchText(x)).slice(0,6).map(v=>`<div class="insight-line">${esc(v)}</div>`).join('')}</div></div></div>`;
}


function softGateStrip(gate, rebuiltOnce){
  if(!gate && !rebuiltOnce) return `<div class="gate-soft"><button class="gate-soft-summary" data-gate-expand type="button"><span class="badge watch">Not run</span><span>Four-core gate · expand for details</span></button><div class="gate-soft-details hidden tiny">No gate result yet. Run Wallet Mirror, AI Mirror, or Decision Review to populate Passed / Rebuilt / Blocked.</div></div>`;
  const approved=!!gate?.approved;
  const blocked=gate && !approved;
  const label=approved?'Passed':(rebuiltOnce?'Rebuilt once':'Blocked');
  const cls=approved?'action':blocked?'abstain':'watch';
  const detail=[
    gate?.provider?`Provider: ${gate.provider}`:null,
    gate?.model?`Model: ${gate.model}`:null,
    gate?.reason||gate?.summary||null,
    gate?.findings?(Array.isArray(gate.findings)?gate.findings.join(' · '):String(gate.findings)):null
  ].filter(Boolean).join(' · ') || 'Core details unavailable.';
  return `<div class="gate-soft"><button class="gate-soft-summary" data-gate-expand type="button"><span class="badge ${cls}">${esc(label)}</span><span>Four-core / attack / audition · tap to expand</span></button><div class="gate-soft-details hidden tiny">${esc(detail)}</div></div>`;
}
function policyKnobRows(a={},b={}){
  const keys=['minConfidence','blockLowSourceQuality','requireAllAttacksPass','maxSingleAssetPctForAdd','preferAbstainWhenUnknowns'];
  return keys.map(k=>{
    const av=a?.[k], bv=b?.[k];
    const changed=String(av)!==String(bv);
    return `<div class="policy-compare-row ${changed?'changed':''}"><span>${esc(k)}</span><strong>${esc(av)}</strong><strong class="${changed?'green':''}">${esc(bv)}</strong></div>`;
  }).join('');
}
function feedTrustBadge(){
  const m=state.providers?.market;
  if(m?.verified) return `<span class="badge action">LICENSED FEED · VERIFIED</span>`;
  if(m?.configured) return `<span class="badge watch">LICENSED FEED · UNVERIFIED</span>`;
  return `<span class="badge watch">RESEARCH-GRADE FALLBACK</span>`;
}
function wordInitials(str=''){
  return String(str).split(/[^A-Za-z0-9]+/).filter(Boolean).map(w=>w[0]).join('').toLowerCase();
}
function subsequenceMatch(hay='', needle=''){
  let i=0; for(const ch of hay){ if(ch===needle[i]) i++; if(i>=needle.length) return true; } return false;
}
/** Fuzzy score: initials + prefix + label words. "qq"→QQQ, "bt"→BTC, "sp"→SPY, "gol"→Gold/GLD */
function fuzzyAssetScore(asset, qRaw){
  const q=String(qRaw||'').trim().toLowerCase();
  if(!q) return 0;
  const sym=String(asset.symbol||'').toLowerCase();
  const label=String(asset.label||'').toLowerCase();
  const kind=String(asset.kind||'').toLowerCase();
  const id=String(asset.id||'').toLowerCase();
  const desc=String(asset.description||'').toLowerCase();
  const labelInit=wordInitials(asset.label);
  const kindInit=wordInitials(asset.kind);
  let score=0;
  if(sym===q) score+=120;
  else if(sym.startsWith(q)) score+=95;
  else if(sym.includes(q)) score+=45;
  if(labelInit===q || labelInit.startsWith(q)) score+=75;
  if(kindInit===q || kindInit.startsWith(q)) score+=40;
  for(const w of label.split(/[^a-z0-9]+/).filter(Boolean)){
    if(w===q) score+=70;
    else if(w.startsWith(q)) score+=55;
    else if(w.includes(q)) score+=20;
  }
  if(id===q || id.startsWith(q)) score+=50;
  else if(id.includes(q)) score+=20;
  if(kind.includes(q)) score+=18;
  if(desc.includes(q)) score+=8;
  if(subsequenceMatch(sym,q)) score+=12;
  if(subsequenceMatch(label.replace(/\s+/g,''),q)) score+=8;
  return score;
}
function rankedUniverse(qRaw, list){
  const base=list||marketUniverse||[];
  const q=String(qRaw||'').trim();
  if(!q) return base.slice();
  return base.map(x=>({x,score:fuzzyAssetScore(x,q)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||String(a.x.symbol).localeCompare(String(b.x.symbol))).map(r=>r.x);
}
async function loadCryptoCatalog(q=brokerSearch,{append=false}={}){
  if(cryptoCatalogLoading) return; cryptoCatalogLoading=true;
  try{
    const offset=append?Number(cryptoCatalogMeta.offset||0)+Number(cryptoCatalogMeta.limit||100):0;
    const r=await api(`market-universe?category=crypto&q=${encodeURIComponent(String(q||'').trim())}&offset=${offset}&limit=100`,{timeoutMs:20000});
    cryptoCatalogMeta={total:Number(r.total||0),offset:Number(r.offset||0),limit:Number(r.limit||100),hasMore:!!r.hasMore,provider:r.provider||null,stale:!!r.stale};
    const incoming=Array.isArray(r.assets)?r.assets:[];
    const byId=new Map((marketUniverse||[]).map(x=>[x.id,x]));
    for(const x of incoming){ const prior=byId.get(x.id); byId.set(x.id,prior?{...x,...prior}:x); }
    marketUniverse=[...byId.values()];
  }catch(e){ if(brokerCategory==='Crypto') toast(e.message||'Crypto catalog unavailable.'); }
  finally{ cryptoCatalogLoading=false; }
}
async function resolveCryptoAsset(asset){
  if(!asset || categoryOfKind(asset.kind)!=='Crypto') return asset;
  if(asset.current?.price>0 && Array.isArray(asset.series) && asset.series.length>=2) return asset;
  try{
    const r=await api('market-universe',{method:'POST',body:JSON.stringify({action:'resolveCrypto',symbol:asset.symbol}),timeoutMs:30000});
    if(r?.asset){ const i=marketUniverse.findIndex(x=>x.id===r.asset.id); if(i>=0) marketUniverse[i]=r.asset; else marketUniverse.push(r.asset); return r.asset; }
  }catch(e){ toast(e.message||'Crypto market data unavailable.'); }
  return asset;
}
function filteredUniverse(){
  let list=marketUniverse||[];
  if(brokerCategory==='WATCH') { const wl=new Set((state?.watchlist||[]).map(x=>String(x).toUpperCase())); list=list.filter(x=>wl.has(String(x.symbol).toUpperCase())); }
  else if(brokerCategory && brokerCategory!=='ALL') list=list.filter(x=>categoryOfKind(x.kind)===brokerCategory);
  const q=String(brokerSearch||'').trim();
  if(!q) return list;
  return rankedUniverse(q, list);
}
function renderAssetPickList(){
  const q=String(brokerSearch||'').trim();
  if(q.length<1) return '';
  const picks=rankedUniverse(q, marketUniverse||[]).slice(0,8);
  if(!picks.length) return `<div class="asset-pick-list empty" role="listbox"><div class="asset-pick-empty">No assets match “${esc(q)}”. Try initials (qq, bt, sp) or a label word.</div></div>`;
  return `<div class="asset-pick-list" role="listbox" aria-label="Asset matches">${picks.map((x,i)=>{
    const ret=x.periodReturn;
    const chg=ret==null?'—':pct(ret);
    const chgCls=ret==null?'muted':ret>=0?'green':'red';
    return `<button type="button" class="asset-pick-row ${i===0?'best':''}" role="option" data-asset-pick="${esc(x.id)}" data-asset-pick-symbol="${esc(x.symbol)}"><div class="ap-sym">${esc(x.symbol)}</div><div class="ap-meta"><strong>${esc(x.label)}</strong><span>${esc(x.kind||'')}</span></div><div class="ap-price">${x.current?.price==null?'—':money(x.current.price)}</div><div class="ap-chg ${chgCls}">${chg}</div></button>`;
  }).join('')}</div>`;
}


function latestDrawdown(){
  if(state?.performance?.ready && Number.isFinite(Number(state.performance.maxDrawdown))) return Number(state.performance.maxDrawdown);
  const snaps=(state?.snapshots||[]).filter(x=>Number.isFinite(Number(x.portfolioValue))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if(snaps.length<2) return null;
  let peak=-Infinity,dd=0;
  for(const x of snaps){const v=Number(x.portfolioValue);peak=Math.max(peak,v);if(peak>0)dd=Math.min(dd,(v-peak)/peak)}
  return dd;
}
function profileCompleteness(){
  const p=state?.profile||{};
  const vals=[p.goal,p.targetAmount,p.horizon,p.riskStyle,p.contributionAmount,p.riskCapacity,p.maxDrawdownTolerance,p.liquidityNeed,p.emergencyReserveMonths,p.incomeStability];
  return Math.round(vals.filter(v=>v!==null&&v!==undefined&&String(v)!=='').length/vals.length*100);
}
function decisionPriority(d){
  const status=String(d?.final?.status||'').toUpperCase();
  const audit=String(d?.final?.audit_status||'').toUpperCase();
  if(audit==='BLOCKED'||status==='ABSTAIN') return {label:'REVIEW',cls:'review',rank:2};
  if(['ADD','REDUCE'].includes(status)) return {label:'MATERIAL',cls:'material',rank:1};
  if(status==='WATCH') return {label:'WATCH',cls:'watch',rank:3};
  return {label:'NO ACTION',cls:'quiet',rank:4};
}
function renderDecisionQueue(limit=4){
  const rows=(state?.decisions||[]).slice(0,12).map(d=>({d,p:decisionPriority(d)})).sort((a,b)=>a.p.rank-b.p.rank||String(b.d.createdAt||'').localeCompare(String(a.d.createdAt||''))).slice(0,limit);
  if(!rows.length) return `<div class="v7-empty"><strong>No audited decisions yet.</strong><span>Run Decision Review from Decisions or any Broker asset. KAIROS will not invent a queue.</span><button class="ghost-btn" data-go="insight" data-insight-pane="crown">Run first audit</button></div>`;
  return `<div class="v7-decision-list">${rows.map(({d,p})=>{const f=d.final||{};const why=f.decision||f.why?.[0]||'Stored audited decision';return `<button class="v7-decision-row" data-asset="${esc(d.asset)}"><span class="v7-priority ${p.cls}"></span><span class="v7-decision-main"><span class="v7-decision-meta"><b class="v7-priority-label ${p.cls}">${p.label}</b><span>${esc(d.asset)}</span><span>${esc(f.confidence||'UNKNOWN')}</span></span><strong>${esc(d.asset)} · ${esc(f.status||'UNKNOWN')}</strong><small>${esc(String(why).slice(0,130))}${String(why).length>130?'…':''}</small></span><span class="v7-chevron">›</span></button>`}).join('')}</div>`;
}
function renderWorldModelStrip(){
  const w=state?.worldState;
  if(!w) return `<div class="v7-empty compact"><strong>World model not built.</strong><span>Refresh market data to populate verified context.</span></div>`;
  const r=w.regime||{}, b=w.benchmarks||{};
  const dims=[
    ['TREND',r.trend||'Unknown'],['LIQUIDITY',r.liquidity||'Unknown'],['VOLATILITY',r.volatility||'Unknown'],
    ['US 10Y',Number.isFinite(Number(b.us10y_yield))?`${Number(b.us10y_yield).toFixed(2)}%`:'Unknown'],
    ['DXY',Number.isFinite(Number(b.dxy))?Number(b.dxy).toFixed(2):'Unknown'],['SESSION',w.market_session||'Unknown']
  ];
  return `<div class="v7-world-grid">${dims.map(([k,v])=>`<div class="v7-world-cell"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;
}
function renderNextContribution(){
  const amt=Number(state?.profile?.contributionAmount||0), freq=state?.profile?.contributionFrequency||'Monthly', ai=state?.aiMirror;
  const top=(ai?.status==='APPROVED'?(ai.allocation||[]):[]).slice().sort((a,b)=>Number(b.weight_pct||0)-Number(a.weight_pct||0)).slice(0,3);
  return `<div class="v7-contribution"><div><span class="v7-kicker">NEXT CONTRIBUTION</span><strong>${money(amt)}</strong><small>${esc(freq)} plan · allocation stays simulated until you apply it</small></div>${top.length?`<div class="v7-contrib-chips">${top.map(a=>`<span>${esc(a.symbol)} ${Number(a.weight_pct||0).toFixed(0)}%</span>`).join('')}</div>`:`<button class="ghost-btn" data-go="aimirror">Build AI allocation</button>`}</div>`;
}
function renderWhatChanged(){
  const w=state?.worldState, drivers=(w?.drivers||[]).slice(0,4);
  if(!drivers.length) return `<div class="v7-empty compact"><strong>No verified change drivers yet.</strong><span>Refresh the world state; KAIROS will not fabricate news.</span></div>`;
  return `<div class="v7-change-list">${drivers.map((d,i)=>{const u=safeHttpUrl(d.source_url||'');return `<article class="v7-change-row"><div class="v7-change-index">0${i+1}</div><div><span class="v7-impact ${esc(String(d.impact||'neutral').toLowerCase())}">${esc(String(d.impact||'neutral').toUpperCase())}</span><strong>${esc(d.title||'Market driver')}</strong><p>${esc(d.why||'')}</p><div class="v7-change-actions"><button type="button" class="tiny-btn" data-driver-ask="${i}">WHY</button>${u?`<a class="tiny-btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">EVIDENCE ↗</a>`:''}<button type="button" class="tiny-btn" data-go="insight">WHAT CHANGES VIEW</button></div></div></article>`}).join('')}</div>`;
}
function renderHome(){
  const p=state.portfolio.derived, w=state.worldState, goal=Number(state.profile.targetAmount||0);
  const progress=goal>0?Math.max(0,Math.min(100,Number(p.totalValue||0)/goal*100)):0;
  const dd=latestDrawdown(); const tol=Math.max(1,Number(state.profile.maxDrawdownTolerance||20))/100;
  const riskUsed=dd==null?null:Math.min(100,Math.abs(dd)/tol*100);
  const must=state.auth?.mustChangeDefault; const perf=state.performance;
  const trace=state.traceStatus||{}; const recent=(state.decisions||[]).slice(0,3);
  return `<section class="v7-screen v7-home">
    ${must?`<div class="alert warn must-change-banner"><strong>Security:</strong> change the initial password before shared use. <button class="tiny-btn" data-go="settings">Open Settings</button></div>`:''}
    <header class="v7-hero">
      <div><div class="v7-kicker">KAIROS PRIVATE · ${esc(String(w?.regime?.name||'WORLD MODEL BUILDING').toUpperCase())}</div><h1>Good ${greeting()}, ${esc((state.profile.name||'Principal').split(' ')[0])}.</h1><p>${w?.summary?esc(w.summary):'Your private decision system is ready. Refresh intelligence to build the verified market world state.'}</p><div class="v7-freshness"><span class="v7-live-dot ${w?'on':''}"></span>${w?`World state ${esc(w.date||'')} · ${esc(w.regime?.confidence||'unknown')} confidence`:'No world state yet'} · Trace ${trace.lastSuccessfulDate?`through ${esc(trace.lastSuccessfulDate)}`:'building'}</div></div>
      <div class="v7-hero-actions"><button class="primary-btn" id="homeDepositBtn">Add ${money(state.profile.contributionAmount||1000)}</button><button class="ghost-btn" id="homeAskHades"><svg class="inline-icon"><use href="#i-spark"/></svg> Ask KAIROS</button></div>
    </header>

    <div class="v7-metric-grid">
      <article class="v7-metric"><span>TOTAL VALUE</span><strong>${money(p.totalValue)}</strong><small>${p.positions.length} holdings · ${money(p.cash)} cash</small></article>
      <article class="v7-metric"><span>UNREALIZED P/L</span><strong class="${p.unrealizedPnL>=0?'green':'red'}">${money(p.unrealizedPnL)}</strong><small>Realized ${money(p.realizedPnL)}</small></article>
      <article class="v7-metric"><span>GOAL PROGRESS</span><strong>${progress.toFixed(0)}%</strong><div class="v7-meter"><i style="width:${progress}%"></i></div><small>${goal>0?`${money(p.totalValue)} of ${money(goal)}`:'Set a target in Profile'}</small></article>
      <article class="v7-metric"><span>RISK BUDGET</span><strong>${riskUsed==null?'—':riskUsed.toFixed(0)+'% used'}</strong><div class="v7-meter risk"><i style="width:${riskUsed==null?0:riskUsed}%"></i></div><small>${dd==null?'Needs performance history':`Drawdown ${pct(dd)} vs ${Number(state.profile.maxDrawdownTolerance||20).toFixed(0)}% tolerance`}</small></article>
      <article class="v7-metric"><span>PERFORMANCE</span><strong class="${perf?.ready&&perf.totalReturn>=0?'green':perf?.ready?'red':''}">${perf?.ready?pct(perf.totalReturn):'Building'}</strong><small>${perf?.ready?`Max DD ${pct(perf.maxDrawdown)}`:`${state.snapshots?.length||0} recorded snapshots`}</small></article>
      <article class="v7-metric"><span>DIGITAL TWIN</span><strong>${profileCompleteness()}%</strong><div class="v7-meter blue"><i style="width:${profileCompleteness()}%"></i></div><small>${esc(state.profile.riskStyle)} · ${esc(state.profile.horizon)}</small></article>
    </div>

    <div class="v7-home-grid">
      <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">DECISION QUEUE · RANKED BY MATERIALITY</span><h2>What deserves attention</h2></div><button class="tiny-btn" data-go="insight">View all</button></div>${renderDecisionQueue(4)}</section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">NEXT CONTRIBUTION</span><h2>Deploy with intent</h2></div></div>${renderNextContribution()}</section>
      <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">WHAT CHANGED TODAY</span><h2>Evidence before action</h2></div><button class="tiny-btn" id="marketRefreshDash">Refresh</button></div>${renderWhatChanged()}</section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">MARKET WORLD MODEL</span><h2>${esc(w?.regime?.name||'Unclassified')}</h2></div>${feedTrustBadge()}</div>${renderWorldModelStrip()}</section>
      <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">PORTFOLIO ALLOCATION</span><h2>Your Wallet Mirror</h2></div><button class="tiny-btn" data-go="wallet">Open Wallet</button></div>${p.positions.length?allocation():`<div class="v7-empty compact"><strong>No holdings yet.</strong><span>Add simulated cash and paper-buy in Broker.</span><button class="ghost-btn" data-go="broker">Open Broker</button></div>`}</section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">RECENT DECISION TRACES</span><h2>Audit memory</h2></div><button class="tiny-btn" data-go="insight" data-insight-pane="trace">Decision History</button></div><div class="v7-trace-list">${recent.length?recent.map(d=>`<button data-asset="${esc(d.asset)}"><span>${esc(String(d.id||'').slice(0,8).toUpperCase())} · ${esc(d.asset)}</span><strong>${esc(d.final?.status||'UNKNOWN')}</strong><small>${esc(d.date||'')}</small></button>`).join(''):`<div class="v7-empty compact"><span>No decision traces yet.</span></div>`}</div></section>
    </div>
  </section>`;
}

function renderTraceLabBody(){
  const t=state.traceStatus||{}, snaps=(state.snapshots||[]).slice().reverse().slice(0,10), ds=(state.decisions||[]).slice(0,10);
  const evo=state.evolution||{};
  return `<div class="v7-trace-summary">
    <div class="v7-metric-grid compact"><article class="v7-metric"><span>LAST TRACE</span><strong>${esc(t.lastSuccessfulDate||'None')}</strong><small>${t.catchupRunning?'Recovery running':'Daily memory'}</small></article><article class="v7-metric"><span>SNAPSHOTS</span><strong>${state.snapshots?.length||0}</strong><small>Portfolio history</small></article><article class="v7-metric"><span>DECISIONS</span><strong>${state.decisions?.length||0}</strong><small>Audited memory</small></article><article class="v7-metric"><span>CHAMPION</span><strong>${esc(evo.champion?.version||'1.0.0')}</strong><small>${esc(evo.champion?.name||'Baseline Decision Review')}</small></article></div>
    ${t.lastError?`<div class="alert bad"><strong>Trace error</strong><div class="tiny">${esc(t.lastError)}</div></div>`:''}
    <div class="two-col"><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">PORTFOLIO MEMORY</span><h2>Recent snapshots</h2></div></div><div class="v7-trace-table">${snaps.length?snaps.map(x=>`<div><span>${esc(x.date)}</span><strong>${money(x.portfolioValue)}</strong><small>${x.completeMarks===false?'marks incomplete':'marks complete'}</small></div>`).join(''):`<div class="v7-empty compact"><span>No snapshots yet.</span></div>`}</div></section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">DECISION MEMORY</span><h2>Recent audited traces</h2></div></div><div class="v7-trace-table">${ds.length?ds.map(d=>`<button data-asset="${esc(d.asset)}"><span>${esc(d.date)} · ${esc(d.asset)}</span><strong>${esc(d.final?.status||'UNKNOWN')}</strong><small>${esc(d.final?.audit_status||'')}</small></button>`).join(''):`<div class="v7-empty compact"><span>No decision traces yet.</span></div>`}</div></section></div>
  </div>`;
}

function renderInsight(){
  if(!['queue','crown','evolution','trace'].includes(insightPane)) insightPane='queue';
  const panes=[['queue','Decision Center'],['crown','Decision Review'],['evolution','Learning Lab'],['trace','Decision History']];
  const tabs=`<div class="subtabs insight-subtabs v7-tabs">${panes.map(([k,l])=>`<button class="tab-btn ${insightPane===k?'active':''}" data-insight-pane="${k}">${l}</button>`).join('')}</div>`;
  if(insightPane==='evolution') return `<section class="v7-screen"><header class="v7-page-head"><div><div class="v7-kicker">DECISIONS · LEARNING</div><h1>Observe. Diagnose. Challenge. Prove.</h1><p>KAIROS learns from matured outcomes, but no challenger replaces the champion without holdout evidence and your approval.</p></div><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button></header>${tabs}${renderEvolutionLabBody()}</section>`;
  if(insightPane==='crown') return `<section class="v7-screen"><header class="v7-page-head"><div><div class="v7-kicker">DECISIONS · DECISION REVIEW</div><h1>Evidence → specialists → attacks → final gate.</h1><p>Run an asset through the complete audited decision pipeline. Rejected work stays rejected.</p></div><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button></header>${tabs}${renderBrokerDecisionsBody()}</section>`;
  if(insightPane==='trace') return `<section class="v7-screen"><header class="v7-page-head"><div><div class="v7-kicker">DECISIONS · DECISION HISTORY</div><h1>Institutional memory, not vibes.</h1><p>Every stored world state, portfolio snapshot and audited decision becomes evidence for future evaluation.</p></div><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button></header>${tabs}${renderTraceLabBody()}</section>`;

  const m=state.walletMirror, crown=state.decisions?.[0]?.final, w=state.worldState;
  const latest=state.decisions?.[0];
  const evidenceUrls=(latest?.evidenceSnapshot?.assetEvidence?._meta?.citations||latest?.evidenceSnapshot?.worldState?._meta?.citations||[]).map(c=>safeHttpUrl(c?.url||c)).filter(Boolean).slice(0,4);
  const changes=(latest?.final?.what_changes_view||w?.risks||[]).slice(0,5);
  return `<section class="v7-screen"><header class="v7-page-head"><div><div class="v7-kicker">DECISION CENTER</div><h1>Know what matters. Know why.</h1><p>KAIROS ranks stored decisions, exposes the evidence, shows what could change the view, and keeps the learning loop auditable.</p></div><div class="action-row"><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button><button class="primary-btn" data-insight-pane="crown">Run Decision Review</button></div></header>
  ${tabs}
  <div class="v7-home-grid decision-center-grid">
    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">DECISION QUEUE</span><h2>Ranked by materiality</h2></div><span class="badge ${state.decisions?.length?'action':'watch'}">${state.decisions?.length||0} STORED</span></div>${renderDecisionQueue(8)}</section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">LATEST FINAL GATE</span><h2>${esc(crown?.status||'Not run')}</h2></div>${gateBadge(crown?.final_gate)}</div><p class="report-text">${esc(crown?.decision||crown?.why?.[0]||'Run Decision Review to create an audited decision.')}</p>${latest?`<button class="ghost-btn" data-asset="${esc(latest.asset)}">Open full trace</button>`:''}</section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">WALLET COACHING</span><h2>${esc(m?.summary||m?.portfolio_outlook||'Not audited')}</h2></div></div><p class="report-text">${esc(m?.next_contribution||m?.portfolio_report||'Audit Wallet Mirror to produce portfolio-specific coaching.')}</p><button class="ghost-btn" id="runWalletMirrorBtn">Audit my wallet</button></section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">WHY</span><h2>Current thesis</h2></div></div><p class="report-text">${esc(crown?.why?.[0]||w?.summary||'No audited thesis yet.')}</p></section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">EVIDENCE</span><h2>Source trail</h2></div></div>${evidenceUrls.length?`<div class="v7-source-list">${evidenceUrls.map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Evidence ${i+1}<span>↗</span></a>`).join('')}</div>`:`<div class="v7-empty compact"><span>No directly surfaced source URLs in the latest stored decision.</span></div>`}</section>
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">WHAT CHANGES THIS VIEW</span><h2>Invalidation conditions</h2></div></div>${changes.length?`<div class="v7-condition-list">${changes.map(x=>`<div><span></span><p>${esc(x)}</p></div>`).join('')}</div>`:`<div class="v7-empty compact"><span>No stored invalidation conditions yet.</span></div>`}</section>
    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">MARKET WORLD MODEL</span><h2>${esc(w?.regime?.name||'Unclassified')}</h2></div><button class="tiny-btn" id="marketRefreshBtn">Refresh evidence</button></div>${renderWorldModelStrip()}</section>
  </div></section>`;
}

function renderBrokerDecisionsBody(){
  const assets=universeSymbolSet(), ds=(state.decisions||[]).filter(d=>decisionWithin(d,decisionRange)), w=state.worldState;
  return `<div class="two-col"><div class="panel"><div class="eyebrow">RUN Decision Review</div><div class="action-row" style="margin-top:12px"><select id="decisionAsset" class="select" style="max-width:260px">${assets.map(a=>`<option>${esc(a)}</option>`).join('')}</select><button class="primary-btn" id="runDecisionBtn">Run full Decision Review</button></div><label class="tiny"><input type="checkbox" id="forceMarketRefresh"> refresh market evidence first</label><div class="subtabs" style="margin-top:14px">${[['today','Today'],['week','Week'],['month','Month'],['all','All']].map(([k,l])=>`<button class="tab-btn ${decisionRange===k?'active':''}" data-decision-range="${k}">${l}</button>`).join('')}</div></div><div class="panel"><div class="eyebrow">RESEARCH STATE</div>${w?`<h3>${esc(w.regime?.name||'Unclassified')}</h3><p>${esc(w.summary||'')}</p><div class="mirror-tags"><span>${esc(w.regime?.trend||'trend unknown')}</span><span>${esc(w.regime?.volatility||'vol unknown')}</span><span>${esc(w.regime?.liquidity||'liquidity unknown')}</span></div><button class="ghost-btn" id="marketRefreshBtn" style="margin-top:12px">Refresh evidence</button>`:`<div class="alert warn">No market world state yet. Refresh evidence before running Decision Review.</div>`}</div></div>
  <div class="panel"><div class="section-title"><div><h3>Audited Decisions</h3><p>Released decisions are stored with attack results, gate metadata and future outcome checkpoints.</p></div></div><div class="decision-list">${ds.length?ds.map(decisionCard).join(''):'<div class="alert warn">No audited decisions in this range.</div>'}</div></div>
  ${w?`<div class="panel"><div class="section-title"><div><h3>Evidence & Drivers</h3><p>Research context used by the decision system.</p></div></div>${marketWorld(w)}</div>`:''}`;
}
function renderEvolutionLabBody(){
  const e=state.evolution||{}, ch=e.champion||{}, cc=e.challenger, m=ch.metrics||{}, d=e.diagnosis||{};
  const split=e.split||{};
  const matured=Number(split.maturedCount??m.maturedCount??m.sample??d.sample??0);
  const threshold=Number(split.threshold||8);
  const live=matured>=threshold;
  const holdoutM=m.holdout||m;
  const challHold=cc?.metrics?.holdout||cc?.metrics||{};
  const insuff=!live;
  return `<div class="action-row"><button class="primary-btn" id="runEvolutionBtn">Run Evolution Cycle</button>${live?'':`<span class="badge watch">NOT LIVE — not enough data</span>`}</div>
  <div class="panel premium-card evo-progress"><div class="row"><div><div class="eyebrow">MATURITY</div><h3>${matured} / ${threshold} scored ADD/REDUCE outcomes</h3><p class="tiny">Promotion eligibility requires a holdout win (earlier time slice). Recent slice inspires diagnosis only.</p></div><div class="progress-ring-label"><strong>${Math.min(100,Math.round(matured/threshold*100))}%</strong></div></div><div class="status-line" style="margin-top:10px"><span style="width:${Math.min(100,matured/threshold*100)}%"></span></div></div>
  ${insuff?`<div class="alert warn"><strong>INSUFFICIENT_DATA</strong> — Need ${threshold} matured scored outcomes before live promotion. You can still view diagnosis in sandbox mode; KAIROS will not claim a live challenger win.</div>`:''}
  <div class="evolution-loop"><div class="evo-node active"><b>1</b><span>Observe</span></div><i>→</i><div class="evo-node"><b>2</b><span>Diagnose</span></div><i>→</i><div class="evo-node"><b>3</b><span>Challenge</span></div><i>→</i><div class="evo-node"><b>4</b><span>Holdout test</span></div><i>→</i><div class="evo-node"><b>5</b><span>Human promote</span></div><i>↻</i></div>
  <div class="two-col"><div class="panel gold-panel premium-card"><div class="row"><div><div class="eyebrow">CURRENT CHAMPION</div><h3>${esc(ch.name||'Baseline Decision Review')}</h3></div><span class="badge action">PRODUCTION</span></div><div class="cards-3"><div class="card"><strong>${holdoutM.sample||0}</strong><div class="tiny">Holdout sample</div></div><div class="card"><strong>${metricPct(holdoutM.hitRate)}</strong><div class="tiny">Holdout hit rate</div></div><div class="card"><strong>${holdoutM.score==null?'N/A':Number(holdoutM.score).toFixed(3)}</strong><div class="tiny">Holdout score</div></div></div><div class="policy-grid">${Object.entries(ch.policy||{}).filter(([k])=>k!=='description').map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div><p>${esc(ch.policy?.description||'')}</p></div>
  <div class="panel premium-card"><div class="row"><div><div class="eyebrow">CHALLENGER</div><h3>${esc(cc?.name||'No eligible challenger')}</h3></div><span class="badge ${cc?.status==='ELIGIBLE'?'watch':cc?.status==='PROMOTED'?'action':'noaction'}">${esc(cc?.status||'WAITING')}</span></div>${cc?`<p>${esc(cc.hypothesis||'')}</p><div class="cards-3"><div class="card"><strong>${metricPct(challHold.hitRate??cc.holdoutHitRate)}</strong><div class="tiny">Holdout hit rate</div></div><div class="card"><strong>${metricPct(challHold.coverage)}</strong><div class="tiny">Holdout coverage</div></div><div class="card"><strong class="${Number(cc.improvement||cc.holdoutImprovement||0)>0?'green':'red'}">${Number(cc.improvement||cc.holdoutImprovement||0).toFixed(3)}</strong><div class="tiny">Holdout Δ vs champion</div></div></div>`:`<div class="alert warn">KAIROS needs enough matured ADD/REDUCE outcomes before it can test a challenger honestly on holdout.</div>`}</div></div>
  ${cc?.status==='ELIGIBLE' && cc?.better?`<div class="panel premium-card promote-card"><div class="eyebrow">HUMAN PROMOTE CARD</div><h3>Review before promoting</h3><p class="tiny">Auto-promote is OFF by default. Promote only if holdout improvement is honest.</p>
  <div class="policy-compare"><div class="policy-compare-head"><span>Knob</span><strong>Champion</strong><strong>Challenger</strong></div>${policyKnobRows(ch.policy||{}, cc.policy||{})}</div>
  <div class="cards-4" style="margin-top:12px"><div class="card"><strong>${holdoutM.sample||0}</strong><div class="tiny">Champion holdout n</div></div><div class="card"><strong>${challHold.sample||0}</strong><div class="tiny">Challenger holdout n</div></div><div class="card"><strong>${metricPct(holdoutM.hitRate)}</strong><div class="tiny">Champion hit rate</div></div><div class="card"><strong class="green">${metricPct(challHold.hitRate??cc.holdoutHitRate)}</strong><div class="tiny">Challenger hit rate</div></div></div>
  <div class="action-row" style="margin-top:14px"><button class="primary-btn" id="promoteEvolutionBtn">Promote</button><button class="ghost-btn" id="discardEvolutionBtn">Discard</button></div></div>`:''}
  <div class="two-col"><div class="panel"><div class="eyebrow">FAILURE DIAGNOSIS ${insuff?'(sandbox)':'(inspire slice)'}</div><div class="cards-4"><div class="card"><strong>${d.sample||0}</strong><div class="tiny">Measured</div></div><div class="card"><strong>${d.misses||0}</strong><div class="tiny">Misses</div></div><div class="card"><strong>${d.lowConfidenceMisses||0}</strong><div class="tiny">Low-conf misses</div></div><div class="card"><strong>${d.highUnknownMisses||0}</strong><div class="tiny">High-unknown misses</div></div></div></div><div class="panel"><div class="eyebrow">ALWAYS ON</div><p class="report-text">Learning Lab runs automatically after the daily Decision History job (~23:30 UTC) — no login required. Challengers are proposed when enough matured decisions exist. <strong>Promotion stays manual</strong> (Promote / Discard) so a weak policy never silently replaces the champion.</p><div class="tiny" style="margin-top:10px">Always on · ~daily with Decision History · human promote only · holdout benchmark required.</div></div></div>
  <div class="panel"><div class="section-title"><div><h3>Evolution History</h3><p>Promotion and rejection trail.</p></div></div><div class="timeline">${(e.history||[]).slice().reverse().slice(0,20).map(h=>`<div class="timeline-row"><span>${esc(String(h.at||'').slice(0,19).replace('T',' '))}</span><strong>${esc(h.event||'')}</strong><small>${h.improvement!=null?`Δ ${Number(h.improvement).toFixed(3)}`:esc(h.reason||'')}</small></div>`).join('')||'<div class="alert warn">No evolution cycles recorded yet.</div>'}</div></div>`;
}



function orderStatusClass(status=''){ const s=String(status).toUpperCase(); return s==='FILLED'?'action':s==='OPEN'?'watch':s==='REJECTED'?'abstain':'noaction'; }
function orderTargetLabel(o){
  if(o.status==='FILLED'&&o.fillPrice) return `Filled ${money(o.fillPrice)}`;
  const type=String(o.orderType||'MARKET').toUpperCase();
  if(type==='STOP_LIMIT') return `Stop ${money(o.stopPrice)} → Limit ${money(o.limitPrice)}`;
  if(type==='LIMIT') return `Limit ${money(o.limitPrice)}`;
  if(type==='STOP') return `Stop ${money(o.stopPrice)}`;
  return 'Market';
}
function renderPaperOrders(){
  const rows=(state?.paperOrders||[]).slice().reverse();
  const open=rows.filter(o=>o.status==='OPEN');
  const recent=rows.filter(o=>o.status!=='OPEN').slice(0,6);
  const row=o=>`<div class="v7-order-row"><div><strong>${esc(o.symbol)} · ${esc(o.side)}</strong><small>${esc(String(o.orderType||'MARKET').replaceAll('_',' '))} · ${Number(o.quantity||0).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')} shares${o.triggered?' · stop triggered':''}</small></div><div class="v7-order-price"><strong>${esc(orderTargetLabel(o))}</strong><small>${esc(o.status||'')}</small></div><span class="badge ${orderStatusClass(o.status)}">${esc(o.status||'')}</span>${o.status==='OPEN'?`<button class="tiny-btn" data-cancel-order="${esc(o.id)}">Cancel</button>`:''}</div>`;
  return `<section class="v7-card broker-orders-card"><div class="v7-section-head"><div><span class="v7-kicker">PAPER ORDER BOOK</span><h2>Open orders ${open.length?`· ${open.length}`:''}</h2></div><small>LIMIT / STOP orders fill only from fresh stored marks</small></div>${open.length?`<div class="v7-order-list">${open.map(row).join('')}</div>`:`<div class="v7-empty compact"><span>No open orders.</span></div>`}${recent.length?`<details class="v7-order-history"><summary>Recent fills / cancellations</summary><div class="v7-order-list">${recent.map(row).join('')}</div></details>`:''}</section>`;
}
function renderBrokerHome(){
  const p=state.portfolio.derived, goal=Number(state.profile.targetAmount||0), progress=goal>0?Math.min(100,p.totalValue/goal*100):0;
  const crown=state.decisions?.[0]?.final, filtered=filteredUniverse(), briefDate=(state.worldState?.date||new Date().toISOString().slice(0,10));
  const openOrders=(state.paperOrders||[]).filter(o=>o.status==='OPEN').length;
  return `<section class="v7-screen broker-screen v7-broker">
    <header class="v7-page-head"><div><div class="v7-kicker">KAIROS BROKER · PAPER EXECUTION</div><h1>Markets, without the clutter.</h1><p>Fresh market marks feed paper Market / Limit / Stop orders. No real securities orders are sent.</p></div><div class="action-row"><span class="v7-buying-power">Buying power <strong>${money(p.cash)}</strong></span><button class="primary-btn" id="brokerDepositBtn">Add cash</button></div></header>
    <div class="broker-tool-row v7-searchbar"><div class="broker-search-row asset-pick-wrap search-pill-row grow"><input id="brokerSearchInput" class="text-input search-pill" type="search" placeholder="Search Apple, AAPL, Bitcoin, BTC…" value="${esc(brokerSearch)}" autocomplete="off" spellcheck="false" aria-autocomplete="list">${renderAssetPickList()}</div><button class="ghost-btn" id="marketRefreshDashEmpty">Refresh prices</button></div>
    ${renderMarketCollections()}
    <section class="v7-card v7-pulse-card"><div class="v7-section-head"><div><span class="v7-kicker">MARKET PULSE</span><h2>Largest recorded moves in your universe</h2></div><span class="tiny">Verified / recorded observations only</span></div>${renderMarketPulse()}</section>
    ${categoryChips()}

    <div class="v7-broker-overview">
      <section class="v7-card"><span class="v7-kicker">SIMULATED WALLET</span><strong class="v7-broker-value">${money(p.totalValue)}</strong><div class="v7-inline-stats"><span class="${p.unrealizedPnL>=0?'green':'red'}">${money(p.unrealizedPnL)} P/L</span><span>${p.positions.length} holdings</span><span>${openOrders} open orders</span></div><div class="v7-meter"><i style="width:${progress}%"></i></div><small>${goal>0?`${progress.toFixed(0)}% of ${money(goal)} goal`:'Set a target in Profile'}</small></section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">Decision Review · LATEST</span><h2>${esc(crown?.status||'No decision')}</h2></div>${gateBadge(crown?.final_gate)}</div><p class="report-text">${esc(crown?.decision||crown?.why?.[0]||'Run an asset through Decision Review before treating a market idea as audited.')}</p><button class="ghost-btn" data-go="insight" data-insight-pane="crown">Open Decision Review</button></section>
    </div>

    <div class="broker-section-head tight"><div><div class="v7-kicker">MARKET BOARD</div><h2>${filtered.length} instruments</h2></div>${feedTrustBadge()}</div>
    <div class="mkt-stack mkt-grid-dense v7-market-grid">${filtered.length?filtered.map(universeCard).join(''):`<div class="v7-empty"><strong>${brokerCategory==='WATCH'?'Your watchlist is empty.':'No instruments match.'}</strong><span>${brokerCategory==='WATCH'?'Tap ☆ on any market card to build it.':'Clear search/category and try again.'}</span></div>`}</div>
    ${brokerCategory==='Crypto'?`<div class="crypto-catalog-foot"><span class="tiny">${cryptoCatalogMeta.total?`${Math.min((marketUniverse||[]).filter(x=>categoryOfKind(x.kind)==='Crypto').length,cryptoCatalogMeta.total)} of ${cryptoCatalogMeta.total.toLocaleString()} USD crypto pairs loaded`:cryptoCatalogLoading?'Loading crypto catalog…':'Crypto catalog loads from the licensed provider.'}</span>${cryptoCatalogMeta.hasMore?`<button class="ghost-btn" id="loadMoreCryptoBtn">Load more crypto</button>`:''}</div>`:''}

    ${selectedMarketId?`<div class="broker-section-head tight"><div><div class="v7-kicker">SELECTED MARKET</div><h2>Inspect · audit · paper trade</h2></div><button class="ghost-btn" id="addOpeningBtn">Import opening position</button></div>${renderBrokerMarketPanel()}`:''}
    ${renderPaperOrders()}

    <div class="mirror-launch-grid dense-launch v7-launch-grid"><button class="mirror-launch" data-go="wallet"><span class="mirror-icon">W</span><div><strong>Wallet Mirror</strong><p>What you own</p></div><b>→</b></button><button class="mirror-launch" data-go="aimirror"><span class="mirror-icon">AI</span><div><strong>AI Mirror</strong><p>What KAIROS would own</p></div><b>→</b></button><button class="mirror-launch" data-go="performance"><span class="mirror-icon">↗</span><div><strong>Performance</strong><p>Who made better decisions?</p></div><b>→</b></button></div>
    <div class="v7-trust-strip"><div><span class="v7-kicker">DATA TRUST</span><strong>${state.providers?.market?.verified?'Licensed market feed · verified':state.providers?.market?.configured?'Licensed feed configured · unverified':'Research-grade fallback only'}</strong></div>${feedTrustBadge()}</div>
  </section>`;
}

function renderMirrorComparison(ai){
  const p=state.portfolio?.derived||{}, total=Math.max(1,Number(p.totalValue||0));
  const you=Object.fromEntries((p.positions||[]).map(x=>[String(x.symbol).toUpperCase(),Number(x.marketValue||0)/total*100]));
  const kairos=Object.fromEntries((ai?.allocation||[]).map(x=>[String(x.symbol).toUpperCase(),Number(x.weight_pct||0)]));
  const rows=[...new Set([...Object.keys(you),...Object.keys(kairos)])].map(sym=>({sym,you:you[sym]||0,kairos:kairos[sym]||0})).map(x=>({...x,delta:x.kairos-x.you})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,7);
  if(!rows.length) return '';
  return `<div class="v7-compare-table"><div class="v7-compare-head"><span>Asset</span><span>You</span><span>KAIROS</span><span>Δ</span></div>${rows.map(x=>`<div><strong>${esc(x.sym)}</strong><span>${x.you?x.you.toFixed(1)+'%':'—'}</span><span>${x.kairos?x.kairos.toFixed(1)+'%':'—'}</span><b class="${x.delta>1?'green':x.delta<-1?'red':'muted'}">${x.delta>=0?'+':''}${x.delta.toFixed(1)}pt</b></div>`).join('')}</div>`;
}

function renderAIMirror(){
  const m=state.aiMirror, walletCapital=Math.max(0,Number(state.portfolio?.derived?.totalValue||0));
  const budget=Number(walletCapital>0?walletCapital:(m?.budget||state.profile.contributionAmount||1000));
  const approved=m?.status==='APPROVED'; const blocked=m?.status==='BLOCKED';
  const result=!m?`<div class="v7-empty mirror-empty"><div class="mirror-icon big">AI</div><strong>No AI Mirror yet.</strong><span>Give KAIROS the same profile and capital, then compare its audited allocation against your Wallet Mirror.</span></div>`:blocked?`<div class="mirror-reject-panel v7-reject"><div class="v7-section-head"><div><span class="v7-kicker">FINAL GATE</span><h2>Mirror withheld</h2></div>${gateBadge(m.gate)}</div><p>${esc(m.rejectionSummary||m.report||'KAIROS rejected the candidate instead of releasing a weak model portfolio.')}</p>${formatRejectReasons(m).length?`<ul>${formatRejectReasons(m).map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}<div class="tiny">Refresh market evidence or check Provider Health before retrying. Rejection is never softened into approval.</div></div>`:`<div class="v7-ai-result"><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">APPROVED SHADOW PORTFOLIO</span><h2>${money(m.budget||budget)} · ${esc(m.focus==='all'?'Whole Portfolio':m.focus||'Market Lab')}</h2></div><div class="action-row">${gateBadge(m.gate)}<button class="primary-btn" id="applyMirrorWalletBtn">Apply to Wallet · Paper</button></div></div><p class="report-text">${esc(m.stance_summary||m.report||'')}</p><div class="mirror-allocation-grid v7-allocation-grid">${(m.allocation||[]).map(a=>`<div class="allocation-card"><div class="row"><div><strong>${esc(a.symbol)}</strong><span class="tiny">${esc(a.asset_class||'')}</span></div><strong>${Number(a.weight_pct||0).toFixed(1)}%</strong></div><div class="allocation-amount">${money(a.amount)}</div><div class="status-line"><span style="width:${Math.max(0,Math.min(100,Number(a.weight_pct||0)))}%"></span></div><div class="mirror-tags"><span>${esc(a.outlook||'UNKNOWN')}</span><span>${esc(a.confidence||'LOW')}</span></div><p>${esc((a.why||[]).join(' · '))}</p></div>`).join('')}</div></section><div class="two-col"><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">YOU vs KAIROS</span><h2>Allocation differences</h2></div><button class="tiny-btn" data-go="performance">Performance →</button></div>${renderMirrorComparison(m)}</section><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">SCENARIO MAP</span><h2>What could happen</h2></div></div><div class="scenario-row"><strong>Base</strong><p>${esc(m.scenario?.base||'Not supplied')}</p></div><div class="scenario-row"><strong>Bull</strong><p>${esc(m.scenario?.bull||'Not supplied')}</p></div><div class="scenario-row"><strong>Bear</strong><p>${esc(m.scenario?.bear||'Not supplied')}</p></div></section></div><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">FULL REPORT</span><h2>Audit-ready rationale</h2></div></div><p class="report-text">${esc(m.report||'')}</p>${m.unknowns?.length?`<div class="alert warn">Unknowns: ${esc(m.unknowns.join(' · '))}</div>`:''}</section></div>`;
  return `<section class="v7-screen v7-ai-mirror"><header class="v7-page-head"><div><div class="v7-kicker">AI MIRROR · SHADOW PORTFOLIO</div><h1>Same person. Same capital. KAIROS makes the choices.</h1><p>Your Wallet is what you chose. AI Mirror is what KAIROS would choose under the same profile, capital and constraints.</p></div>${gateBadge(m?.gate)}</header>
    <div class="mirror-identity-strip premium-card v7-dna-strip"><span>CAPITAL <strong>${money(budget)}</strong></span><span>CONTRIBUTION <strong>${money(state.profile.contributionAmount||0)} · ${esc(state.profile.contributionFrequency||'Monthly')}</strong></span><span>RISK <strong>${esc(state.profile.riskStyle)}</strong></span><span>HORIZON <strong>${esc(state.profile.horizon)}</strong></span><span>LIQUIDITY <strong>${esc(state.profile.liquidityNeed||'—')}</strong></span></div>
    <div class="v7-mirror-command v7-card"><div><span class="v7-kicker">MIRROR COMMAND</span><h2>Build the audited shadow portfolio</h2><p>Candidate → deterministic checks → specialist attacks → critic → strict final judge. One rebuild maximum.</p></div><div class="mirror-control v7-control"><div class="field"><label>Mirrored capital</label><input id="aiMirrorBudget" class="text-input" type="number" min="1" step="1" value="${budget}"></div><div class="field"><label>Scope</label><select id="aiMirrorFocus" class="select"><option value="all">Whole Portfolio · all markets</option>${marketUniverse.map(x=>`<option value="${esc(x.id)}" ${mirrorFocus===x.id?'selected':''}>${esc(x.label)} · ${esc(x.symbol)}</option>`).join('')}</select></div><div class="ai-primary-ctas"><button class="primary-btn large-cta" id="runAIMirrorWholeBtn">Build Whole Portfolio</button><button class="ghost-btn large-cta" id="runAIMirrorBtn">Build Selected Lab</button></div></div></div>
    ${result}
    <details class="v7-card v7-market-labs" ${!approved&&!blocked?'open':''}><summary id="marketLabsAnchor"><span><span class="v7-kicker">MARKET LABS</span><strong>Restrict KAIROS to one market</strong></span><b>Explore</b></summary>${marketSwitcher(mirrorFocus,true)}<div class="broker-market-grid ai-lab-grid">${marketUniverse.map(x=>`<button class="broker-asset-card ${mirrorFocus===x.id?'selected-lab':''}" data-ai-lab="${esc(x.id)}"><div class="asset-card-top"><div class="symbol-orb ticker-orb">${esc(x.symbol)}</div><div class="asset-title"><strong class="ticker-primary">${esc(x.symbol)}</strong><span>${esc(x.label)} · ${esc(x.kind)}</span></div><div class="asset-price"><strong>${x.current?.price==null?'—':money(x.current.price)}</strong><span>${x.periodReturn==null?'History building':pct(x.periodReturn)}</span></div></div>${sparkline(x.series,x.periodReturn!=null&&x.periodReturn<0?'#FF5A5A':'#1B4C93')}<div class="asset-card-foot"><span>Select ${esc(x.symbol)} Lab</span><span>→</span></div></button>`).join('')}</div></details>
  </section>`;
}

function renderWalletMirror(){
  const p=state.portfolio.derived,m=state.walletMirror;
  const nextMove=m?.next_contribution||m?.summary||(!p.positions.length?'Add simulated cash and paper-buy an asset in Broker.':'Run Audit my wallet for the next coached move.');
  const rebuilt=!!(m?.gate && m?.status==='APPROVED');
  const total=Math.max(1,Number(p.totalValue||0));
  const largest=(p.positions||[]).slice().sort((a,b)=>Number(b.marketValue||0)-Number(a.marketValue||0))[0];
  const cashPct=Number(p.cash||0)/total*100;
  return `<section class="v7-screen v7-wallet">
    <header class="v7-page-head"><div><div class="v7-kicker">WALLET MIRROR · YOUR DECISIONS</div><h1>Your portfolio, without guesswork.</h1><p>Every paper trade flows into one ledger. KAIROS can audit it, but your Wallet Mirror always remains the record of what you chose.</p></div><div class="action-row"><button class="ghost-btn" data-go="broker">Open Broker</button><button class="ghost-btn" id="addOpeningBtn">Import position</button><button class="primary-btn" id="runWalletMirrorBtn">Audit my wallet</button></div></header>
    ${!p.positions.length?`<div class="v7-empty"><strong>Your Wallet Mirror has no holdings yet.</strong><span>Add simulated cash, then choose an asset in Broker and place a paper order. Nothing is pre-populated or fabricated.</span><button class="primary-btn" data-go="broker">Open Broker</button></div>`:''}
    <div class="v7-metric-grid wallet-metrics">
      <article class="v7-metric"><span>TOTAL VALUE</span><strong>${money(p.totalValue)}</strong><small>${p.positions.length} holdings</small></article>
      <article class="v7-metric"><span>CASH</span><strong>${money(p.cash)}</strong><small>${cashPct.toFixed(1)}% of wallet</small></article>
      <article class="v7-metric"><span>UNREALIZED P/L</span><strong class="${p.unrealizedPnL>=0?'green':'red'}">${money(p.unrealizedPnL)}</strong><small>Realized ${money(p.realizedPnL)}</small></article>
      <article class="v7-metric"><span>LARGEST POSITION</span><strong>${largest?esc(largest.symbol):'—'}</strong><small>${largest?`${(Number(largest.marketValue||0)/total*100).toFixed(1)}% · ${money(largest.marketValue)}`:'No holdings'}</small></article>
      <article class="v7-metric accent-blue"><span>KAIROS AUDIT</span><strong>${esc(m?.status||'NOT RUN')}</strong><small>${esc(m?.portfolio_outlook||'Run wallet audit')}</small></article>
      <article class="v7-metric"><span>MARK INTEGRITY</span><strong class="${p.completeMarks?'green':'gold'}">${p.completeMarks?'COMPLETE':'MIXED'}</strong><small>Fresh prices required for performance</small></article>
    </div>
    <div class="v7-home-grid wallet-grid">
      <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">HOLDINGS</span><h2>Portfolio positions</h2></div><button class="tiny-btn" data-go="broker">Trade</button></div>${!p.positions.length?`<div class="v7-empty compact"><span>No positions.</span></div>`:`<div class="v7-holdings-table"><div class="v7-holdings-head"><span>Asset</span><span>Qty</span><span>Value</span><span>P/L</span><span>Weight</span></div>${p.positions.slice().sort((a,b)=>Number(b.marketValue||0)-Number(a.marketValue||0)).map(pos=>{const a=(m?.holdings||[]).find(x=>x.symbol===pos.symbol);const pl=Number(pos.unrealizedPnL||0);const plPct=pos.avgCost>0&&pos.quantity?((pos.price-pos.avgCost)/pos.avgCost):null;const wt=Number(pos.marketValue||0)/total*100;return `<button class="v7-holding-row" data-asset="${esc(pos.symbol)}"><span><strong>${esc(pos.symbol)}</strong><small>${esc(a?.action||a?.outlook||'Tracked')} · avg ${money(pos.avgCost||0)}</small></span><b>${Number(pos.quantity).toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}</b><b>${money(pos.marketValue)}</b><b class="${pl>=0?'green':'red'}">${money(pl)}${plPct==null?'':`<small>${pct(plPct)}</small>`}</b><b>${wt.toFixed(1)}%</b></button>`}).join('')}</div>`}</section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">ALLOCATION</span><h2>Market-value weights</h2></div></div>${allocation()}</section>
      <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">NEXT MOVE</span><h2>Wallet coaching</h2></div>${gateBadge(m?.gate)}</div><p class="v7-next-move">${esc(nextMove)}</p>${softGateStrip(m?.gate,rebuilt)}${m?.status==='BLOCKED'?`<div class="mirror-reject-panel"><h3>Audit withheld</h3><p>${esc(m?.rejectionSummary||m?.summary||'The final gate did not approve this wallet report.')}</p>${formatRejectReasons(m).length?`<ul>${formatRejectReasons(m).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</div>`:''}</section>
      <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">RISK LENS</span><h2>Concentration & liquidity</h2></div></div><div class="v7-setting-rows"><div><span>Cash buffer</span><strong>${cashPct.toFixed(1)}%</strong></div><div><span>Largest position</span><strong>${largest?`${esc(largest.symbol)} ${(Number(largest.marketValue||0)/total*100).toFixed(1)}%`:'—'}</strong></div><div><span>Fresh marks</span><strong>${p.completeMarks?'Yes':'Needs refresh'}</strong></div><div><span>Warnings</span><strong>${p.warnings?.length||0}</strong></div></div>${p.warnings?.length?`<div class="alert warn">${p.warnings.slice(0,3).map(esc).join(' · ')}</div>`:''}</section>
    </div>
    ${renderWalletAiGuidance()}
    ${m?.status==='APPROVED'?`<section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">FULL WALLET REPORT</span><h2>${esc(m.summary||'Audited wallet')}</h2></div></div><p class="report-text">${esc(m.portfolio_report||'')}</p></section>`:''}
    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">LEDGER</span><h2>Transaction history</h2></div><button class="ghost-btn" id="addTxBtn">Manual adjustment</button></div>${txTable()}</section>
    ${renderPaperOrders()}
  </section>`;
}
function renderWalletAiGuidance(){
  const ai=state.aiMirror, p=state.portfolio?.derived, total=Math.max(1,Number(p?.totalValue||0));
  if(!ai || ai.status==='BLOCKED' || !(ai.allocation||[]).length){
    return `<div class="panel wallet-ai-compare premium-card"><div class="section-title"><div><div class="eyebrow">KAIROS vs YOU · AI MIRROR</div><h3>What would KAIROS do?</h3><p>Build Whole Portfolio in AI Mirror to compare KAIROS guidance against your holdings.</p></div><button class="ghost-btn" data-go="aimirror">Open AI Mirror</button></div></div>`;
  }
  const youMap=Object.fromEntries((p?.positions||[]).map(pos=>[String(pos.symbol).toUpperCase(),pos]));
  const aiMap=Object.fromEntries((ai.allocation||[]).map(a=>[String(a.symbol).toUpperCase(),a]));
  const syms=[...new Set([...Object.keys(youMap),...Object.keys(aiMap)])].sort();
  const rows=syms.map(sym=>{
    const you=youMap[sym], a=aiMap[sym];
    const youWt=you?Number(you.allocation!=null?you.allocation:(you.marketValue/total))*100:0;
    const aiWt=a?Number(a.weight_pct||0):0;
    const delta=aiWt-youWt;
    let tip='HOLD';
    if(!you && a) tip='ADD';
    else if(you && !a) tip='REDUCE';
    else if(delta>=3) tip='ADD';
    else if(delta<=-3) tip='TRIM';
    const tipCls=tip==='ADD'?'action':(tip==='REDUCE'||tip==='TRIM')?'abstain':'watch';
    return `<div class="wai-row"><div class="wai-sym"><strong>${esc(sym)}</strong><span class="tiny">${esc(a?.asset_class||a?.outlook||you&&'Held'||'')}</span></div><div class="wai-you">${you?youWt.toFixed(1)+'%':'—'}</div><div class="wai-ai">${a?aiWt.toFixed(1)+'%':'—'}</div><div class="wai-delta ${delta>0.5?'green':delta<-0.5?'red':'muted'}">${a||you?(delta>=0?'+':'')+delta.toFixed(1)+'pt':'—'}</div><span class="badge ${tipCls}">${tip}</span></div>`;
  }).join('');
  const stance=ai.stance_summary||ai.report||'';
  return `<div class="panel wallet-ai-compare premium-card"><div class="section-title"><div><div class="eyebrow">KAIROS vs YOU · AI MIRROR</div><h3>Guidance vs holdings</h3><p>${esc(String(stance).slice(0,220))}${String(stance).length>220?'…':''}</p></div><div class="action-row"><button class="ghost-btn" data-go="aimirror">AI Mirror</button><button class="ghost-btn" data-go="performance">YOU vs KAIROS</button></div></div>
  <div class="wai-head"><span>Asset</span><span>You</span><span>KAIROS</span><span>Δ</span><span>Cue</span></div>
  <div class="wai-list">${rows||'<div class="tiny">No overlapping symbols yet.</div>'}</div>
  <div class="tiny" style="margin-top:8px">Advisory / simulated only. Weights from your Wallet Mirror vs latest approved AI Mirror allocation (${money(ai.budget||0)} capital).</div></div>`;
}

function renderInvestmentMarkets(){
  const x=(marketUniverse||[]).find(a=>a.id===selectedMarketId)||marketUniverse[0];
  const decision=x?(state.decisions||[]).find(d=>d.asset===x.symbol):null;
  return `<section class="broker-screen"><div class="broker-topline"><div><div class="eyebrow">INVEST MARKETS</div><h1>One board. Multiple asset classes.</h1><p>NASDAQ, broad equities, crypto, real estate, gold, Treasuries, and global exposure—each with its own recorded curve and KAIROS context.</p></div><button class="primary-btn" id="marketRefreshBtn">Refresh market state</button></div>${marketSwitcher(selectedMarketId)}
  ${x?`<div class="market-focus premium-card"><div class="market-focus-head"><div><div class="symbol-orb large ticker-orb">${esc(x.symbol)}</div></div><div class="market-focus-title"><div class="eyebrow">${esc(x.kind)}</div><h2 class="ticker-primary">${esc(x.symbol)}</h2><p><strong>${esc(x.label)}</strong> — ${esc(x.description)}</p></div><div class="market-focus-price"><strong>${x.current?.price==null?'—':money(x.current.price)}</strong><span class="${x.periodReturn==null?'muted':x.periodReturn>=0?'green':'red'}">${x.periodReturn==null?'History building':pct(x.periodReturn)}</span></div></div><div class="timeframe-row"><span class="active">${x.seriesSource==='research'?'RESEARCH':x.seriesSource==='mixed'?'MIXED':'RECORDED'}</span><span>${x.series.length} POINTS</span><span>${x.current?.confidence?esc(x.current.confidence).toUpperCase():'UNVERIFIED'}</span></div><div class="market-big-chart">${x.series.length>=2?`${lineChart(x.series.map(p=>p.price),null,null,[x.periodReturn!=null&&x.periodReturn<0?'#FF5A5A':'#1B4C93'])}${x.seriesSource&&x.seriesSource!=='recorded'?`<div class="tiny muted" style="margin-top:8px">${x.researchMeta?.grade==='licensed_market_data'?'Licensed history':'Context only'} via ${esc(x.researchMeta?.provider||'market feed')}.</div>`:''}`:`<div class="empty-chart"><strong>No chart yet.</strong><span>Refresh market data to seed licensed vendor history. AI never manufactures chart prices.</span></div>`}</div></div>
  <div class="two-col"><div class="panel"><div class="eyebrow">KAIROS INSIGHT</div><h3>${esc(decision?.final?.status||'NO AUDITED DECISION')}</h3><p class="report-text">${esc(decision?.final?.decision||decision?.final?.why?.[0]||state.worldState?.summary||'Refresh market data or run Decision Review for this asset to generate an audited view.')}</p>${decision?gateBadge(decision.final?.final_gate):''}</div><div class="panel"><div class="eyebrow">WHAT TO WATCH</div>${(decision?.final?.what_changes_view||state.worldState?.risks||[]).slice(0,6).map(v=>`<div class="insight-line">${esc(v)}</div>`).join('')||'<div class="alert warn">No stored watch conditions yet.</div>'}<button class="ghost-btn" style="margin-top:12px" data-run-crown="${esc(x.symbol)}">Run Decision Review on ${esc(x.symbol)}</button></div></div>`:`<div class="alert warn">Market universe unavailable.</div>`}
  <div class="broker-market-grid">${marketUniverse.map(universeCard).join('')}</div></section>`;
}
function renderPerformanceMirror(){
  const pm=state.performanceMirror||{}, u=pm.user||{}, a=pm.ai||{}, b=pm.benchmark||{}, tr=state.trackRecord||{};
  const uv=u.totalReturn, av=a.totalReturn, bv=b.totalReturn;
  const uSeries=(u.series||[]).map(x=>Number(x.value)).filter(Number.isFinite), aSeries=(a.series||[]).map(x=>Number(x.value)).filter(Number.isFinite), bSeries=(b.series||[]).map(x=>Number(x.value)).filter(Number.isFinite);
  const stats=scoredDecisionStats(), evo=state.evolution||{}, leader=pm.leader==='SAURON'?'KAIROS':pm.leader;
  const missing=[]; if(!u.ready)missing.push(u.reason||'Wallet snapshots missing'); if(!a.ready)missing.push(a.reason||'AI Mirror history missing'); if(!b.ready)missing.push(b.reason||'Benchmark history missing');
  const cps=tr.decision?.checkpointStats||[], trPerf=tr.performance||{}, trPeriod=tr.period||{}, trHash=tr.integrity?.evidenceHash||'';
  return `<section class="v7-screen v7-performance"><header class="v7-page-head"><div><div class="v7-kicker">PERFORMANCE · YOU vs KAIROS</div><h1>Who made the better decisions?</h1><p>Recorded Wallet Mirror vs paper AI Mirror vs SPY benchmark. No backfilled prices and no invented history.</p></div><button class="ghost-btn" data-go="insight" data-insight-pane="evolution">Learning Lab</button></header>
  ${missing.length?`<div class="alert warn"><strong>Comparison still building.</strong><ul>${missing.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  <div class="v7-metric-grid performance-metrics"><article class="v7-metric"><span>YOUR WALLET</span><strong class="${Number(uv)>=0?'green':'red'}">${uv==null?'—':pct(uv)}</strong><small>${u.ready?'Recorded TWR':'Needs snapshots'}</small></article><article class="v7-metric accent-blue"><span>KAIROS MIRROR</span><strong class="${Number(av)>=0?'green':'red'}">${av==null?'—':pct(av)}</strong><small>${a.ready?'Paper shadow performance':'Run AI Mirror'}</small></article><article class="v7-metric"><span>SPY</span><strong>${bv==null?'—':pct(bv)}</strong><small>${b.ready?'Recorded benchmark':'Refresh market history'}</small></article><article class="v7-metric"><span>DECISION CALIBRATION</span><strong>${stats.hitRate==null?'Building':pct(stats.hitRate,0)}</strong><small>${stats.eligible} matured actionable outcome(s)</small></article><article class="v7-metric"><span>CHAMPION</span><strong>${esc(evo.champion?.version||'1.0.0')}</strong><small>${esc(evo.champion?.name||'Baseline Decision Review')}</small></article><article class="v7-metric"><span>LEADER</span><strong>${esc(leader||'Building')}</strong><small>Descriptive simulation only</small></article></div>
  <section class="v7-card performance-chart-card"><div class="v7-section-head"><div><span class="v7-kicker">NORMALIZED PERFORMANCE CURVE</span><h2>Same starting index · 100</h2></div><span class="badge ${leader&&leader!=='BUILDING'?'action':'watch'}">${esc(leader||'BUILDING')}</span></div>${Math.max(uSeries.length,aSeries.length,bSeries.length)>=2?lineChart(uSeries.length?uSeries:null,aSeries.length?aSeries:null,bSeries.length?bSeries:null,['#B59410','#5AA1FF','#8D8D92']):`<div class="v7-empty"><strong>Not enough recorded observations.</strong><span>Wallet snapshots, an approved AI Mirror and benchmark history are required.</span></div>`}<div class="chart-legend"><span><i class="legend-you"></i>Your Wallet</span><span><i class="legend-ai"></i>KAIROS Mirror</span><span><i class="legend-bench"></i>SPY</span></div></section>
  <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">TRACK RECORD LEDGER</span><h2>Recorded evidence, not a promise.</h2></div><div class="action-row"><span class="badge ${tr.evidenceState==='RECORDED'?'action':'watch'}">${esc(tr.evidenceState||'BUILDING')}</span><button class="ghost-btn" id="exportTrackRecordBtn">Export evidence JSON</button></div></div>
    <div class="cards-4"><div class="card"><div class="muted">Recorded period</div><strong>${esc(trPeriod.startDate||'—')} → ${esc(trPeriod.endDate||'—')}</strong><div class="tiny">${Number(trPeriod.completeSnapshotCount||0)} complete of ${Number(trPeriod.snapshotCount||0)} snapshots</div></div><div class="card"><div class="muted">Paper relative to SPY</div><div class="value ${Number(trPerf.relativeToSpy)>=0?'green':'red'}">${trPerf.relativeToSpy==null?'—':pct(trPerf.relativeToSpy)}</div><div class="tiny">Descriptive return difference, not alpha.</div></div><div class="card"><div class="muted">Matured actionable decisions</div><div class="value">${Number(tr.decision?.maturedActionableDecisions||0)}</div><div class="tiny">${Number(tr.decision?.scoredPointInTimeOutcomes||0)} point-in-time outcome observations</div></div><div class="card"><div class="muted">Evidence hash</div><strong style="font-family:monospace;font-size:14px">${esc(trHash?trHash.slice(0,16)+'…':'—')}</strong><div class="tiny">SHA-256 · export contains the full hash.</div></div></div>
    <div class="chart-wrap" style="overflow:auto;margin-top:14px"><table><thead><tr><th>Checkpoint</th><th>Observations</th><th>Directional hits</th><th>Hit rate</th><th>Avg directional return</th></tr></thead><tbody>${cps.map(x=>`<tr><td>${Number(x.days)}D</td><td>${Number(x.observations||0)}</td><td>${Number(x.correct||0)}</td><td>${x.directionalHitRate==null?'—':pct(x.directionalHitRate,0)}</td><td>${x.averageDirectionalReturn==null?'—':pct(x.averageDirectionalReturn)}</td></tr>`).join('')||'<tr><td colspan="5">No matured point-in-time outcomes yet.</td></tr>'}</tbody></table></div>
    <div class="alert warn" style="margin-top:14px"><strong>Paper evidence only.</strong> Historical paper results do not establish future performance or market edge. The integrity hash detects changes to this export; it is <strong>not an external audit</strong> or third-party attestation.</div>
  </section>
  <div class="two-col"><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">CALIBRATION</span><h2>Was KAIROS directionally right?</h2></div></div><div class="v7-calibration"><div><strong>${stats.eligible}</strong><span>Matured ADD/REDUCE decisions</span></div><div><strong>${stats.hitRate==null?'—':pct(stats.hitRate,0)}</strong><span>Directional hit rate</span></div><div><strong>${stats.noAction}</strong><span>HOLD / WATCH / ABSTAIN decisions</span></div></div><p class="tiny">Only matured stored outcomes count. KAIROS does not manufacture a calibration score before evidence exists.</p></section><section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">LEARNING LOOP</span><h2>Trace → score → challenge</h2></div></div><p class="report-text">Matured decisions feed Learning Lab. A challenger must beat the champion on holdout data and still requires human promotion.</p><button class="primary-btn" data-go="insight" data-insight-pane="evolution">Inspect champion vs challenger</button></section></div>
  <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">METHOD & LIMITS</span><h2>What these lines mean</h2></div></div><div class="v7-condition-list"><div><span></span><p>Wallet: transaction-ledger snapshots adjusted for recorded external cash flows.</p></div><div><span></span><p>KAIROS: paper allocation performance from recorded market states; no brokerage execution is implied.</p></div><div><span></span><p>Benchmark: recorded SPY ETF series. Missing or stale marks are not filled with fabricated prices.</p></div><div><span></span><p>Track Record Ledger: only point-in-time scored outcomes enter checkpoint statistics; non-point-in-time outcomes are excluded.</p></div></div></section></section>`;
}
function renderBrokerDecisions(){
  const assets=universeSymbolSet(), ds=(state.decisions||[]).filter(d=>decisionWithin(d,decisionRange)), w=state.worldState;
  return `<section class="broker-screen"><div class="broker-topline"><div><div class="eyebrow">Decision Review + RESEARCH</div><h1>Analyze. Attack. Verify. Release—or abstain.</h1><p>Research evidence and portfolio context feed four analytical perspectives, independent criticism, deterministic checks and a separate cross-provider final Decision Review adjudicator.</p></div><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button></div>
  <div class="two-col"><div class="panel"><div class="eyebrow">RUN Decision Review</div><div class="action-row" style="margin-top:12px"><select id="decisionAsset" class="select" style="max-width:260px">${assets.map(a=>`<option>${esc(a)}</option>`).join('')}</select><button class="primary-btn" id="runDecisionBtn">Run full Decision Review</button></div><label class="tiny"><input type="checkbox" id="forceMarketRefresh"> refresh market evidence first</label><div class="subtabs" style="margin-top:14px">${[['today','Today'],['week','Week'],['month','Month'],['all','All']].map(([k,l])=>`<button class="tab-btn ${decisionRange===k?'active':''}" data-decision-range="${k}">${l}</button>`).join('')}</div></div><div class="panel"><div class="eyebrow">RESEARCH STATE</div>${w?`<h3>${esc(w.regime?.name||'Unclassified')}</h3><p>${esc(w.summary||'')}</p><div class="mirror-tags"><span>${esc(w.regime?.trend||'trend unknown')}</span><span>${esc(w.regime?.volatility||'vol unknown')}</span><span>${esc(w.regime?.liquidity||'liquidity unknown')}</span></div><button class="ghost-btn" id="marketRefreshBtn" style="margin-top:12px">Refresh evidence</button>`:`<div class="alert warn">No market world state yet. Refresh evidence before running Decision Review.</div>`}</div></div>
  <div class="panel"><div class="section-title"><div><h3>Audited Decisions</h3><p>Released decisions are stored with attack results, gate metadata and future outcome checkpoints.</p></div></div><div class="decision-list">${ds.length?ds.map(decisionCard).join(''):'<div class="alert warn">No audited decisions in this range.</div>'}</div></div>
  ${w?`<div class="panel"><div class="section-title"><div><h3>Evidence & Drivers</h3><p>Research context used by the decision system.</p></div></div>${marketWorld(w)}</div>`:''}</section>`;
}
function metricPct(v){return v==null?'N/A':`${(Number(v)*100).toFixed(1)}%`;}
function renderEvolutionLab(){
  const e=state.evolution||{}, ch=e.champion||{}, cc=e.challenger, m=ch.metrics||{}, d=e.diagnosis||{};
  return `<section class="broker-screen"><div class="broker-topline"><div><div class="eyebrow">LEARNING LAB</div><h1>Never replace the best version unless the challenger proves it.</h1><p>Observe outcomes → diagnose failures → generate challenger → benchmark → regression gate → promote or discard → repeat.</p></div><button class="primary-btn" id="runEvolutionBtn">Run Evolution Cycle</button></div>
  <div class="evolution-loop"><div class="evo-node active"><b>1</b><span>Observe</span></div><i>→</i><div class="evo-node"><b>2</b><span>Diagnose</span></div><i>→</i><div class="evo-node"><b>3</b><span>Challenge</span></div><i>→</i><div class="evo-node"><b>4</b><span>Test</span></div><i>→</i><div class="evo-node"><b>5</b><span>Keep Winner</span></div><i>↻</i></div>
  <div class="two-col"><div class="panel gold-panel"><div class="row"><div><div class="eyebrow">CURRENT CHAMPION</div><h3>${esc(ch.name||'Baseline Decision Review')}</h3></div><span class="badge action">PRODUCTION</span></div><div class="cards-3"><div class="card"><strong>${m.sample||0}</strong><div class="tiny">Scored outcomes</div></div><div class="card"><strong>${metricPct(m.hitRate)}</strong><div class="tiny">Hit rate</div></div><div class="card"><strong>${m.score==null?'N/A':Number(m.score).toFixed(3)}</strong><div class="tiny">Benchmark score</div></div></div><div class="policy-grid">${Object.entries(ch.policy||{}).filter(([k])=>k!=='description').map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div><p>${esc(ch.policy?.description||'')}</p></div>
  <div class="panel"><div class="row"><div><div class="eyebrow">CHALLENGER</div><h3>${esc(cc?.name||'No eligible challenger')}</h3></div><span class="badge ${cc?.status==='ELIGIBLE'?'watch':cc?.status==='PROMOTED'?'action':'noaction'}">${esc(cc?.status||'WAITING')}</span></div>${cc?`<p>${esc(cc.hypothesis||'')}</p><div class="cards-3"><div class="card"><strong>${metricPct(cc.metrics?.hitRate)}</strong><div class="tiny">Hit rate</div></div><div class="card"><strong>${metricPct(cc.metrics?.coverage)}</strong><div class="tiny">Coverage</div></div><div class="card"><strong class="${Number(cc.improvement||0)>0?'green':'red'}">${Number(cc.improvement||0).toFixed(3)}</strong><div class="tiny">vs Champion</div></div></div>${cc.better&&cc.status==='ELIGIBLE'?`<button class="primary-btn" style="margin-top:14px" id="promoteEvolutionBtn">Promote proven challenger</button>`:''}`:`<div class="alert warn">KAIROS needs enough matured ADD/REDUCE outcomes before it can test a challenger honestly.</div>`}</div></div>
  <div class="two-col"><div class="panel"><div class="eyebrow">FAILURE DIAGNOSIS</div><div class="cards-4"><div class="card"><strong>${d.sample||0}</strong><div class="tiny">Measured</div></div><div class="card"><strong>${d.misses||0}</strong><div class="tiny">Misses</div></div><div class="card"><strong>${d.lowConfidenceMisses||0}</strong><div class="tiny">Low-conf misses</div></div><div class="card"><strong>${d.highUnknownMisses||0}</strong><div class="tiny">High-unknown misses</div></div></div></div><div class="panel"><div class="eyebrow">ALWAYS ON</div><p class="report-text">Learning Lab runs automatically after the daily Decision History job (~23:30 UTC) — no login required. Challengers are proposed when enough matured decisions exist. <strong>Promotion stays manual</strong> (Promote / Discard) so a weak policy never silently replaces the champion.</p><div class="tiny" style="margin-top:10px">Always on · ~daily with Decision History · human promote only · holdout benchmark required.</div></div></div>
  <div class="panel"><div class="section-title"><div><h3>Evolution History</h3><p>Promotion and rejection trail.</p></div></div><div class="timeline">${(e.history||[]).slice().reverse().slice(0,20).map(h=>`<div class="timeline-row"><span>${esc(String(h.at||'').slice(0,19).replace('T',' '))}</span><strong>${esc(h.event||'')}</strong><small>${h.improvement!=null?`Δ ${Number(h.improvement).toFixed(3)}`:esc(h.reason||'')}</small></div>`).join('')||'<div class="alert warn">No evolution cycles recorded yet.</div>'}</div></div></section>`;
}
function renderSettings(){
  const must=state.auth?.mustChangeDefault, identityAuth=state.auth?.authProvider==='netlify_identity', prof=profileCompleteness(), market=state.providers?.market, openai=state.providers?.openai, anthropic=state.providers?.anthropic, gemini=state.providers?.gemini, gateway=state.providers?.aiGateway, pers=state.persistence||{}, commercial=state.commercial||{}, usage=commercial.usage||{}, access=commercial.access||{};
  return `<section class="v7-screen v7-settings"><header class="v7-page-head"><div><div class="v7-kicker">PROFILE & SYSTEM</div><h1>Your financial twin, controls and trust layer.</h1><p>Customer-facing screens never receive infrastructure API keys. Provider credentials remain server-side.</p></div><button class="ghost-btn" id="researchOpenAdvisor">Ask KAIROS</button></header>
  ${must?`<div class="alert bad must-change-banner"><strong>Security action required:</strong> default credentials are active. Set a new password below before any shared use.</div>`:''}
  <div class="v7-settings-grid">
    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">DIGITAL TWIN</span><h2>Investment profile</h2></div><div class="v7-profile-score"><strong>${prof}%</strong><span>complete</span></div></div><div class="form-grid v7-profile-form"><div class="field"><label>Name</label><input id="sName" class="text-input" value="${esc(state.profile.name)}"></div><div class="field"><label>Email · optional</label><input id="sEmail" class="text-input" value="${esc(state.profile.email||'')}"></div><div class="field"><label>Country</label><input id="sCountry" class="text-input" value="${esc(state.profile.country)}"></div><div class="field"><label>Base currency</label><select id="sCurrency" class="select">${['USD','EUR','BRL','GBP'].map(x=>`<option ${state.profile.baseCurrency===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Primary goal</label><input id="sGoal" class="text-input" value="${esc(state.profile.goal)}"></div><div class="field"><label>Target amount</label><input id="sTarget" type="number" class="text-input" value="${Number(state.profile.targetAmount||0)}"></div><div class="field"><label>Horizon</label><select id="sHorizon" class="select">${['<1y','1-3y','3-10y','10y+'].map(x=>`<option ${state.profile.horizon===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Contribution</label><input id="sContribution" type="number" class="text-input" value="${Number(state.profile.contributionAmount||0)}"></div><div class="field"><label>Experience</label><select id="sExperience" class="select">${['Beginner','Intermediate','Advanced'].map(x=>`<option ${state.profile.experience===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Risk capacity</label><select id="sRiskCapacity" class="select">${['Low','Moderate','High'].map(x=>`<option ${state.profile.riskCapacity===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Max drawdown tolerance · %</label><input id="sDrawdown" type="number" min="0" max="95" class="text-input" value="${Number(state.profile.maxDrawdownTolerance||20)}"></div><div class="field"><label>Liquidity need</label><select id="sLiquidity" class="select">${['Low','Moderate','High'].map(x=>`<option ${state.profile.liquidityNeed===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Emergency reserve · months</label><input id="sReserve" type="number" min="0" class="text-input" value="${Number(state.profile.emergencyReserveMonths||0)}"></div><div class="field"><label>Income stability</label><select id="sIncomeStability" class="select">${['Stable','Variable','Unstable'].map(x=>`<option ${state.profile.incomeStability===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Tax residency</label><input id="sTaxResidency" class="text-input" value="${esc(state.profile.taxResidency||state.profile.country||'')}"></div></div><div class="v7-setting-block"><span class="v7-kicker">RISK STYLE</span><div class="choice-grid">${['Conservative','Moderate','Aggressive'].map(x=>`<div class="choice ${state.profile.riskStyle===x?'active':''}" data-risk="${x}"><strong>${x}</strong><div class="tiny">${x==='Conservative'?'Preserve capital and limit volatility.':x==='Moderate'?'Balance growth with downside discipline.':'Accept larger drawdowns for higher growth potential.'}</div></div>`).join('')}</div></div><button class="primary-btn" id="saveProfileBtn">Save Digital Twin</button></section>

    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">BROKER PREFERENCES</span><h2>Paper execution</h2></div></div><div class="v7-setting-rows"><div><span>Fractional shares</span><strong>Enabled</strong></div><div><span>Order types</span><strong>Market · Limit · Stop · Stop Limit</strong></div><div><span>Execution</span><strong>Fresh stored marks only</strong></div><div><span>Real brokerage</span><strong>Not connected</strong></div></div><div class="tiny">Open paper orders are persistent and evaluated on market refresh / Decision History. They never reach a real broker.</div></section>

    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">DISPLAY</span><h2>Adaptive layout</h2></div></div><div class="choice-grid">${['auto','compact','desktop'].map(x=>`<div class="choice ${state.settings.displayMode===x?'active':''}" data-display="${x}"><strong>${x==='compact'?'iPhone / Compact':x==='desktop'?'Desktop / Expanded':'Auto'}</strong><div class="tiny">${x==='auto'?'Responsive default.':x==='compact'?'Forces compact mobile layout.':'Wider command workspace.'}</div></div>`).join('')}</div></section>

    <section class="v7-card v7-span-2" id="securityCard"><div class="v7-section-head"><div><span class="v7-kicker">SECURITY & BACKUP</span><h2>${identityAuth?'Account security':must?'Change credentials now':'Private access'}</h2></div><span class="badge ${must?'abstain':'action'}">${identityAuth?'NETLIFY IDENTITY':must?'ACTION REQUIRED':'SERVER-SIDE'}</span></div>${identityAuth?`<div class="form-grid"><div class="field"><label>Identity email</label><input class="text-input" value="${esc(state.auth?.user?.email||'')}" disabled></div><div class="field"><label>Display username</label><input id="sUsername" class="text-input" value="${esc(state.auth.username||'')}"></div></div><div class="tiny">Authentication, password and session lifecycle are managed by Netlify Identity. KAIROS stores only the tenant mapping and role metadata, never the Identity password.</div>`:`<div class="form-grid"><div class="field"><label>Username</label><input id="sUsername" class="text-input" value="${esc(state.auth.username||'')}"></div><div></div><div class="field"><label>Current password</label><input id="sCurrentPw" class="password-input" type="password"></div><div class="field"><label>New password</label><input id="sNewPw" class="password-input" type="password" placeholder="12+ characters"></div></div>`}<div class="action-row"><button class="primary-btn" id="changeCredBtn">${identityAuth?'Save display username':'Change credentials'}</button><button class="ghost-btn" id="exportBtn">Export workspace backup</button><button class="ghost-btn" id="importBtn">Restore workspace backup</button></div><div class="tiny">Backup includes this workspace's portfolio ledger, paper orders, watchlist, Decision History, mirrors and Learning Lab state. It never exports API keys, authentication passwords or another tenant's data.</div></section>

    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">SYSTEM HEALTH</span><h2>AI Gateway + market data + persistence</h2></div><button class="primary-btn" id="runProviderTestBtnSettings" type="button">Run live diagnostics</button></div><div class="v7-health-grid"><div><span>Netlify AI Gateway</span><strong class="${gateway?.configured?'green':'gold'}">${gateway?.configured?'DETECTED':'AWAITING RUNTIME'}</strong><small>Zero manually managed LLM keys after migration</small></div><div><span>Model providers</span><strong class="${openai?.configured||anthropic?.configured||gemini?.configured?'green':'red'}">${[openai?.configured&&'OpenAI',anthropic?.configured&&'Anthropic',gemini?.configured&&'Gemini'].filter(Boolean).join(' · ')||'NONE'}</strong><small>Luna coach · Terra deep · cross-provider Decision Review</small></div><div><span>Market feed</span><strong class="${market?.verified?'green':market?.configured?'gold':'red'}">${market?.verified?'VERIFIED':market?.configured?'CONFIGURED':'NOT CONFIGURED'}</strong><small>${esc(market?.activeProvider||market?.provider||'Twelve Data / Finnhub')}</small></div><div><span>Persistence</span><strong class="${pers.persistent?'green':'red'}">${esc(pers.provider||'unknown')}</strong><small>${pers.persistent?'Persistent state active':'Production writes blocked when persistence is unavailable'}</small></div></div><div id="providerHealthResultsSettings" class="tiny v7-diagnostic-output">${esc(state._providerHealthSummary||'Not run yet this session.')}</div></section>

    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">MARKET INTELLIGENCE</span><h2>Price truth before interpretation</h2></div>${feedTrustBadge()}</div><label class="v7-toggle-row"><span><strong>Allow research fallback for missing market context</strong><small>Licensed/vendor marks are the only price authority. LLMs never invent prices.</small></span><input id="sAutoMarks" type="checkbox" ${state.settings.autoMarketMarks!==false?'checked':''}></label><button class="primary-btn" id="saveSystemSettingsBtn">Save system settings</button></section>

    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">WORKSPACE</span><h2>${esc(state.auth?.tenant?.name||'Kairos Workspace')}</h2></div></div><p class="report-text">Tenant-isolated paper workspace · ${esc(state.auth?.user?.role||'member')} access · ${esc(commercial.tenant?.plan||state.auth?.tenant?.plan||'private')} plan.</p><div class="tiny">Portfolio, paper orders, Decision History, mirrors and settings are isolated to this workspace.</div></section>

    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">SUBSCRIPTION & USAGE</span><h2>${esc(String(access.status||'active').replaceAll('_',' '))}</h2></div><span class="badge ${access.allowed!==false?'action':'abstain'}">${access.allowed!==false?'ACCESS ACTIVE':'ACTION REQUIRED'}</span></div><div class="v7-setting-rows"><div><span>Plan</span><strong>${esc(commercial.tenant?.plan||'private')}</strong></div><div><span>AI units · ${esc(usage.period||'current month')}</span><strong>${usage.limit==null?'UNLIMITED':`${Number(usage.used||0)} / ${Number(usage.limit||0)}`}</strong></div><div><span>Renewal / trial end</span><strong>${access.currentPeriodEnd?esc(String(access.currentPeriodEnd).slice(0,10)):'—'}</strong></div><div><span>Billing provider</span><strong>${commercial.billing?.provider==='stripe'?'STRIPE':commercial.tenant?.plan==='private'?'PRIVATE OWNER':'NOT LINKED'}</strong></div></div>${state.auth?.user?.role==='owner'&&commercial.tenant?.plan!=='private'?`<div class="action-row" style="margin-top:14px">${commercial.billing?.customerLinked?`<button class="primary-btn" id="billingPortalBtn">Manage billing</button>`:`<button class="primary-btn" id="billingCheckoutBtn">Start / activate subscription</button>`}<button class="ghost-btn" id="refreshCommercialBtn">Refresh status</button></div>`:''}<div class="tiny" style="margin-top:10px">AI units are internal cost-control units, not tokens or dollars. Replayed jobs with the same idempotency key do not consume twice.</div></section>

    <section class="v7-card"><div class="v7-section-head"><div><span class="v7-kicker">COMMERCIAL RELEASE</span><h2>${state.auth?.release?.ready?'Gate approved':'Gate locked'}</h2></div><span class="badge ${state.auth?.release?.ready?'action':'watch'}">${state.auth?.release?.ready?'READY':'LOCKED'}</span></div>
    <div class="v7-setting-rows"><div><span>Product mode</span><strong>${esc(state.auth?.release?.productMode||'paper_research')}</strong></div><div><span>Real-money execution</span><strong>${state.auth?.release?.realMoneyExecution?'ON':'OFF'}</strong></div><div><span>Preview smoke approval</span><strong>${state.auth?.release?.previewSmokeApproved?'APPROVED':'PENDING'}</strong></div><div><span>Public release approval</span><strong>${state.auth?.release?.publicReleaseApproved?'APPROVED':'PENDING'}</strong></div></div>
    ${state.auth?.user?.role==='owner'?'<button class="ghost-btn" id="launchReadinessBtn">Run launch readiness</button>':''}<div id="launchReadinessResult" class="tiny" style="margin-top:10px">Public signup remains fail-closed until every release gate is satisfied.</div></section>

    <section class="v7-card v7-span-2"><div class="v7-section-head"><div><span class="v7-kicker">DATA & PRIVACY</span><h2>Export or delete your workspace.</h2></div></div>
    <p class="report-text">Workspace backup and Track Record exports are available before deletion. Customer workspace deletion cancels an active Stripe subscription first, then removes tenant content, usage/audit rows and KAIROS account mappings. Netlify Identity users are deleted through the server-side admin API.</p>
    <div class="action-row"><button class="ghost-btn" id="privacyExportBtn">Export workspace backup</button><button class="ghost-btn" id="privacyTrackBtn">Export track record</button>${state.auth?.user?.role==='owner'&&String(commercial.tenant?.plan||'').toLowerCase()!=='private'?'<button class="danger-btn" id="deleteWorkspaceBtn">Delete workspace</button>':''}</div>
    ${state.auth?.privacyUrl?'<div class="tiny" style="margin-top:10px"><a href="'+esc(state.auth.privacyUrl)+'" target="_blank" rel="noopener">Privacy policy</a></div>':''}
    <div class="tiny" style="margin-top:10px">${String(commercial.tenant?.plan||'').toLowerCase()==='private'?'The original private owner workspace is protected from self-service deletion by default.':'Deletion is irreversible after the background purge completes.'}</div></section>
  </div></section>`;
}

function wireScreen(){
  $$('[data-go]').forEach(x=>x.onclick=()=>{if(x.dataset.insightPane) insightPane=x.dataset.insightPane; nav(x.dataset.go);});
  $('#marketRefreshBtn')?.addEventListener('click',e=>refreshMarkets(e.currentTarget));
  $('#marketRefreshDash')?.addEventListener('click',e=>refreshMarkets(e.currentTarget));
  $('#marketRefreshDashEmpty')?.addEventListener('click',e=>refreshMarkets(e.currentTarget));
  $$('[data-perf-range]').forEach(b=>b.onclick=()=>{perfRange=b.dataset.perfRange;render()});
  $$('[data-decision-range]').forEach(b=>b.onclick=()=>{decisionRange=b.dataset.decisionRange;render()});
  $('#runDecisionBtn')?.addEventListener('click',runDecision);
  $('#assetAuditBtn')?.addEventListener('click',()=>runDecisionFor(selectedAsset,$('#assetAuditBtn')));
  $$('[data-run-crown]').forEach(b=>b.onclick=()=>runDecisionFor(b.dataset.runCrown,b));
  $('#addTxBtn')?.addEventListener('click',()=>transactionDialog(false));
  $('#addOpeningBtn')?.addEventListener('click',()=>transactionDialog(true));
  $$('[data-asset]').forEach(b=>b.onclick=()=>{selectedAsset=b.dataset.asset;currentSection='asset';render()});
  $$('[data-mark]').forEach(b=>b.onclick=()=>setMark(b.dataset.mark));
  $$('[data-del-tx]').forEach(b=>b.onclick=()=>deleteTx(b.dataset.delTx));
  $$('[data-market-id]').forEach(b=>b.onclick=()=>{const id=b.dataset.marketId; if(currentSection==='aimirror') mirrorFocus=id; else if(id!=='all'){selectedMarketId=id; if(currentSection==='home') currentSection='broker';} render();});
  $$('[data-market-open]').forEach(b=>b.onclick=async()=>{let asset=(marketUniverse||[]).find(x=>x.id===b.dataset.marketOpen);if(asset&&categoryOfKind(asset.kind)==='Crypto')asset=await resolveCryptoAsset(asset);selectedMarketId=asset?.id||b.dataset.marketOpen;selectedAsset=asset?.symbol||selectedAsset;nav('broker');setTimeout(()=>document.querySelector('.market-focus')?.scrollIntoView({behavior:'smooth',block:'start'}),20);});
  $('#aiMirrorFocus')?.addEventListener('change',e=>{mirrorFocus=e.target.value;});
  $('#runAIMirrorBtn')?.addEventListener('click',(e)=>runAIMirror(e));
  $('#runAIMirrorWholeBtn')?.addEventListener('click',(e)=>{mirrorFocus='all'; const sel=$('#aiMirrorFocus'); if(sel)sel.value='all'; runAIMirror(e);});
  $('#applyMirrorWalletBtn')?.addEventListener('click',applyMirrorToWallet);
  $$('[data-ai-lab]').forEach(b=>b.onclick=()=>{mirrorFocus=b.dataset.aiLab; render(); setTimeout(()=>$('#aiMirrorBudget')?.focus(),20);});
  $$('[data-broker-trade]').forEach(b=>b.onclick=()=>brokerTradeDialog(b.dataset.symbol,b.dataset.brokerTrade));
  $('#brokerDepositBtn')?.addEventListener('click',depositDialog);
  $('#homeDepositBtn')?.addEventListener('click',depositDialog);
  $('#runWalletMirrorBtn')?.addEventListener('click',runWalletMirror);
  $('#runEvolutionBtn')?.addEventListener('click',runEvolutionCycle);
  $('#promoteEvolutionBtn')?.addEventListener('click',promoteEvolution);
  
  $('#runProviderTestBtnSettings')?.addEventListener('click',e=>runProviderHealthTest(e.currentTarget));
  $('#saveProfileBtn')?.addEventListener('click',saveProfile);
  $$('[data-risk]').forEach(x=>x.onclick=()=>saveRisk(x.dataset.risk));
  $$('[data-display]').forEach(x=>x.onclick=()=>saveDisplay(x.dataset.display));
  $('#changeCredBtn')?.addEventListener('click',changeCredentials);
  $('#exportBtn')?.addEventListener('click',exportBackup);
  $('#importBtn')?.addEventListener('click',importBackup);
  $('#saveSystemSettingsBtn')?.addEventListener('click',saveSystemSettings);
  $('#billingCheckoutBtn')?.addEventListener('click',startBillingCheckout);
  $('#billingPortalBtn')?.addEventListener('click',openBillingPortal);
  $('#refreshCommercialBtn')?.addEventListener('click',async()=>{await loadState();nav('settings');toast('Subscription status refreshed.');});
  $('#exportTrackRecordBtn')?.addEventListener('click',exportTrackRecord);
  $('#privacyExportBtn')?.addEventListener('click',exportBackup);
  $('#privacyTrackBtn')?.addEventListener('click',exportTrackRecord);
  $('#deleteWorkspaceBtn')?.addEventListener('click',deleteWorkspace);
  $('#launchReadinessBtn')?.addEventListener('click',e=>runLaunchReadiness(e.currentTarget));
  $('#researchOpenAdvisor')?.addEventListener('click',()=>openAdvisor('Insight')); $$('[data-insight-pane]').forEach(b=>b.onclick=()=>{insightPane=b.dataset.insightPane;render();});
  $('#discardEvolutionBtn')?.addEventListener('click',discardEvolution);
  const pickAssetFromBtn=async(b)=>{
    if(!b) return;
    const id=b.dataset.assetPick; const sym=b.dataset.assetPickSymbol;
    let asset=(marketUniverse||[]).find(x=>x.id===id||x.symbol===sym);
    if(asset && categoryOfKind(asset.kind)==='Crypto') asset=await resolveCryptoAsset(asset);
    selectedMarketId=asset?.id||id; brokerSearch=''; selectedAsset=asset?.symbol||sym||selectedAsset;
    render();
    setTimeout(()=>document.querySelector('.market-focus,.asset-hero')?.scrollIntoView({behavior:'smooth',block:'start'}),30);
  };
  $('#brokerSearchInput')?.addEventListener('input',e=>{brokerSearch=e.target.value; render(); const el=$('#brokerSearchInput'); if(el){el.focus(); try{const n=el.value.length; el.setSelectionRange(n,n);}catch{}} clearTimeout(cryptoSearchTimer); if(brokerCategory==='Crypto'||brokerSearch.trim().length>=2){cryptoSearchTimer=setTimeout(async()=>{await loadCryptoCatalog(brokerSearch,{append:false});render();const x=$('#brokerSearchInput');if(x){x.focus();try{x.setSelectionRange(x.value.length,x.value.length)}catch{}}},260);}});
  $('#brokerSearchInput')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      const best=document.querySelector('.asset-pick-row.best,[data-asset-pick]');
      if(best) pickAssetFromBtn(best);
    }else if(e.key==='Escape'){ brokerSearch=''; render(); }
  });
  $$('[data-asset-pick]').forEach(b=>b.onclick=()=>pickAssetFromBtn(b));
  $('#brokerDepositBtn2')?.addEventListener('click',depositDialog);
  $('#addOpeningBtn2')?.addEventListener('click',()=>transactionDialog(true));
  $('#openMarketLabsBtn')?.addEventListener('click',()=>{document.getElementById('marketLabsAnchor')?.scrollIntoView({behavior:'smooth',block:'start'});});
  $$('[data-gate-expand]').forEach(b=>b.onclick=()=>{const d=b.parentElement?.querySelector('.gate-soft-details'); if(d) d.classList.toggle('hidden');});
  $$('[data-broker-cat]').forEach(b=>b.onclick=async()=>{brokerCategory=b.dataset.brokerCat||'ALL'; if(brokerCategory==='Crypto') await loadCryptoCatalog('',{append:false}); render();});
  $('#loadMoreCryptoBtn')?.addEventListener('click',async e=>{loading(e.currentTarget,true,'Loading');await loadCryptoCatalog(brokerSearch,{append:true});render();});
  $('#homeAskHades')?.addEventListener('click',()=>openAdvisor('Home'));
  $$('[data-watch-toggle]').forEach(b=>b.onclick=async e=>{e.preventDefault();e.stopPropagation();try{const r=await api('portfolio',{method:'POST',body:JSON.stringify({action:'toggleWatchlist',symbol:b.dataset.watchToggle})});state.watchlist=r.watchlist||[];render();toast(state.watchlist.includes(b.dataset.watchToggle)?`${b.dataset.watchToggle} added to watchlist.`:`${b.dataset.watchToggle} removed from watchlist.`)}catch(err){toast(err.message)}});
  $$('[data-cancel-order]').forEach(b=>b.onclick=async e=>{e.preventDefault();e.stopPropagation();try{await api('portfolio',{method:'POST',body:JSON.stringify({action:'cancelOrder',id:b.dataset.cancelOrder})});await loadState();nav('broker');toast('Paper order cancelled.')}catch(err){toast(err.message)}});
  $$('[data-driver-ask]').forEach(b=>b.onclick=()=>{const d=(state.worldState?.drivers||[])[Number(b.dataset.driverAsk)];openAdvisor('World Model');const input=$('#chatInput');if(input)input.value=`Explain why this market driver matters to my portfolio and what would invalidate it: ${d?.title||''}. Use only stored KAIROS context unless fresh research is necessary.`;});
  $$('[data-mkt-why]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const id=b.dataset.mktWhy;
    const panel=document.querySelector(`[data-why-panel="${CSS.escape(id)}"]`);
    if(panel) panel.classList.toggle('hidden');
    else { selectedMarketId=id; selectedAsset=b.dataset.mktSym||selectedAsset; render(); setTimeout(()=>document.querySelector('.market-focus')?.scrollIntoView({behavior:'smooth',block:'start'}),20); }
  });
  $$('.mkt-card [data-broker-trade], .mkt-card [data-asset], .mkt-sim, .mkt-why, .mkt-star').forEach(b=>b.addEventListener('click',e=>e.stopPropagation()));
}




async function runProviderHealthTest(btn){
  loading(btn,true,'Pinging');
  try{
    const r=await api('provider-health',{method:'POST',body:JSON.stringify({failoverTest:true}),timeoutMs:90000});
    const rows=['openai','anthropic','gemini','twelve','finnhub'].map(k=>{
      const p=r.providers?.[k]||{};
      const status=!p.keyDetected?'NOT CONFIGURED':(p.requestOk===true)?'VERIFIED':(p.lastError?'FAIL':'CONFIGURED / UNVERIFIED');
      const lat=p.latencyMs?`${p.latencyMs}ms`:'—';
      const err=p.lastError?` · ${String(p.lastError).slice(0,80)}`:'';
      const source=p.credentialSource?` · ${String(p.credentialSource).replaceAll('_',' ').toUpperCase()}`:'';
      return `${k.toUpperCase()}: ${status}${source}${p.model?` · ${p.model}`:''} · ${lat}${err}`;
    });
    const fo=r.resilience||r.failover;
    if(fo){
      rows.push(fo.ok?`MULTI-PROVIDER RESILIENCE: OK · ${fo.independentProviderCount||0} providers`:`MULTI-PROVIDER RESILIENCE: LIMITED · ${(fo.failedProviders||[]).map(x=>x.provider).join(', ')||'insufficient verified providers'}`);
    }
    if(r.security?.findings?.length) rows.push(`SECURITY: ${r.security.findings.join(', ')}`);
    const summary=`${rows.join(' | ')} · AI ${r.summary?.aiVerified||0}/${r.summary?.aiConfigured||0} verified · Market ${r.summary?.marketVerified||0}/${r.summary?.marketConfigured||0} verified`;
    if(state) state._providerHealthSummary=summary;
    const paint=(id)=>{ const el=$(id); if(el) el.textContent=summary; };
    paint('#providerHealthResults'); paint('#providerHealthResultsSettings');
    toast(r.summary?.failed?`Provider test: ${r.summary.failed} FAIL`:`AI Gateway: ${r.summary?.aiVerified||0} AI provider(s) verified`);
  }catch(e){ toast(e.message); }
  finally{ loading(btn,false); }
}

async function refreshMarkets(btn){loading(btn,true,'Refreshing');try{const r=await api('market-refresh',{method:'POST',body:'{}',timeoutMs:90000});await loadState();const seeded=r?.researchSeries?.readySymbols;const fills=Array.isArray(r?.orderProcessing?.fills)?r.orderProcessing.fills.length:0;const base=seeded!=null?`Market data + licensed charts refreshed (${seeded} symbols via ${r.researchSeries.provider||'market feed'}).`:(r?.researchError?`Market state saved. Chart seed: ${r.researchError}`:'Market state refreshed and persisted.');toast(`${base}${fills?` ${fills} paper order${fills===1?'':'s'} filled.`:''}`);}catch(e){toast(e.message)}finally{loading(btn,false)}}
async function waitDecisionJob(jobId){for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,2000));try{const j=await api(`decision-job?id=${encodeURIComponent(jobId)}`);if(j.status==='COMPLETE')return j;if(j.status==='ERROR')throw new Error(j.error||'Decision audit failed.')}catch(e){if(e.message!=='JOB_NOT_FOUND')throw e}}throw new Error('Decision audit is still running. Refresh Decisions shortly.')}
async function runDecisionFor(asset,btn,forceRefresh=false){if(!asset){toast('Enter an asset symbol.');return}const jobId=crypto.randomUUID();loading(btn,true,'Running full audit');try{await api('decision-run',{method:'POST',body:JSON.stringify({asset,forceRefresh,jobId}),timeoutMs:90000});await waitDecisionJob(jobId);await loadState();selectedAsset=asset;currentSection='asset';render();toast('Audited decision saved.');}catch(e){toast(e.message)}finally{loading(btn,false)}}
async function runDecision(){const sel=$('#decisionAsset');const asset=String(sel?.value||'').trim().toUpperCase();if(!asset){toast('Choose an asset.');return}const btn=$('#runDecisionBtn'),jobId=crypto.randomUUID();loading(btn,true,'Running Decision Review + final gate');try{await api('decision-run',{method:'POST',body:JSON.stringify({asset,forceRefresh:$('#forceMarketRefresh')?.checked===true,jobId}),timeoutMs:90000});await waitDecisionJob(jobId);await loadState();nav('insight');toast('Audited decision saved.');}catch(e){toast(e.message)}finally{loading(btn,false)}}

async function waitAIMirrorJob(jobId){
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{
      const j=await api(`ai-mirror-job?id=${encodeURIComponent(jobId)}`);
      if(j.status==='COMPLETE'){
        if(j.ok===false || j.error==='FINAL_GATE_REJECTED'){
          const reasons=(j.rejectionReasons||[]).slice(0,4).join(' · ');
          const detail=j.message||reasons||j.error||'FINAL_GATE_REJECTED';
          const err=new Error(detail);
          err.code=j.error||'FINAL_GATE_REJECTED';
          err.rejectionReasons=j.rejectionReasons||[];
          throw err;
        }
        return j;
      }
      if(j.status==='ERROR'){
        const err=new Error(j.message||j.error||'AI Mirror failed.');
        err.code=j.error||'AI_MIRROR_ERROR';
        throw err;
      }
    }catch(e){
      if(e.message==='JOB_NOT_FOUND') continue;
      throw e;
    }
  }
  throw new Error('AI Mirror is still running. Refresh AI Mirror shortly.');
}
async function runAIMirror(ev){
  const budget=Number($('#aiMirrorBudget')?.value||0);
  const focus=$('#aiMirrorFocus')?.value||mirrorFocus||'all';
  if(!Number.isFinite(budget)||budget<=0){
    toast('Enter a mirrored budget greater than zero before building the portfolio.');
    const budgetEl=$('#aiMirrorBudget'); if(budgetEl){ try{budgetEl.focus(); budgetEl.select?.();}catch{} }
    return;
  }
  mirrorFocus=focus;
  const btns=[ $('#runAIMirrorWholeBtn'), $('#runAIMirrorBtn') ].filter(Boolean);
  const target=ev?.currentTarget || ev?.target;
  if(target && target.closest && !btns.includes(target)){
    const hit=btns.find(b=>b===target||b.contains?.(target));
    if(hit && !btns.includes(hit)) btns.push(hit);
  }
  if(focus==='all') toast('Building whole portfolio…');
  for(const b of btns) loading(b,true, focus==='all'?'Building whole portfolio…':'Building + auditing');
  const jobId=crypto.randomUUID();
  try{
    // Background function returns immediately; poll job status (mirrors decision-run / decision-job).
    await api('ai-mirror',{method:'POST',body:JSON.stringify({budget,focus,jobId}),timeoutMs:30000});
    const jobResult=await waitAIMirrorJob(jobId);
    await loadState();
    nav('aimirror');
    toast(jobResult?.conservativeRelease?'AI Mirror released (conservative paper pass).':'AI Mirror passed the final gate.');
  }catch(e){
    await loadState().catch(()=>{});
    nav('aimirror');
    const raw=String(e.message||e);
    const code=e.code||'';
    if(code==='FINAL_GATE_REJECTED' || raw==='FINAL_GATE_REJECTED' || /final gate rejected/i.test(raw)){
      toast(raw==='FINAL_GATE_REJECTED'
        ? 'Final gate rejected the mirror. See AI Mirror for reasons.'
        : `Gate withheld: ${raw.slice(0,180)}`);
    }else toast(friendlyError(raw));
  }finally{
    for(const b of btns) loading(b,false);
  }
}
async function applyMirrorToWallet(){
  const btn=$('#applyMirrorWalletBtn');
  const m=state?.aiMirror;
  if(!m || m.status!=='APPROVED' || !(m.allocation||[]).length){toast('Run an approved AI Mirror first.');return;}
  const budget=Number($('#aiMirrorBudget')?.value||m.budget||0);
  const focus=$('#aiMirrorFocus')?.value||m.focus||'all';
  loading(btn,true,'Applying paper trades');
  try{
    const r=await api('portfolio-build',{method:'POST',body:JSON.stringify({action:'buildFromMirror',budget,focus,source:'ai-mirror'}),timeoutMs:60000});
    await loadState();
    nav('wallet');
    const buyList=(r.buys||[]).map(b=>`${b.symbol} ${b.quantity}@${b.unitPrice}`).join(', ');
    const skip=(r.skipped||[]).length?` Skipped: ${r.skipped.map(s=>`${s.symbol}(${s.reason})`).join(', ')}.`:'';
    toast(`Paper wallet updated — deposited ${money(r.deposited||0)}; buys: ${buyList||'none'}.${skip}`);
  }catch(e){toast(e.message);}
  finally{loading(btn,false)}
}
async function waitWalletMirrorJob(jobId){
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{
      const j=await api(`wallet-mirror-job?id=${encodeURIComponent(jobId)}`);
      if(j.status==='COMPLETE'){
        if(j.ok===false) throw new Error(j.error||'FINAL_GATE_REJECTED');
        return j;
      }
      if(j.status==='ERROR') throw new Error(j.error||'Wallet Mirror failed.');
    }catch(e){ if(e.message==='JOB_NOT_FOUND') continue; throw e; }
  }
  throw new Error('Wallet Mirror is still running. Refresh Wallet shortly.');
}
async function runWalletMirror(){
  const btn=$('#runWalletMirrorBtn'); loading(btn,true,'Analyzing + auditing');
  const jobId=crypto.randomUUID();
  try{
    await api('wallet-mirror',{method:'POST',body:JSON.stringify({jobId}),timeoutMs:30000});
    await waitWalletMirrorJob(jobId);
    await loadState(); nav('wallet'); toast('Wallet Mirror passed the final gate.');
  }
  catch(e){await loadState().catch(()=>{});nav('wallet');toast(e.message==='FINAL_GATE_REJECTED'?'Final gate rejected the wallet report.':'Wallet Mirror: '+e.message);}
  finally{loading(btn,false)}
}
async function waitEvolutionJob(jobId){
  for(let i=0;i<120;i++){
    await new Promise(r=>setTimeout(r,2000));
    try{
      const j=await api(`evolution-job?id=${encodeURIComponent(jobId)}`);
      if(j.status==='COMPLETE') return j;
      if(j.status==='ERROR') throw new Error(j.error||'Evolution cycle failed.');
    }catch(e){ if(e.message==='JOB_NOT_FOUND') continue; throw e; }
  }
  throw new Error('Evolution cycle is still running. Refresh Learning Lab shortly.');
}
async function runEvolutionCycle(){
  const btn=$('#runEvolutionBtn'); loading(btn,true,'Observe → diagnose → test');
  const jobId=crypto.randomUUID();
  try{
    await api('evolution-cycle',{method:'POST',body:JSON.stringify({jobId}),timeoutMs:30000});
    const j=await waitEvolutionJob(jobId);
    await loadState(); insightPane='evolution'; render(); toast(`Evolution cycle: ${j?.cycleStatus||state?.evolution?.cycleStatus||'complete'}`);
  }
  catch(e){toast(e.message)}finally{loading(btn,false)}
}
async function promoteEvolution(){
  const btn=$('#promoteEvolutionBtn'); loading(btn,true,'Promoting winner');
  try{const r=await api('evolution-lab',{method:'POST',body:JSON.stringify({action:'promote'})});state.evolution=r.evolution;render();toast('Challenger promoted to production champion.');}
  catch(e){toast(e.message)}finally{loading(btn,false)}
}
async function discardEvolution(){
  const btn=$('#discardEvolutionBtn'); loading(btn,true,'Discarding');
  try{const r=await api('evolution-lab',{method:'POST',body:JSON.stringify({action:'discard'})});state.evolution=r.evolution;render();toast('Challenger discarded.');}
  catch(e){toast(e.message)}finally{loading(btn,false)}
}
async function saveEvolutionSettings(){
  const btn=$('#saveEvolutionSettingsBtn'); loading(btn,true,'Saving');
  try{await api('account',{method:'POST',body:JSON.stringify({action:'saveSettings',settings:{...state.settings,evolutionAutoRun:$('#sEvolutionAutoRun')?.checked===true,evolutionAutoPromote:$('#sEvolutionAutoPromote')?.checked===true}})});await loadState();nav('insight');toast('Evolution controls saved.');}
  catch(e){toast(e.message)}finally{loading(btn,false)}
}
function closeRuntimeModal(){ $('#runtimeModal')?.remove(); }
function openRuntimeModal({title,body,submitLabel='Save',danger=false,onSubmit}){
  closeRuntimeModal();
  const el=document.createElement('div');
  el.id='runtimeModal';
  el.className='onboarding-modal';
  el.style.display='flex';
  el.setAttribute('role','dialog');
  el.setAttribute('aria-modal','true');
  el.setAttribute('aria-label',title);
  el.innerHTML=`<form class="modal-card runtime-modal-card"><div class="row"><div><h2 style="font-size:32px;margin:0">${esc(title)}</h2><div class="muted">KAIROS validates this server-side before saving.</div></div><button class="ghost-btn" type="button" data-modal-close>Close</button></div><div style="margin-top:18px">${body}</div><div class="row modal-actions" style="margin-top:18px"><button class="ghost-btn" type="button" data-modal-close>Cancel</button><button class="${danger?'ghost-btn red':'primary-btn'}" type="submit">${esc(submitLabel)}</button></div></form>`;
  document.body.appendChild(el);
  $$('[data-modal-close]',el).forEach(b=>b.onclick=closeRuntimeModal);
  el.addEventListener('click',e=>{ if(e.target===el) closeRuntimeModal(); });
  $('form',el).onsubmit=async e=>{
    e.preventDefault();
    const btn=$('button[type="submit"]',el);
    loading(btn,true,'Saving');
    try{ await onSubmit(el); closeRuntimeModal(); }
    catch(err){ toast(err.message); loading(btn,false); }
  };
  setTimeout(()=>$('input,select,textarea',el)?.focus(),80);
}
function depositDialog(){
  const today=new Date().toISOString().slice(0,10);
  openRuntimeModal({title:'Add simulated cash',submitLabel:'Add cash',body:`<div class="field"><label>Amount</label><input id="brokerDepositAmount" class="text-input" type="number" step="any" min="0" placeholder="1000"></div><div class="field" style="margin-top:12px"><label>Date</label><input id="brokerDepositDate" class="text-input" type="date" value="${today}" max="${today}"></div><div class="alert warn" style="margin-top:12px">Simulation only. This does not move real money.</div>`,onSubmit:async modal=>{const amount=Number($('#brokerDepositAmount',modal).value);await api('portfolio',{method:'POST',body:JSON.stringify({action:'addTransaction',transaction:{type:'DEPOSIT',amount,date:$('#brokerDepositDate',modal).value,note:'Broker simulator cash'}})});await loadState();nav('broker');toast('Simulated cash added.');}});
}
function brokerTradeDialog(symbol,side='BUY'){
  const x=(marketUniverse||[]).find(a=>a.symbol===symbol); const pos=state.portfolio?.derived?.positions?.find(p=>p.symbol===symbol);
  const price=Number(x?.current?.price||pos?.price||0); const action=String(side).toUpperCase()==='SELL'?'SELL':'BUY';
  const label=x?.label||symbol, cash=Number(state.portfolio?.derived?.cash||0), held=Number(pos?.quantity||0);
  openRuntimeModal({
    title:`${action==='BUY'?'Buy':'Sell'} ${symbol} · Paper Order`,
    submitLabel:'Review & place',
    body:`<div class="v7-trade-hero"><div><span class="v7-kicker">${esc(label)}</span><strong>${esc(symbol)}</strong><small>${price>0?`Recorded mark ${money(price)}`:'Fresh mark unavailable — refresh before Market order'}</small></div><div><span>${action==='BUY'?'BUYING POWER':'HELD'}</span><strong>${action==='BUY'?money(cash):held.toFixed(6)}</strong></div></div>
      <div class="v7-side-strip"><span class="${action==='BUY'?'buy':'sell'}">${action}</span><small>Simulation only · server validates cash, holdings and mark freshness</small></div>
      <div class="form-grid v7-trade-form">
        <div class="field"><label>Order type</label><select id="brokerOrderType" class="select"><option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP">Stop</option><option value="STOP_LIMIT">Stop Limit</option></select></div>
        <div class="field"><label>Enter as</label><select id="brokerAmountMode" class="select"><option value="SHARES">Shares</option><option value="DOLLARS">Dollars</option></select></div>
        <div class="field" id="brokerSharesField"><label>Shares · fractional enabled</label><input id="brokerQty" class="text-input" type="number" step="any" min="0" placeholder="0.0000"></div>
        <div class="field hidden" id="brokerDollarsField"><label>Dollar amount</label><input id="brokerDollars" class="text-input" type="number" step="any" min="0" placeholder="100"></div>
        <div class="field hidden" id="brokerLimitField"><label>Limit price</label><input id="brokerLimitPrice" class="text-input" type="number" step="any" min="0" value="${price>0?price:''}"></div>
        <div class="field hidden" id="brokerStopField"><label>Stop price</label><input id="brokerStopPrice" class="text-input" type="number" step="any" min="0" value="${price>0?(action==='BUY'?price*1.02:price*.98).toFixed(2):''}"></div>
        <div class="field"><label>Fees (simulation)</label><input id="brokerFees" class="text-input" type="number" step="any" min="0" value="0"></div>
        <div class="field"><label>Note</label><input id="brokerOrderNote" class="text-input" maxlength="240" placeholder="Optional"></div>
      </div>
      <div class="v7-order-preview" id="brokerOrderPreview"></div>
      <div class="alert warn"><strong>Paper execution only.</strong> Market orders require a fresh stored mark. Limit / Stop orders remain open and are evaluated against fresh marks during market refresh / Decision History. No brokerage connection exists.</div>`,
    onSubmit:async modal=>{
      const orderType=$('#brokerOrderType',modal).value; const mode=$('#brokerAmountMode',modal).value;
      const limitPrice=Number($('#brokerLimitPrice',modal).value||0), stopPrice=Number($('#brokerStopPrice',modal).value||0), fees=Number($('#brokerFees',modal).value||0);
      let ref=price; if(orderType==='LIMIT'||orderType==='STOP_LIMIT') ref=limitPrice||ref; else if(orderType==='STOP') ref=stopPrice||ref;
      let quantity=mode==='SHARES'?Number($('#brokerQty',modal).value||0):(Number($('#brokerDollars',modal).value||0)/Number(ref||0));
      if(!(quantity>0)) throw new Error('Enter a valid share or dollar amount.');
      const order={symbol,side:action,quantity,orderType,limitPrice,stopPrice,fees,note:$('#brokerOrderNote',modal).value};
      const r=await api('portfolio',{method:'POST',body:JSON.stringify({action:'placeOrder',order})});
      await loadState(); selectedMarketId=x?.id||selectedMarketId; nav('broker');
      toast(r.order?.status==='FILLED'?`Paper ${action.toLowerCase()} filled at ${money(r.order.fillPrice)}.`:`${String(orderType).replaceAll('_',' ')} ${action} order placed.`);
    }
  });
  const modal=$('#runtimeModal'); if(!modal)return;
  const refresh=()=>{
    const type=$('#brokerOrderType',modal).value, mode=$('#brokerAmountMode',modal).value;
    $('#brokerSharesField',modal).classList.toggle('hidden',mode!=='SHARES'); $('#brokerDollarsField',modal).classList.toggle('hidden',mode!=='DOLLARS');
    $('#brokerLimitField',modal).classList.toggle('hidden',!type.includes('LIMIT')); $('#brokerStopField',modal).classList.toggle('hidden',!type.includes('STOP'));
    const lp=Number($('#brokerLimitPrice',modal).value||0), sp=Number($('#brokerStopPrice',modal).value||0); let ref=price;
    if(type==='LIMIT'||type==='STOP_LIMIT') ref=lp||ref; else if(type==='STOP') ref=sp||ref;
    const qty=mode==='SHARES'?Number($('#brokerQty',modal).value||0):(Number($('#brokerDollars',modal).value||0)/Number(ref||0));
    const est=qty>0&&ref>0?qty*ref+Number($('#brokerFees',modal).value||0):0;
    const target=type==='MARKET'?(price>0?`Fresh stored mark · UI ${money(price)}`:'Refresh required'):type==='LIMIT'?`Limit ${lp>0?money(lp):'—'}`:type==='STOP'?`Stop ${sp>0?money(sp):'—'}`:`Stop ${sp>0?money(sp):'—'} → Limit ${lp>0?money(lp):'—'}`;
    $('#brokerOrderPreview',modal).innerHTML=`<span>ORDER PREVIEW</span><div><strong>${action} ${qty>0?qty.toFixed(4):'—'} ${esc(symbol)}</strong><b>${esc(target)}</b></div><small>${est>0?`Approx. value ${money(est)}`:'Enter an amount'} · ${action==='BUY'?`cash ${money(cash)}`:`held ${held.toFixed(4)}`}</small>`;
  };
  ['brokerOrderType','brokerAmountMode','brokerQty','brokerDollars','brokerLimitPrice','brokerStopPrice','brokerFees'].forEach(id=>$('#'+id,modal)?.addEventListener('input',refresh));
  $('#brokerOrderType',modal)?.addEventListener('change',refresh); $('#brokerAmountMode',modal)?.addEventListener('change',refresh); refresh();
}

function transactionDialog(opening){
  const today=new Date().toISOString().slice(0,10);
  const typeSelect=opening?`<input id="txType" type="hidden" value="OPENING_POSITION"><div class="alert warn">Opening positions are treated as external in-kind transfers. They preserve cost basis without creating fake performance.</div>`:`<div class="field"><label>Type</label><select id="txType" class="select">${['DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND','INTEREST','FEE','TAX'].map(x=>`<option>${x}</option>`).join('')}</select></div>`;
  openRuntimeModal({
    title:opening?'Add opening position':'Add transaction',
    submitLabel:'Save transaction',
    body:`${typeSelect}<div class="form-grid" style="margin-top:12px"><div class="field"><label>Date</label><input id="txDate" class="text-input" type="date" value="${today}" max="${today}"></div><div class="field"><label>Symbol</label><select id="txSymbol" class="select"><option value="">Select asset</option>${universeSymbolSet().map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div class="field"><label>Quantity</label><input id="txQty" class="text-input" type="number" step="any" min="0" placeholder="0"></div><div class="field"><label>Unit Price / Mark</label><input id="txPrice" class="text-input" type="number" step="any" min="0" placeholder="0"></div><div class="field"><label>Cash Amount</label><input id="txAmount" class="text-input" type="number" step="any" min="0" placeholder="0"></div><div class="field"><label>Fees</label><input id="txFees" class="text-input" type="number" step="any" min="0" value="0"></div><div class="field"><label>Taxes</label><input id="txTaxes" class="text-input" type="number" step="any" min="0" value="0"></div><div class="field"><label>Note</label><input id="txNote" class="text-input" maxlength="500" placeholder="Optional"></div></div><div class="tiny" style="margin-top:10px">Future dates and invalid dates are rejected. For buys, add tracked cash first or explicitly allow negative cash in a future production control.</div>`,
    onSubmit:async modal=>{
      const type=$('#txType',modal).value;
      const t={type,date:$('#txDate',modal).value,note:$('#txNote',modal).value};
      if(['OPENING_POSITION','BUY','SELL'].includes(type)){
        t.symbol=$('#txSymbol',modal).value.trim().toUpperCase();
        t.quantity=Number($('#txQty',modal).value);
        t.unitPrice=Number($('#txPrice',modal).value);
        t.fees=Number($('#txFees',modal).value||0);
        t.taxes=Number($('#txTaxes',modal).value||0);
      }else{
        t.amount=Number($('#txAmount',modal).value);
        t.symbol=$('#txSymbol',modal).value.trim().toUpperCase();
      }
      await api('portfolio',{method:'POST',body:JSON.stringify({action:'addTransaction',transaction:t})});
      await loadState(); nav('wallet'); toast('Transaction saved.');
    }
  });
}
async function setMark(symbol){
  openRuntimeModal({
    title:`Set ${symbol} manual mark`,
    submitLabel:'Save manual mark',
    body:`<div class="field"><label>Manual display price</label><input id="markPrice" class="text-input" type="number" step="any" min="0" placeholder="0"></div><div class="tiny" style="margin-top:10px">Manual marks are user-entered display/simulation data. They never qualify as verified automatic-execution or Decision Review evidence.</div>`,
    onSubmit:async modal=>{
      const price=Number($('#markPrice',modal).value);
      await api('portfolio',{method:'POST',body:JSON.stringify({action:'setMark',symbol,price})});
      await loadState(); nav('wallet'); toast('Manual mark saved for display/simulation.');
    }
  });
}
async function deleteTx(id){
  openRuntimeModal({
    title:'Delete transaction',
    submitLabel:'Delete',
    danger:true,
    body:`<div class="alert bad">This removes the ledger row and recalculates derived cash, cost basis, holdings, and performance inputs. This does not touch authentication or settings.</div>`,
    onSubmit:async()=>{
      await api('portfolio',{method:'POST',body:JSON.stringify({action:'deleteTransaction',id})});
      await loadState(); nav('wallet'); toast('Transaction deleted.');
    }
  });
}

async function startBillingCheckout(){
  const btn=$('#billingCheckoutBtn'); loading(btn,true,'Opening Stripe');
  try{ const r=await api('billing-checkout',{method:'POST',body:'{}'}); const u=safeHttpUrl(r.url); if(!u||!u.startsWith('https://checkout.stripe.com/')) throw new Error('Invalid Stripe Checkout URL.'); location.href=u; }
  catch(e){toast(friendlyError(e.message||e)); loading(btn,false);}
}
async function openBillingPortal(){
  const btn=$('#billingPortalBtn'); loading(btn,true,'Opening Stripe');
  try{ const r=await api('billing-portal',{method:'POST',body:'{}'}); const u=safeHttpUrl(r.url); if(!u||!u.startsWith('https://billing.stripe.com/')) throw new Error('Invalid Stripe billing URL.'); location.href=u; }
  catch(e){toast(friendlyError(e.message||e)); loading(btn,false);}
}

async function saveProfile(){const p={...state.profile,name:$('#sName').value.trim(),email:$('#sEmail').value.trim(),country:$('#sCountry').value.trim(),baseCurrency:$('#sCurrency').value,goal:$('#sGoal').value.trim(),targetAmount:Number($('#sTarget').value||0),horizon:$('#sHorizon').value,contributionAmount:Number($('#sContribution').value||0),experience:$('#sExperience').value,riskCapacity:$('#sRiskCapacity').value,maxDrawdownTolerance:Number($('#sDrawdown').value||0),liquidityNeed:$('#sLiquidity').value,emergencyReserveMonths:Number($('#sReserve').value||0),incomeStability:$('#sIncomeStability').value,taxResidency:$('#sTaxResidency').value.trim()};try{await api('account',{method:'POST',body:JSON.stringify({action:'saveProfile',profile:p})});await loadState();nav('settings');toast('Profile saved.')}catch(e){toast(e.message)}}
async function saveRisk(riskStyle){try{await api('account',{method:'POST',body:JSON.stringify({action:'saveProfile',profile:{...state.profile,riskStyle}})});await loadState();nav('settings')}catch(e){toast(e.message)}}
async function saveDisplay(displayMode){try{await api('account',{method:'POST',body:JSON.stringify({action:'saveSettings',settings:{...state.settings,displayMode}})});await loadState();nav('settings')}catch(e){toast(e.message)}}
async function saveSystemSettings(){try{await api('account',{method:'POST',body:JSON.stringify({action:'saveSettings',settings:{...state.settings,autoMarketMarks:$('#sAutoMarks').checked}})});await loadState();nav('settings');toast('System settings saved.')}catch(e){toast(e.message)}}
async function changeCredentials(){const identityAuth=state.auth?.authProvider==='netlify_identity',newUsername=$('#sUsername')?.value.trim()||'';if(identityAuth){try{await api('account',{method:'POST',body:JSON.stringify({action:'updateCredentials',newUsername})});await loadState();nav('settings');toast('Display username saved.')}catch(e){toast(e.message)}return}const currentPassword=$('#sCurrentPw')?.value||'',newPassword=$('#sNewPw')?.value||'';if(!currentPassword){toast('Current password required.');return}try{await api('account',{method:'POST',body:JSON.stringify({action:'updateCredentials',currentPassword,newPassword,newUsername})});toast('Credentials changed. Please sign in again.');setTimeout(()=>location.reload(),800)}catch(e){toast(e.message)}}
async function exportBackup(){try{const b=await api('backup');const blob=new Blob([JSON.stringify(b,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`kairos-workspace-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)}catch(e){toast(e.message)}}
function importBackup(){const i=document.createElement('input');i.type='file';i.accept='.json';i.onchange=()=>{const f=i.files[0];if(!f)return;const r=new FileReader();r.onload=async()=>{try{const b=JSON.parse(r.result);await api('backup',{method:'POST',body:JSON.stringify(b)});await loadState();toast('Backup restored.')}catch(e){toast(e.message)}};r.readAsText(f)};i.click()}

async function sendChat(){const input=$('#chatInput'),q=input.value.trim();if(!q)return;appendChat('user',q);input.value='';$('#chatCitations').innerHTML='';const btn=$('#chatSendBtn');loading(btn,true,'Thinking');try{const r=await api('ai-chat',{method:'POST',body:JSON.stringify({question:q,screen:currentSection}),timeoutMs:60000});appendChat('ai',r.answer||r.message||'Done.');if(r.walletBuild?.buys?.length){await loadState().catch(()=>{});} $('#chatCitations').innerHTML=(r.citations||[]).map(c=>({...c,_url:safeHttpUrl(c?.url)})).filter(c=>c._url).slice(0,6).map(c=>`<a class="citation-link" href="${esc(c._url)}" target="_blank" rel="noopener noreferrer">${esc(c.title||c._url)}</a>`).join('')}catch(e){const raw=String(e.message||e); const nice=friendlyError(/404|504|TIMEOUT|timed out|ALL_PROVIDERS|MODEL_NOT_FOUND/i.test(raw)?( /404/.test(raw) && !/MODEL_NOT_FOUND/.test(raw) ? 'AI Gateway timed out — retry, then check System Health / Netlify AI credits (server often surfaces Netlify timeouts as a failed fetch).' : raw):raw); appendChat('ai',`I couldn't answer because: ${nice}`)}finally{loading(btn,false)}}
function appendChat(role,text){const box=$('#chatMessages');const d=document.createElement('div');d.className=`msg ${role}`;d.textContent=text;box.appendChild(d);box.scrollTop=box.scrollHeight;}

function showOnboarding(){
  if($('#onboard'))return;
  const el=document.createElement('div'); el.id='onboard'; el.className='onboarding-modal v7-onboarding'; el.style.display='flex';
  const draft={
    name:state.profile.name==='Private User'?'':state.profile.name,
    country:state.profile.country||'United States', goal:state.profile.goal||'Long-term wealth', targetAmount:Number(state.profile.targetAmount||250000),
    riskStyle:state.profile.riskStyle||'Moderate', horizon:state.profile.horizon||'10y+', maxDrawdownTolerance:Number(state.profile.maxDrawdownTolerance||20), liquidityNeed:state.profile.liquidityNeed||'Moderate',
    contributionAmount:Number(state.profile.contributionAmount||1000), emergencyReserveMonths:Number(state.profile.emergencyReserveMonths||6), startingCash:0
  };
  let step=0;
  const steps=[
    ()=>`<div class="ob-step"><span class="v7-kicker">1 OF 3 · YOUR TARGET</span><h2>Build your financial twin.</h2><p>Your profile shapes paper simulations and research context. It does not authorize real-world trades.</p><div class="form-grid"><div class="field"><label>Name</label><input id="obName" class="text-input" value="${esc(draft.name)}" placeholder="Your name"></div><div class="field"><label>Country</label><input id="obCountry" class="text-input" value="${esc(draft.country)}"></div><div class="field"><label>Primary goal</label><input id="obGoal" class="text-input" value="${esc(draft.goal)}"></div><div class="field"><label>Target amount</label><input id="obTarget" class="text-input" type="number" min="0" value="${draft.targetAmount}"></div></div></div>`,
    ()=>`<div class="ob-step"><span class="v7-kicker">2 OF 3 · RISK & TIME</span><h2>Define the guardrails.</h2><p>These guardrails are used for paper scenarios and risk context only.</p><div class="field"><label>Risk style</label><div class="ob-segment" data-ob-risk>${['Conservative','Moderate','Aggressive'].map(x=>`<button type="button" class="${draft.riskStyle===x?'active':''}" data-value="${x}">${x}</button>`).join('')}</div></div><div class="form-grid"><div class="field"><label>Horizon</label><select id="obHorizon" class="select">${['<1y','1-3y','3-10y','10y+'].map(x=>`<option ${draft.horizon===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Liquidity need</label><select id="obLiquidity" class="select">${['Low','Moderate','High'].map(x=>`<option ${draft.liquidityNeed===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Max drawdown tolerance · %</label><input id="obDrawdown" class="text-input" type="number" min="0" max="95" value="${draft.maxDrawdownTolerance}"></div></div></div>`,
    ()=>`<div class="ob-step"><span class="v7-kicker">3 OF 3 · FUNDING RHYTHM</span><h2>Make it usable every month.</h2><p>Set your contribution plan and optional starting paper cash.</p><div class="form-grid"><div class="field"><label>Monthly contribution</label><input id="obContribution" class="text-input" type="number" min="0" value="${draft.contributionAmount}"></div><div class="field"><label>Emergency reserve · months</label><input id="obReserve" class="text-input" type="number" min="0" max="60" value="${draft.emergencyReserveMonths}"></div><div class="field"><label>Starting tracked cash · optional</label><input id="obCash" class="text-input" type="number" min="0" value="${draft.startingCash}"></div></div><div class="ob-review"><span>GOAL <strong>${esc(draft.goal)}</strong></span><span>RISK <strong>${esc(draft.riskStyle)}</strong></span><span>HORIZON <strong>${esc(draft.horizon)}</strong></span></div><div class="alert warn">Opening holdings should be imported later as <strong>Opening Positions</strong>. That preserves cost basis without pretending they were bought today.</div></div>`
  ];
  const sync=()=>{
    draft.name=$('#obName',el)?.value??draft.name; draft.country=$('#obCountry',el)?.value??draft.country; draft.goal=$('#obGoal',el)?.value??draft.goal; draft.targetAmount=Number($('#obTarget',el)?.value??draft.targetAmount);
    draft.horizon=$('#obHorizon',el)?.value??draft.horizon; draft.liquidityNeed=$('#obLiquidity',el)?.value??draft.liquidityNeed; draft.maxDrawdownTolerance=Number($('#obDrawdown',el)?.value??draft.maxDrawdownTolerance);
    draft.contributionAmount=Number($('#obContribution',el)?.value??draft.contributionAmount); draft.emergencyReserveMonths=Number($('#obReserve',el)?.value??draft.emergencyReserveMonths); draft.startingCash=Number($('#obCash',el)?.value??draft.startingCash);
  };
  const paint=()=>{
    el.innerHTML=`<div class="modal-card ob-card"><div class="ob-brand"><img src="/kairos-mark.png?v=7.3.0" alt=""><div><span>KAIROS PAPER BROKER</span><strong>Configure your paper research profile</strong></div></div><div class="ob-progress">${[0,1,2].map(i=>`<i class="${i<=step?'active':''}"></i>`).join('')}</div>${steps[step]()}<div class="ob-actions"><button class="ghost-btn" id="obSkip" type="button">Skip for now</button><div>${step>0?`<button class="ghost-btn" id="obBack" type="button">Back</button>`:''}<button class="primary-btn" id="obNext" type="button">${step===2?'Enter KAIROS':'Continue'}</button></div></div></div>`;
    $$('[data-ob-risk] button',el).forEach(b=>b.onclick=()=>{draft.riskStyle=b.dataset.value;paint();});
    $('#obBack',el)?.addEventListener('click',()=>{sync();step=Math.max(0,step-1);paint();});
    $('#obSkip',el).onclick=async()=>{try{await api('account',{method:'POST',body:JSON.stringify({action:'saveSettings',settings:{...state.settings,onboardingComplete:true}})});}catch{}el.remove();};
    $('#obNext',el).onclick=async()=>{
      sync();
      if(step<2){step++;paint();return;}
      const btn=$('#obNext',el);loading(btn,true,'Saving twin');
      try{
        const profile={...state.profile,name:draft.name.trim()||'Private User',country:draft.country.trim()||state.profile.country,goal:draft.goal.trim()||state.profile.goal,targetAmount:draft.targetAmount,riskStyle:draft.riskStyle,horizon:draft.horizon,maxDrawdownTolerance:draft.maxDrawdownTolerance,liquidityNeed:draft.liquidityNeed,contributionAmount:draft.contributionAmount,emergencyReserveMonths:draft.emergencyReserveMonths};
        await api('account',{method:'POST',body:JSON.stringify({action:'saveProfile',profile})});
        await api('account',{method:'POST',body:JSON.stringify({action:'saveSettings',settings:{...state.settings,onboardingComplete:true}})});
        if(draft.startingCash>0) await api('portfolio',{method:'POST',body:JSON.stringify({action:'addTransaction',transaction:{type:'DEPOSIT',amount:draft.startingCash,date:new Date().toISOString().slice(0,10),note:'Opening tracked cash'}})});
        el.remove(); await loadState(); toast('Financial twin configured.');
      }catch(e){toast(e.message);loading(btn,false)}
    };
  };
  document.body.appendChild(el); paint();
}

function lineChart(s1=[],s2=null,s3=null,colors=['#f2c94c','#b8c4d6','#ffae42']){if(!s1?.length)return `<div class="alert warn">No chart observations yet.</div>`;const series=[s1,s2,s3].filter(x=>x?.length),all=series.flat(),W=760,H=270,P=22,min=Math.min(...all),max=Math.max(...all);const path=s=>s.map((v,i)=>{const x=P+i*(W-2*P)/(s.length-1||1),y=H-P-((v-min)/(max-min||1))*(H-2*P);return `${i?'L':'M'} ${x.toFixed(1)} ${y.toFixed(1)}`}).join(' ');return `<svg class="chart chart-glow" viewBox="0 0 ${W} ${H}">${[0,1,2,3,4].map(i=>`<line x1="${P}" y1="${P+i*(H-2*P)/4}" x2="${W-P}" y2="${P+i*(H-2*P)/4}" stroke="rgba(255,255,255,.06)"/>`).join('')}${series.map((s,i)=>`<path d="${path(s)}" fill="none" stroke="${colors[i]}" stroke-width="${i?2.2:3}"/>`).join('')}</svg>`;}
function greeting(){const h=new Date().getHours();return h<12?'morning':h<18?'afternoon':'evening';}

function openAdvisor(context='Current screen'){
  const d=$('#advisorDrawer'); if(!d)return;
  d.classList.add('open'); d.setAttribute('aria-hidden','false');
  const l=$('#advisorContextLabel'); if(l)l.textContent=context||currentSection;
  setTimeout(()=>$('#chatInput')?.focus(),120);
}
function closeAdvisor(){const d=$('#advisorDrawer');if(!d)return;d.classList.remove('open');d.setAttribute('aria-hidden','true');}
function openSystem(){const d=$('#systemDrawer');if(!d)return;d.classList.add('open');d.setAttribute('aria-hidden','false');}
function closeSystem(){const d=$('#systemDrawer');if(!d)return;d.classList.remove('open');d.setAttribute('aria-hidden','true');}

$$('.nav-btn,.footer-btn').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.section)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.go)));
$('#loginBtn').onclick=login;
$('#signupOpenBtn').onclick=openSignup;
$('#signupCloseBtn').onclick=closeSignup;
$('#signupBtn').onclick=signup;
$('#loginPass').onkeydown=e=>{if(e.key==='Enter')login()};
$('#lockBtn').onclick=logout;
$('#userAvatar').onclick=()=>nav('settings');
$('#userAvatar').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();nav('settings')}};
$('#refreshBtn').onclick=loadState;
$('#advisorOpenBtn').onclick=()=>openAdvisor(currentSection);
$('#advisorCloseBtn').onclick=closeAdvisor;
$$('[data-close-advisor]').forEach(x=>x.onclick=closeAdvisor);
$('#systemOpenBtn').onclick=openSystem;
$('#systemCloseBtn').onclick=closeSystem;
$$('[data-close-system]').forEach(x=>x.onclick=closeSystem);
$('#chatSendBtn').onclick=sendChat;
$('#chatInput').onkeydown=e=>{if(e.key==='Enter')sendChat()};
$('#explainScreenBtn').onclick=()=>{openAdvisor(currentSection);$('#chatInput').value=`Explain the ${currentSection} screen and the most important thing I should understand.`;sendChat()};
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if($('#runtimeModal')){closeRuntimeModal();return}if($('#advisorDrawer')?.classList.contains('open')){closeAdvisor();return}if($('#systemDrawer')?.classList.contains('open'))closeSystem();});
(async()=>{ await processIdentityCallback(); await loadAuthConfig(); await checkSession(); })();

// Lock scroll if login is the first paint
if(!$('#loginScreen')?.classList.contains('hidden')){document.documentElement.classList.add('login-locked');document.body.classList.add('login-locked');}
