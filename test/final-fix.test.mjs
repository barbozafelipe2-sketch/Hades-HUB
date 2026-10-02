import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurePersistenceForRequest, configureTenantForRequest, deployScopedPersistence, setJSON, getJSON } from '../netlify/lib/store.mjs';
import { validateTransactionLedger, todayISO } from '../netlify/lib/portfolio.mjs';
import { saveTransactions, savePaperOrders, getPaperOrders } from '../netlify/lib/state.mjs';
import { executeMarketPaperOrder, processPendingPaperOrders } from '../netlify/lib/paper-orders.mjs';
import { consumeWorkflowBudget } from '../netlify/lib/workflow-limit.mjs';
import { normalizeBackupPayload } from '../netlify/functions/backup.mjs';
import { isNetlifyRuntime } from '../netlify/lib/env.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');

// Deploy previews and production must select different persistence scopes.
// GitHub Actions is not a Netlify runtime, so this test validates routing decisions
// and the source-level use of deploy/site stores without attempting real Blob I/O.
process.env.NETLIFY='true';
configurePersistenceForRequest({deploy:{id:'qa-preview-deploy',context:'deploy-preview',published:false}});
configureTenantForRequest({tenantId:'qa_tenant',userId:'qa',role:'owner'});
assert.equal(deployScopedPersistence(),true);
configurePersistenceForRequest({deploy:{context:'production',published:true}});
configureTenantForRequest({tenantId:'qa_tenant',userId:'qa',role:'owner'});
assert.equal(deployScopedPersistence(),false);
delete process.env.NETLIFY;
process.env.SITE_ID='site-runtime-test'; assert.equal(isNetlifyRuntime(),true,'SITE_ID must identify hosted Netlify Functions runtime'); delete process.env.SITE_ID;

// Historical ledger invalidation: deleting a prerequisite BUY may not leave an oversell persisted.
const day=todayISO();
assert.throws(()=>validateTransactionLedger([
  {id:'d1',type:'DEPOSIT',amount:1000,date:day,createdAt:`${day}T10:00:00Z`},
  {id:'s1',type:'SELL',symbol:'SPY',quantity:1,unitPrice:100,date:day,createdAt:`${day}T11:00:00Z`}
]),/LEDGER_SELL_EXCEEDS_POSITION:SPY:s1/);

// Partial write reconciliation: deterministic fill transaction wins before current cash/mark checks.
await saveTransactions([
  {id:'dep',type:'DEPOSIT',amount:200,date:day,createdAt:`${day}T09:00:00Z`},
  {id:'paper-fill:market-reconcile',type:'BUY',symbol:'SPY',quantity:1,unitPrice:100,date:day,createdAt:`${day}T10:00:00Z`},
  {id:'paper-fill:pending-reconcile',type:'BUY',symbol:'QQQ',quantity:1,unitPrice:100,date:day,createdAt:`${day}T10:05:00Z`}
]);
await savePaperOrders([{id:'pending-reconcile',symbol:'QQQ',side:'BUY',orderType:'LIMIT',quantity:1,limitPrice:100,stopPrice:null,fees:0,status:'OPEN',triggered:false,createdAt:`${day}T10:04:00Z`,updatedAt:`${day}T10:04:00Z`,note:''}]);
const market=await executeMarketPaperOrder({orderId:'market-reconcile',symbol:'SPY',side:'BUY',quantity:1});
assert.equal(market.idempotent,true);
assert.equal(market.reconciled,true);
assert.equal(market.order.status,'FILLED');
assert.equal(market.order.fillPrice,100);
const pending=await processPendingPaperOrders();
assert.equal(pending.fills[0].reconciled,true);
const reconciled=(await getPaperOrders()).find(o=>o.id==='pending-reconcile');
assert.equal(reconciled.status,'FILLED');
assert.equal(reconciled.fillPrice,100);

// Long cost windows live inside KAIROS and are job-idempotent.
await consumeWorkflowBudget('qa-final',{limit:1,windowMs:600000,jobId:'job-a'});
const repeat=await consumeWorkflowBudget('qa-final',{limit:1,windowMs:600000,jobId:'job-a'});
assert.equal(repeat.idempotent,true);
await assert.rejects(()=>consumeWorkflowBudget('qa-final',{limit:1,windowMs:600000,jobId:'job-b'}),/WORKFLOW_RATE_LIMITED/);

// Backup validation must reject a FILLED order whose fill transaction is absent.
assert.throws(()=>normalizeBackupPayload({version:5,transactions:[],marks:{},paperOrders:[{
  id:'orphan-fill',symbol:'SPY',side:'BUY',orderType:'MARKET',quantity:1,fees:0,status:'FILLED',fillPrice:100,transactionId:'paper-fill:orphan-fill',createdAt:`${day}T10:00:00Z`,updatedAt:`${day}T10:00:00Z`
}],decisions:[],watchlist:[],snapshots:{},traces:{},worldStates:{}}),/FILLED_ORDER_TRANSACTION_MISSING/);

const responseBackup=normalizeBackupPayload({version:5,transactions:[],marks:{},paperOrders:[],decisions:[{id:'decision-response-test',asset:'SPY'}],decisionResponses:[{id:'response-export-test',decisionId:'decision-response-test',response:'followed',paperOrderId:null,idempotencyKey:'response-idem-test',createdAt:`${day}T10:00:00Z`}],watchlist:[],snapshots:{},traces:{},worldStates:{}});
assert.equal(responseBackup.decisionResponses.length,1,'backup export/restore validation must preserve self-reported decision responses');
assert.throws(()=>normalizeBackupPayload({version:5,transactions:[],marks:{},paperOrders:[],decisions:[{id:'decision-response-test',asset:'SPY'}],decisionResponses:[{id:'response-export-test',decisionId:'decision-response-test',response:'caused_return',idempotencyKey:'response-idem-test'}],watchlist:[],snapshots:{},traces:{},worldStates:{}}),/INVALID_DECISION_RESPONSE/);

// Netlify platform rate limits must all be within the documented 180-second ceiling.
const functionDir=path.join(root,'netlify/functions');
let platformRules=0;
for(const name of fs.readdirSync(functionDir).filter(x=>x.endsWith('.mjs'))){
  const src=fs.readFileSync(path.join(functionDir,name),'utf8');
  for(const m of src.matchAll(/rateLimit:\{windowLimit:\d+,windowSize:(\d+)/g)){
    platformRules++; assert.ok(Number(m[1])<=180,`${name} has unsupported window ${m[1]}`);
  }
}
assert.equal(platformRules,2,'Free-plan-compatible platform edge rules are reserved for login and signup');

const catchup=read('netlify/functions/trace-catchup-background.mjs');
assert.ok(catchup.indexOf("getEnv('DEPLOY_PRIME_URL')")<catchup.indexOf("getEnv('URL')"),'catch-up chaining must stay on originating deploy');
const storeSrc=read('netlify/lib/store.mjs');
assert.match(storeSrc,/getDeployStore/);
assert.match(storeSrc,/context\?\.deploy\?\.context/);
const stateSrc=read('netlify/lib/state.mjs');
assert.match(stateSrc,/withKeyLock\('ai-mirror-history'/);
const opsSrc=read('netlify/lib/ops-trace.mjs');
assert.match(opsSrc,/keepDays:30/);
const perf=read('netlify/lib/mirror-performance.mjs');
assert.match(perf,/\['SPY',benchVal\]/);
assert.match(perf,/benchmark:'SPY'/);
assert.equal(read('public/app.js').includes('<span>S&P 500</span>'),false);
assert.equal(JSON.parse(read('package.json')).version,'7.3.0');
assert.ok(/7\.3\.0/.test(read('public/index.html')));

console.log('final-fix PASS');
