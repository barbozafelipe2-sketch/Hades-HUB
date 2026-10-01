/**
 * KAIROS Private V7.2 — hardened Netlify AI Gateway / cross-provider Decision Review / expanded universe
 * Run: npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  modelBelongsToProvider,
  resolveModelForProvider,
  preferredChainForRole,
  documentedFallbackChains,
  ROLE_PROVIDER_CHAINS,
  VALID_AI_ROLES,
  OPENAI_DEFAULT_MODEL,
  openAIModelCandidates,
  anyAIConfigured
} from '../netlify/lib/llm.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');

function read(rel){ return fs.readFileSync(path.join(root,rel),'utf8'); }
function clean(v){ return String(v||'').trim(); }

// --- 1) Provider/model isolation ---
{
  for(const m of ['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','o3-mini']) assert.equal(modelBelongsToProvider(m,'openai'),true);
  assert.equal(modelBelongsToProvider('claude-sonnet-5','anthropic'),true);
  assert.equal(modelBelongsToProvider('gemini-2.5-pro','gemini'),true);
  assert.equal(modelBelongsToProvider('claude-sonnet-5','openai'),false);
  assert.equal(modelBelongsToProvider('gemini-2.5-pro','anthropic'),false);
  assert.equal(resolveModelForProvider('openai','chat'),'gpt-5.6-luna');
  assert.equal(resolveModelForProvider('openai','primary'),'gpt-5.6-luna');
  assert.equal(resolveModelForProvider('openai','final_gate'),'gpt-5.6-terra');
  assert.equal(resolveModelForProvider('openai','decision_financial'),'gpt-5.6-luna');
  assert.equal(resolveModelForProvider('anthropic','decision_macro'),'claude-haiku-4-5');
  assert.equal(resolveModelForProvider('gemini','decision_causal'),'gemini-2.5-flash');
  assert.equal(resolveModelForProvider('openai','crown'),'gpt-5.6-terra','strong synthesis keeps its guarded model tier');
  assert.equal(resolveModelForProvider('anthropic','critic'),'claude-sonnet-5');
  assert.equal(resolveModelForProvider('gemini','risk'),'gemini-2.5-pro');
  assert.ok(openAIModelCandidates('gpt-5.6-terra').includes(OPENAI_DEFAULT_MODEL));
  console.log('ok provider/model isolation');
}

// --- 2) Role chains: cost-first + independent reviewers ---
{
  const doc=documentedFallbackChains();
  assert.equal(preferredChainForRole('chat')[0],'openai');
  assert.equal(preferredChainForRole('deep')[0],'openai');
  assert.equal(preferredChainForRole('critic')[0],'anthropic');
  assert.equal(preferredChainForRole('risk')[0],'gemini');
  assert.equal(preferredChainForRole('decision_macro')[0],'gemini');
  assert.equal(preferredChainForRole('decision_causal')[0],'anthropic');
  assert.equal(preferredChainForRole('final_gate')[0],'openai');
  assert.deepEqual(doc.market_research,[...ROLE_PROVIDER_CHAINS.market_research]);
  assert.ok(/Netlify AI Gateway/i.test(doc.note));
  assert.ok(VALID_AI_ROLES.includes('scenario'));
  assert.match(doc.decision_cost_policy,/fast-tier Luna\/Haiku\/Flash/);
  console.log('ok gateway role chains');
}

// --- 3) prefer-removal ---
{
  const gate=read('netlify/lib/ai-gate.mjs');
  assert.ok(!/prefer\s*===\s*['"]gemini['"]/.test(gate),'ai-gate must not map prefer===gemini');
  assert.ok(!/prefer\s*===\s*['"]openrouter['"]/.test(gate),'ai-gate must not map prefer===openrouter');
  assert.ok(/role\s*=\s*['"]primary['"]/.test(gate),'ai-gate uses explicit role');
  assert.ok(/CORE_1_ANALYST|DEVIL|CORE_3_RISK|CORE_4_JUDGE|gateway_cross_provider/.test(gate),'4-core sequential labels');
  const mirror=read('netlify/functions/ai-mirror.mjs');
  assert.ok(!/prefer\s*:\s*['"]gemini['"]/.test(mirror),'ai-mirror must not use prefer:gemini');
  assert.ok(/role\s*:\s*['"]primary['"]/.test(mirror),'ai-mirror uses role:primary');
  for(const rel of [
    'netlify/functions/wallet-mirror.mjs',
    'netlify/functions/decision-run.mjs',
    'netlify/lib/evolution.mjs',
    'netlify/lib/market-provider.mjs'
  ]){
    const src=read(rel);
    assert.ok(!/prefer\s*:/.test(src),`${rel} still has prefer:`);
  }
  console.log('ok prefer-removal + 4-core labels');
}

// --- 4) Multi-provider runtime + Gateway-ready configuration ---
{
  const llm=read('netlify/lib/llm.mjs');
  assert.ok(llm.includes('callAnthropic'));
  assert.ok(llm.includes('callGemini'));
  assert.ok(llm.includes('NETLIFY')||read('netlify/lib/env.mjs').includes('Netlify'));
  const prev={o:process.env.OPENAI_API_KEY,a:process.env.ANTHROPIC_API_KEY,g:process.env.GEMINI_API_KEY};
  delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.GEMINI_API_KEY;
  assert.equal(anyAIConfigured(),false);
  process.env.ANTHROPIC_API_KEY='test-anthropic';
  assert.equal(anyAIConfigured(),true,'Any Gateway-supported provider can keep AI operational');
  if(prev.o!=null)process.env.OPENAI_API_KEY=prev.o;else delete process.env.OPENAI_API_KEY;
  if(prev.a!=null)process.env.ANTHROPIC_API_KEY=prev.a;else delete process.env.ANTHROPIC_API_KEY;
  if(prev.g!=null)process.env.GEMINI_API_KEY=prev.g;else delete process.env.GEMINI_API_KEY;
  console.log('ok multi-provider runtime');
}

// --- 5) Chat hop timeout ---
{
  const llm=read('netlify/lib/llm.mjs');
  assert.ok(llm.includes('CHAT_PROVIDER_TIMEOUT_MS'));
  const { CHAT_PROVIDER_TIMEOUT_MS, providerTimeoutMs, preferredChainForRole: pref } = await import('../netlify/lib/llm.mjs');
  assert.ok(CHAT_PROVIDER_TIMEOUT_MS>=8000 && CHAT_PROVIDER_TIMEOUT_MS<=12000);
  assert.equal(providerTimeoutMs('chat'), CHAT_PROVIDER_TIMEOUT_MS);
  assert.equal(pref('chat')[0],'openai');
  assert.ok(pref('chat').includes('gemini')&&pref('chat').includes('anthropic'));
  const chatFn=read('netlify/functions/ai-chat.mjs');
  assert.ok(chatFn.includes('classifyCoachTier'));
  assert.ok(chatFn.includes('coach.role'));
  assert.ok(chatFn.includes('CHAT_TOTAL_BUDGET')||chatFn.includes('CHAT_TOTAL_BUDGET_MS'));
  console.log('ok chat reliability helpers');
}

// --- 6) Portfolio build helpers ---
{
  const { detectBuildWalletIntent, extractBudgetFromMessage, resolveKnownPrice, scaleAllocation } = await import('../netlify/lib/portfolio-build-helpers.mjs');
  assert.equal(detectBuildWalletIntent('build my wallet with $5000'), true);
  assert.equal(detectBuildWalletIntent('what is my Sharpe ratio?'), false);
  assert.equal(extractBudgetFromMessage('construct portfolio with $10,000'), 10000);
  assert.equal(resolveKnownPrice('QQQ',{marks:{QQQ:{price:400,source:'manual'}}}).price, 400);
  const scaled=scaleAllocation([{symbol:'QQQ',weight_pct:60},{symbol:'BIL',weight_pct:40}],1000);
  assert.ok(Math.abs(scaled.reduce((s,r)=>s+r.weight_pct,0)-100)<0.05);
  assert.ok(fs.existsSync(path.join(root,'netlify/functions/portfolio-build.mjs')));
  console.log('ok portfolio-build helpers');
}

// --- 7) Version 7.3.0 Gateway edition ---
{
  const { JSON_PROVIDER_TIMEOUT_MS, CHAT_PROVIDER_TIMEOUT_MS, providerTimeoutMs } = await import('../netlify/lib/llm.mjs');
  assert.ok(JSON_PROVIDER_TIMEOUT_MS>=8000 && JSON_PROVIDER_TIMEOUT_MS<=12000);
  assert.equal(providerTimeoutMs('primary'), JSON_PROVIDER_TIMEOUT_MS);
  assert.equal(providerTimeoutMs('chat'), CHAT_PROVIDER_TIMEOUT_MS);
  assert.ok(/7\.3\.0/.test(read('public/index.html')),'cache-bust 7.3.0');
  assert.ok(/\"version\"\s*:\s*\"7\.3\.0\"/.test(read('package.json')),'package version 7.3.0');
  assert.ok(/PAPER BROKER/.test(read('public/index.html')),'commercial login descriptor');
  const css=read('public/styles.css')+read('public/ui-reference.css');
  assert.ok(css.includes('--hades-gold:#B59410'));
  assert.ok(css.includes('--hades-blue:#1B4C93'));
  assert.ok(css.includes('--hades-charcoal:#1A1A1A')||css.includes('#1A1A1A'));
  assert.ok(css.includes('--hades-mix:#7A7256'));
  assert.ok(/PAPER BROKER · V7\.3/.test(read('public/index.html')),'topbar V7.3 commercial descriptor');
  assert.ok(fs.existsSync(path.join(root,'netlify/functions/ai-mirror-job.mjs')),'ai-mirror-job present');
  const mirrorFn=read('netlify/functions/ai-mirror.mjs');
  assert.ok(/background\s*:\s*true/.test(mirrorFn),'ai-mirror background');
  const mp=read('netlify/lib/market-provider.mjs');
  assert.ok(mp.includes('research_error'),'research_error meta');
  assert.ok(!/catch\s*\{\s*\}/.test(mp),'no silent catch on research');
  const td=read('netlify/lib/twelve-data.mjs');
  assert.ok(/batchGapMs|BATCH_GAP/.test(td),'twelve throttle gap');
  const appJs=read('public/app.js');
  assert.ok(appJs.includes("return '—'") && appJs.includes('Number.isFinite'),'pct harden');
  assert.ok(appJs.includes('waitAIMirrorJob'),'mirror job poll');
  assert.ok(appJs.includes('Search Apple, AAPL, Bitcoin, BTC'),'broker search placeholder');
  console.log('ok version + brand tokens + V6 UI');
}

// --- 7c) V6 UI + 4-core gate + licensed charts ---
{
  const html=read('public/index.html');
  assert.ok(!/kairos-logo\.jpg/.test(html),'login must not use JPG sticker');
  assert.ok(/kairos-mark\.png/.test(html),'login uses official KAIROS mark');
  assert.ok(/login-v53|login-mark-svg|login-v6/.test(html),'login classes');
  assert.ok(/PAPER BROKER/.test(html));
  const gate=read('netlify/lib/ai-gate.mjs');
  assert.ok(/conservative_paper_release|conservativeRelease/.test(gate),'soft conservative release');
  assert.ok(/PAPER SIMULATION|paper simulation/i.test(gate),'paper-sim judge prompt');
  assert.ok(/coresSkipped/.test(gate));
  assert.ok(/DEVIL|Devil|devil/.test(gate),'devil advocate core');
  assert.ok(/sequential|CORE_1_ANALYST/.test(gate));
  const mirror=read('netlify/functions/ai-mirror.mjs');
  assert.ok(/rejectionReasons/.test(mirror),'mirror surfaces rejectionReasons');
  const mrs=read('netlify/lib/market-research-series.mjs');
  assert.ok(/finnhubSeriesBundle|buildLicensedSeriesBundle/.test(mrs),'Twelve+Finnhub history');
  assert.ok(/AI_PRICE_SERIES_DISABLED|never invent/i.test(mrs),'no AI OHLC invention');
  assert.ok(mrs.includes('AAPL') && mrs.includes('KO'),'research series includes single stocks');
  const fh=read('netlify/lib/finnhub.mjs');
  assert.ok(/finnhubSeries/.test(fh),'finnhub candles');
  const app=read('public/app.js');
  assert.ok(/formatRejectReasons|mirror-reject-panel/.test(app),'actionable reject UI');
  assert.ok(/spark-empty/.test(app) && /HISTORY/.test(app),'history-missing state is explicit');
  console.log('ok V6 UI + 4-core + licensed charts');
}

// --- 7d) Expanded universe ---
{
  const uni=read('netlify/lib/market-universe.mjs');
  const mrs=read('netlify/lib/market-research-series.mjs');
  for(const s of ['AAPL','KO','MSFT','AMZN','GOOGL','META','NVDA','TSLA','JPM','XOM','SPY','QQQ','BTC']){
    assert.ok(uni.includes(`'${s}'`)||uni.includes(`"${s}"`)||uni.includes(`symbol:'${s}'`),`universe has ${s}`);
    assert.ok(mrs.includes(s),`research-series list has ${s}`);
  }
  assert.ok(/Apple/i.test(uni) && /Coca-Cola/i.test(uni));
  assert.ok(/US Equity/i.test(uni));
  const pb=read('netlify/lib/portfolio-build.mjs');
  assert.ok(pb.includes('UNIVERSE_SYMBOLS'));
  console.log('ok expanded universe single stocks');
}

// --- 7b) OpenAI defaults ---
{
  const oai=read('netlify/lib/openai.mjs');
  assert.ok(oai.includes('gpt-5.6-luna'));
  assert.ok(read('netlify/lib/llm.mjs').includes('gpt-5.4-mini')); // bounded OpenAI fallback
  assert.ok(oai.includes('OPENAI_MODEL_NOT_FOUND'));
  const prevO=process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL;
  assert.equal(resolveModelForProvider('openai','primary'),'gpt-5.6-luna');
  assert.equal(resolveModelForProvider('openai','final_gate'),'gpt-5.6-terra');
  assert.equal(resolveModelForProvider('anthropic','primary'),'claude-sonnet-5');
  assert.equal(resolveModelForProvider('gemini','risk'),'gemini-2.5-pro');
  if(prevO!=null) process.env.OPENAI_MODEL=prevO; else delete process.env.OPENAI_MODEL;
  console.log('ok Gateway model policy defaults');
}

// --- 8) Market sticky shard ---
{
  const td=read('netlify/lib/twelve-data.mjs');
  const fh=read('netlify/lib/finnhub.mjs');
  const mq=read('netlify/lib/market-quotes.mjs');
  const mp=read('netlify/lib/market-provider.mjs');
  assert.ok(td.includes('TWELVE_DATA_API_KEY'));
  assert.ok(fh.includes('FINNHUB_API_KEY'));
  assert.ok(fh.includes('finnhub.io') && fh.includes('/quote'));
  assert.ok(mq.includes('symbolShard') && mq.includes('sticky'));
  assert.ok(mq.includes('primaryProviderForSymbol'));
  assert.ok(mp.includes('marketQuotes') || mp.includes('marketQuotesConfigured'));
  assert.ok(/price_authority/.test(mp));
  assert.ok(!read('public/app.js').includes('TWELVE_DATA_API_KEY=') && !read('public/index.html').includes('FINNHUB_API_KEY='));
  const { symbolShard, primaryProviderForSymbol, clearQuoteCache } = await import('../netlify/lib/market-quotes.mjs');
  clearQuoteCache();
  const a=symbolShard('SPY'); const b=symbolShard('SPY');
  assert.equal(a,b,'sticky hash stable');
  assert.ok(a===0||a===1);
  const prevT=process.env.TWELVE_DATA_API_KEY; const prevF=process.env.FINNHUB_API_KEY;
  delete process.env.TWELVE_DATA_API_KEY;
  process.env.FINNHUB_API_KEY=prevF||'test-finnhub-key-xxxxxxxxxxxxxxxxxxxx';
  assert.equal(primaryProviderForSymbol('SPY'),'finnhub');
  assert.equal(primaryProviderForSymbol('AAPL'),'finnhub');
  process.env.TWELVE_DATA_API_KEY='test-twelve-key-xxxxxxxxxxxxxxxxxxxx';
  process.env.FINNHUB_API_KEY='test-finnhub-key-xxxxxxxxxxxxxxxxxxxx';
  const pSpy=primaryProviderForSymbol('SPY');
  assert.ok(pSpy==='twelve'||pSpy==='finnhub');
  assert.equal(primaryProviderForSymbol('SPY'),pSpy,'sticky');
  if(prevT!=null) process.env.TWELVE_DATA_API_KEY=prevT; else delete process.env.TWELVE_DATA_API_KEY;
  if(prevF!=null) process.env.FINNHUB_API_KEY=prevF; else delete process.env.FINNHUB_API_KEY;
  console.log('ok market sticky shard Twelve+Finnhub');
}

// --- 9) Provider health + secret isolation ---
{
  const health=read('netlify/functions/provider-health.mjs');
  const llm=read('netlify/lib/llm.mjs');
  assert.ok(health.includes("pingProvider('openai')"));
  assert.ok(health.includes("pingProvider('anthropic')"));
  assert.ok(health.includes("pingProvider('gemini')"));
  assert.ok(health.includes('NETLIFY_AI_GATEWAY_MULTI_PROVIDER'));
  assert.ok(llm.includes('ROLE_PROVIDER_CHAINS'));
  assert.ok(health.includes('finnhubHealth')&&health.includes('twelveHealth'));
  const auth=read('netlify/lib/auth.mjs');
  assert.ok(auth.includes('SAURON_SESSION_SECRET'));
  assert.ok(auth.includes('SESSION_MAX_AGE_MS'));
  assert.ok(!/SAURON_SESSION_SECRET\|\|process\.env\.OPENAI_API_KEY/.test(auth),'session secret must not fall back to API keys');
  const internal=read('netlify/lib/internal.mjs');
  assert.ok(internal.includes('HADES_INTERNAL_SECRET'));
  assert.ok(!internal.includes('OPENAI_API_KEY'));
  const prov=read('netlify/lib/providers.mjs');
  const authSrc=read('netlify/lib/auth.mjs');
  const secSrc=read('netlify/lib/security-status.mjs');
  assert.ok(authSrc.includes('SAURON_SESSION_SECRET_MISSING') && authSrc.includes('PUBLIC_SIGNUP_NOT_RELEASED') && authSrc.includes('COMMERCIAL_LEGAL_CONFIG_REQUIRED'),'production auth requires an explicit session secret and fail-closed commercial signup gates');
  assert.ok(secSrc.includes('SAURON_SESSION_SECRET_WEAK_OR_PLACEHOLDER') && secSrc.includes('HADES_INTERNAL_SECRET_WEAK_OR_PLACEHOLDER'),'security diagnostics detect weak/placeholder secrets');
  assert.ok(/anthropic/.test(prov)&&/gemini/.test(prov)&&/aiGateway/.test(prov));
  assert.ok(/cross_provider_crown/.test(prov));
  console.log('ok provider health + session/internal secrets');
}

// --- 10) OpenAI reasoning gate + market wall ---
{
  const oai=read('netlify/lib/openai.mjs');
  assert.ok(oai.includes('supportsOpenAIReasoning'));
  const { supportsOpenAIReasoning } = await import('../netlify/lib/openai.mjs');
  assert.equal(supportsOpenAIReasoning('gpt-4o-mini'), false);
  assert.equal(supportsOpenAIReasoning('gpt-4o'), false);
  assert.equal(supportsOpenAIReasoning('o3-mini'), true);
  assert.equal(supportsOpenAIReasoning('gpt-5'), true);
  const health=read('netlify/functions/provider-health.mjs');
  assert.ok(health.includes('requestOk'));
  const app=read('public/app.js');
  assert.ok(app.includes('requestOk===true')||app.includes('p.requestOk===true'));
  assert.ok(!/authOk\?'VERIFIED'/.test(app),'UI must not treat authOk alone as VERIFIED');
  const mr=read('netlify/functions/market-refresh.mjs');
  assert.ok(/WALL_MS|deadlineAt|MARKET_REFRESH_WALL/.test(mr),'market refresh wall');
  console.log('ok reasoning gate + health requestOk + market wall');
}

console.log('\nAll router-v2 tests passed.');
