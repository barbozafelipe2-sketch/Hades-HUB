import assert from 'node:assert/strict';

process.env.KAIROS_DATABASE_QA_MEMORY='true';
process.env.KAIROS_DATA_BACKEND='postgres';
const {recordDecisionResponse,listDecisionResponses}=await import('../netlify/lib/database.mjs');
const decision={id:'11111111-1111-4111-8111-111111111111',asset:'AAPL',createdAt:'2026-10-01T12:00:00.000Z'};
const first=await recordDecisionResponse({tenantId:'tenant_resp_a',userId:'user_a',decision,response:'followed',idempotencyKey:'idem-response-1'});
assert.equal(first.response,'followed');assert.equal(first.idempotent,undefined);
const replay=await recordDecisionResponse({tenantId:'tenant_resp_a',userId:'user_a',decision,response:'followed',idempotencyKey:'idem-response-1'});
assert.equal(replay.id,first.id);assert.equal(replay.idempotent,true,'replaying an idempotency key must not create another event');
await assert.rejects(()=>recordDecisionResponse({tenantId:'tenant_resp_a',userId:'user_a',decision,response:'overrode',idempotencyKey:'idem-response-1'}),/IDEMPOTENCY_KEY_REUSED/);
await recordDecisionResponse({tenantId:'tenant_resp_a',userId:'user_a',decision,response:'overrode',idempotencyKey:'idem-response-2'});
const other=await listDecisionResponses('tenant_resp_b');
const own=await listDecisionResponses('tenant_resp_a');
assert.equal(Object.keys(other).length,0,'response history must be tenant scoped');
assert.equal(own[decision.id].response,'overrode','new declaration should become current without erasing history');
console.log('decision-response: PASS (append-only response, idempotency and tenant isolation)');
