import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.KAIROS_DATA_BACKEND='postgres';
process.env.KAIROS_DATABASE_QA_MEMORY='true';
process.env.SAURON_ALLOW_EPHEMERAL_READS='true';
process.env.SAURON_ALLOW_EPHEMERAL_WRITES='true';
delete process.env.NETLIFY; delete process.env.SITE_ID; delete process.env.KAIROS_ALLOW_PRIVATE_OWNER_DELETE;

const store=await import('../netlify/lib/store.mjs');
const db=await import('../netlify/lib/database.mjs');
const lifecycle=await import('../netlify/lib/data-lifecycle.mjs');
const identity=await import('../netlify/lib/identity-provider.mjs');

store.configurePersistenceForRequest({});
identity.setIdentityAdapterForTests({
  getUser:async()=>null,getIdentityConfig:()=>({url:'https://identity.local'}),login:async()=>null,signup:async()=>null,confirmEmail:async()=>null,logout:async()=>{},
  verifyRequestOrigin:()=>true,adminDeleteUser:async()=>{}
});
assert.throws(()=>lifecycle.assertDeletionPolicy({id:'t_private',plan:'private'},'DELETE MY KAIROS WORKSPACE'),/PRIVATE_OWNER_DELETE_BLOCKED/);
assert.throws(()=>lifecycle.assertDeletionPolicy({id:'t_pro',plan:'pro'},'wrong'),/DELETION_CONFIRMATION_REQUIRED/);

const tenantId='t_deleteqa',userId='u_deleteqa',jobId='11111111-1111-4111-8111-111111111111';
await store.setSystemJSON('auth/tenants/'+tenantId,{id:tenantId,name:'Delete QA',status:'deleting',plan:'pro',ownerUserId:userId,deletionJobId:jobId});
await store.setSystemJSON('auth/tenants/index',[tenantId]);
await store.setSystemJSON('auth/users/'+userId,{id:userId,tenantId,username:'deleteqa',email:'deleteqa@example.com',role:'owner',status:'active',authProvider:'netlify_identity',identityUserId:'identity_deleteqa'});
await store.setSystemJSON('auth/users/index',[userId]);
const digest=v=>crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
await store.setSystemJSON('auth/login/'+digest('deleteqa'),userId);
await store.setSystemJSON('auth/login/'+digest('deleteqa@example.com'),userId);
await store.setSystemJSON('auth/login/'+digest('old-deleteqa'),userId);
await store.setSystemJSON('auth/identity/identity_deleteqa',userId);
await store.setSystemJSON('billing/customer/cus_deleteqa',tenantId);

store.configureTenantForRequest({tenantId,userId,role:'owner'});
await store.setJSON('portfolio/transactions',[]);
await store.setJSON('snapshots/2026-01-01',{date:'2026-01-01',portfolioValue:100});
await db.appendAuditEvent({tenantId,userId,eventType:'qa.event'});
await db.consumeUsageEvent({tenantId,period:'2026-10',feature:'qa',units:1,limit:10,idempotencyKey:'qa-delete'});

const result=await lifecycle.purgeKairosTenantData({tenantId,jobId});
assert.ok(result.contentKeysRemoved>=2);
assert.equal(await store.getSystemJSON('auth/tenants/'+tenantId,null),null);
assert.equal(await store.getSystemJSON('auth/users/'+userId,null),null);
assert.equal(await store.getSystemJSON('auth/login/'+digest('deleteqa'),null),null);
assert.equal(await store.getSystemJSON('auth/login/'+digest('old-deleteqa'),null),null,'stale login aliases must be purged too');
assert.equal(await store.getSystemJSON('auth/identity/identity_deleteqa',null),null);
assert.equal(await store.getSystemJSON('billing/customer/cus_deleteqa',null),null);
assert.deepEqual(await db.listAuditEvents(tenantId,{limit:20}),[]);
assert.equal((await db.getUsageSummary(tenantId,'2026-10',10)).used,0);
assert.ok(await store.getSystemJSON('privacy/deletion-receipts/'+jobId,null));

const bg=fs.readFileSync(new URL('../netlify/functions/privacy-delete-background.mjs',import.meta.url),'utf8');
assert.match(bg,/validInternal/); assert.match(bg,/background:true/);
const request=fs.readFileSync(new URL('../netlify/functions/privacy-delete.mjs',import.meta.url),'utf8');
assert.match(request,/stageWorkspaceDeletion/); assert.match(request,/clearSessionCookie/);
const stripeSrc=fs.readFileSync(new URL('../netlify/lib/stripe-billing.mjs',import.meta.url),'utf8');
assert.match(stripeSrc,/method:'DELETE'/); assert.match(stripeSrc,/cancelStripeSubscription/);
const provider=fs.readFileSync(new URL('../netlify/lib/identity-provider.mjs',import.meta.url),'utf8');
assert.match(provider,/sdkAdmin\.deleteUser/);
identity.resetIdentityAdapterForTests();
console.log('commercial-hard-fix-4: PASS');
