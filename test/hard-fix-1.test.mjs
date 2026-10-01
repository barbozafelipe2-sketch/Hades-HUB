import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.OPENAI_API_KEY='test-openai';
process.env.ANTHROPIC_API_KEY='test-anthropic';
process.env.GEMINI_API_KEY='test-gemini';

const llm=await import('../netlify/lib/llm.mjs');
const {deriveDecisionConviction}=await import('../netlify/lib/decision-confidence.mjs');

// Final Decision Review preserves capability tier within a provider.
assert.deepEqual(llm.modelCandidatesForProvider('openai','final_gate'),['gpt-5.6-sol']);
assert.deepEqual(llm.modelCandidatesForProvider('anthropic','final_gate'),['claude-sonnet-5']);
assert.deepEqual(llm.modelCandidatesForProvider('gemini','final_gate'),['gemini-2.5-pro']);
assert.equal(llm.outputTokenBudget('coach'),900);
assert.equal(llm.outputTokenBudget('final_gate'),2600);

// Model self-asserted source_quality cannot inflate conviction.
const low=deriveDecisionConviction({
  worldState:{_meta:{price_authority:'none'},instruments:[{symbol:'SPY',price:500,as_of:new Date().toISOString(),stale:false}]},
  assetEvidence:{asset:'SPY',source_quality:'high',market:{price:500,price_as_of:new Date().toISOString()},unknowns:[],fundamentals_or_network:{facts:[],unknowns:[]}},
  specialists:[{recommended_stance:'HOLD',_meta:{provider:'openai'}},{recommended_stance:'HOLD',_meta:{provider:'anthropic'}},{recommended_stance:'HOLD',_meta:{provider:'gemini'}}],
  attacks:{a:{pass:true},b:{pass:true},c:{pass:true}},
  finalGate:{approved:true},final:{status:'HOLD'},availableProviders:['openai','anthropic','gemini']
});
assert.equal(low.sourceQuality,'LOW');
assert.equal(low.conviction,'LOW');

// Licensed quote + independent sources/providers can qualify deterministically.
const now=new Date().toISOString();
const good=deriveDecisionConviction({
  worldState:{_meta:{price_authority:'twelve_data+finnhub_sticky'},instruments:[{symbol:'SPY',price:500,as_of:now,stale:false}]},
  assetEvidence:{asset:'SPY',source_quality:'low',market:{price:500,price_as_of:now},unknowns:[],fundamentals_or_network:{facts:[{source_url:'https://sec.gov/a'},{source_url:'https://investor.example.com/b'}],unknowns:[]}},
  specialists:[{recommended_stance:'HOLD',_meta:{provider:'openai'}},{recommended_stance:'HOLD',_meta:{provider:'anthropic'}},{recommended_stance:'HOLD',_meta:{provider:'gemini'}}],
  attacks:{a:{pass:true},b:{pass:true},c:{pass:true}},finalGate:{approved:true},final:{status:'HOLD'},availableProviders:['openai','anthropic','gemini']
});
assert.equal(good.sourceQuality,'HIGH');
assert.equal(good.providerDiversityPass,true);
assert.equal(good.actionablePriceVerified,true);

const marketSource=fs.readFileSync(new URL('../netlify/lib/market-provider.mjs',import.meta.url),'utf8');
assert.match(marketSource,/includeAIContext===true/);
assert.match(marketSource,/allowAIContextFallback===true/);
const walletSource=fs.readFileSync(new URL('../netlify/functions/wallet-mirror.mjs',import.meta.url),'utf8');
assert.match(walletSource,/config=\{background:true(?:,|\})/);
assert.ok(fs.existsSync(new URL('../netlify/functions/wallet-mirror-job.mjs',import.meta.url)));
assert.ok(fs.existsSync(new URL('../netlify/functions/evolution-cycle.mjs',import.meta.url)));
assert.ok(fs.existsSync(new URL('../netlify/functions/evolution-job.mjs',import.meta.url)));
const decisionSource=fs.readFileSync(new URL('../netlify/functions/decision-run.mjs',import.meta.url),'utf8');
assert.match(decisionSource,/const id=job/);
assert.match(decisionSource,/if\(!index\.includes\(id\)\)/);
assert.match(decisionSource,/providerDiversityPass/);

console.log('hard-fix-1 tests PASS');
