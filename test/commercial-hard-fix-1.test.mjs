import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.SAURON_ADMIN_USER='admin';
process.env.SAURON_ADMIN_PASSWORD='admin123';
process.env.KAIROS_ADMIN_EMAIL='owner@example.com';
process.env.KAIROS_LEGACY_AUTH_ENABLED='true';
process.env.KAIROS_REQUIRE_BILLING_FOR_SIGNUP='false';
const store=await import('../netlify/lib/store.mjs');
const identityProvider=await import('../netlify/lib/identity-provider.mjs');
const auth=await import('../netlify/lib/auth.mjs');

store.configurePersistenceForRequest({});
store.configureTenantForRequest(null);
await store.setJSON('user/profile',{displayName:'Legacy Owner'});
await store.setJSON('portfolio/transactions',[{id:'legacy-seed',type:'DEPOSIT',amount:1000,date:'2026-01-01T00:00:00.000Z'}]);
process.env.KAIROS_DATA_BACKEND='postgres';
process.env.KAIROS_DATABASE_QA_MEMORY='true';
const owner=await auth.authenticateCredentials('admin','admin123');
assert.ok(owner?.tenantId&&owner?.userId&&owner?.role==='owner');
store.configureTenantForRequest(owner);
assert.equal((await store.getJSON('user/profile')).displayName,'Legacy Owner','legacy root data must migrate into owner tenant');
assert.equal((await store.getJSON('portfolio/transactions'))[0].id,'legacy-seed');
assert.equal((await store.getLegacyGlobalJSON('user/profile')).displayName,'Legacy Owner','legacy source must remain preserved during migration');
const marker=await store.getSystemJSON('migrations/legacy-tenant-v1',null);
assert.equal(marker?.status,'complete');
assert.equal(marker?.sourcePreserved,true);

store.configurePersistenceForRequest({});
store.configureTenantForRequest({tenantId:'tenant_alpha',userId:'u_a',role:'owner'});
await store.setJSON('portfolio/test',{owner:'alpha'});
store.configureTenantForRequest({tenantId:'tenant_beta',userId:'u_b',role:'owner'});
assert.equal(await store.getJSON('portfolio/test',null),null,'tenant beta must not see tenant alpha');
await store.setJSON('portfolio/test',{owner:'beta'});
store.configureTenantForRequest({tenantId:'tenant_alpha',userId:'u_a',role:'owner'});
assert.equal((await store.getJSON('portfolio/test')).owner,'alpha');

// Database namespaces prevent a deploy-preview database clone from exposing the production namespace.
process.env.KAIROS_DATABASE_NAMESPACE='preview_a';
store.configurePersistenceForRequest({});
store.configureTenantForRequest({tenantId:'tenant_namespace',userId:'u_ns',role:'owner'});
await store.setJSON('user/profile',{id:'ns-a',owner:'namespace-a'});
process.env.KAIROS_DATABASE_NAMESPACE='preview_b';
store.configurePersistenceForRequest({});
store.configureTenantForRequest({tenantId:'tenant_namespace',userId:'u_ns',role:'owner'});
assert.deepEqual(await store.getJSON('user/profile',{}),{},'database namespace B must not read namespace A profile/settings records');
process.env.KAIROS_DATABASE_NAMESPACE='preview_a';
store.configurePersistenceForRequest({});
store.configureTenantForRequest({tenantId:'tenant_namespace',userId:'u_ns',role:'owner'});
assert.equal((await store.getJSON('user/profile',{}))?.id,'ns-a');
delete process.env.KAIROS_DATABASE_NAMESPACE;
store.configurePersistenceForRequest({});


// Legacy root state must never migrate into a non-owner just because that user is first in the index.
process.env.KAIROS_DATABASE_NAMESPACE='owner_selection_guard';
store.configurePersistenceForRequest({});
await store.setSystemJSON('auth/users/index',['u_member_seed','u_owner_seed']);
await store.setSystemJSON('auth/users/u_member_seed',{id:'u_member_seed',tenantId:'tenant_member_seed',username:'member-seed',email:'member-seed@example.com',role:'member',status:'active',credentialVersion:1});
await store.setSystemJSON('auth/users/u_owner_seed',{id:'u_owner_seed',tenantId:'tenant_owner_seed',username:'owner-seed',email:'owner-seed@example.com',role:'owner',status:'active',credentialVersion:1});
await store.setSystemJSON('auth/tenants/tenant_member_seed',{id:'tenant_member_seed',name:'Member Seed',status:'active',role:'member',ownerUserId:null});
await store.setSystemJSON('auth/tenants/tenant_owner_seed',{id:'tenant_owner_seed',name:'Owner Seed',status:'active',ownerUserId:'u_owner_seed'});
const selectedOwner=await auth.ensureAuth();
assert.equal(selectedOwner?.id,'u_owner_seed','bootstrap must prefer an active owner over the first indexed member');
store.configureTenantForRequest({tenantId:'tenant_member_seed',userId:'u_member_seed',role:'member'});
assert.equal(await store.getJSON('user/profile',null),null,'legacy owner state must never migrate into a member tenant');
store.configureTenantForRequest({tenantId:'tenant_owner_seed',userId:'u_owner_seed',role:'owner'});
assert.equal((await store.getJSON('user/profile',null))?.displayName,'Legacy Owner','legacy owner state must migrate into the active owner tenant');
assert.equal((await store.getSystemJSON('migrations/legacy-tenant-v1',null))?.tenantId,'tenant_owner_seed');
delete process.env.KAIROS_DATABASE_NAMESPACE;
store.configurePersistenceForRequest({});
store.configureTenantForRequest(owner);

const legacyToken=await auth.createSessionToken(owner);
const legacyReq=new Request('https://local/.netlify/functions/auth-session',{headers:{cookie:`kairos_session=${legacyToken}`}});
const legacySession=await auth.requireSession(legacyReq);
assert.equal(legacySession?.tenantId,owner.tenantId);
assert.equal(legacySession?.authProvider,'legacy');

const qa={configured:true,autoconfirm:true,user:null,users:new Map(),tokens:new Map(),counter:0};
const identityError=(message,status)=>Object.assign(new Error(message),{status});
identityProvider.setIdentityAdapterForTests({
  getIdentityConfig:()=>qa.configured?{siteUrl:'https://local'}:null,
  getUser:async()=>qa.user,
  login:async(email,password)=>{
    const row=qa.users.get(String(email||'').toLowerCase());
    if(!row || row.password!==String(password||'')) throw identityError('Invalid login credentials',401);
    if(row.user.emailVerified!==true) throw identityError('Email not confirmed',401);
    qa.user={...row.user}; return qa.user;
  },
  signup:async(email,password,metadata={})=>{
    const clean=String(email||'').toLowerCase();
    if(qa.users.has(clean)) throw identityError('User already registered',422);
    const id=`identity-${++qa.counter}`;
    const confirmationToken=`qa-confirmation-token-${id}-0123456789`;
    const user={id,email:clean,emailVerified:qa.autoconfirm===true,roles:['member'],user_metadata:{...metadata}};
    qa.users.set(clean,{password:String(password||''),confirmationToken,user});
    qa.tokens.set(confirmationToken,clean);
    if(user.emailVerified) qa.user={...user};
    return {...user};
  },
  confirmEmail:async(token)=>{
    const clean=qa.tokens.get(String(token||''));
    const row=clean?qa.users.get(clean):null;
    if(!row) throw identityError('Invalid confirmation token',400);
    row.user={...row.user,emailVerified:true}; qa.user={...row.user}; return {...row.user};
  },
  logout:async()=>{ qa.user=null; },
  verifyRequestOrigin:()=>true,
});
qa.user={id:'identity-owner',email:'owner@example.com',emailVerified:true,roles:['owner']};
store.configurePersistenceForRequest({});
const identitySession=await auth.requireSession(new Request('https://local/.netlify/functions/auth-session'));
assert.equal(identitySession?.tenantId,owner.tenantId,'matching owner Identity account must link to migrated owner tenant');
assert.equal(identitySession?.authProvider,'netlify_identity');

process.env.KAIROS_ALLOW_SIGNUPS='true';
process.env.KAIROS_PUBLIC_SIGNUP_READY='true';
process.env.KAIROS_LEGAL_ENTITY_NAME='Kairos Test LLC';
process.env.KAIROS_TERMS_VERSION='2026-10-01';
process.env.KAIROS_RISK_DISCLOSURE_VERSION='2026-10-01';
process.env.KAIROS_TERMS_URL='https://kairos.example/terms';
process.env.KAIROS_RISK_DISCLOSURE_URL='https://kairos.example/risk';
process.env.KAIROS_PRIVACY_URL='https://kairos.example/privacy';
process.env.KAIROS_APP_URL='https://kairos.example';
process.env.KAIROS_SUPPORT_EMAIL='support@kairos.example';
process.env.KAIROS_PRODUCT_MODE='paper_research';
process.env.KAIROS_REAL_MONEY_EXECUTION='false';
process.env.KAIROS_PUBLIC_RELEASE_APPROVED='true';
process.env.KAIROS_PREVIEW_SMOKE_APPROVED='true';
process.env.KAIROS_LEGACY_AUTH_ENABLED='false';
process.env.KAIROS_LICENSED_MARKET_BASE_URL='https://licensed.example';
process.env.KAIROS_LICENSED_MARKET_API_KEY='qa-key';
process.env.KAIROS_LICENSED_MARKET_LICENSE_ID='licensed-qa';
process.env.KAIROS_TENANT_DAILY_USD='10';process.env.KAIROS_SITE_DAILY_USD='100';
process.env.STRIPE_SECRET_KEY='sk_test_qa';process.env.STRIPE_WEBHOOK_SECRET='whsec_qa';process.env.KAIROS_STRIPE_PRO_PRICE_ID='price_qa';
process.env.KAIROS_LEGAL_REVIEW_VERSION='qa-review-v1';
process.env.KAIROS_LEGAL_REVIEWED_AT=new Date(Date.now()-3600000).toISOString();
qa.user=null;
const mkReq=()=>new Request('https://local/.netlify/functions/auth-signup',{method:'POST',headers:{origin:'https://local'}});
const [a,b]=await Promise.all([
  auth.createCommercialAccount(mkReq(),{email:'alex.one@example.com',password:'correct-horse-1',fullName:'Alex One',acceptedTermsVersion:'2026-10-01',acceptedRiskDisclosure:true}),
  auth.createCommercialAccount(mkReq(),{email:'alex.two@example.com',password:'correct-horse-2',fullName:'Alex Two',acceptedTermsVersion:'2026-10-01',acceptedRiskDisclosure:true})
]);
assert.notEqual(a.principal.tenantId,b.principal.tenantId,'each commercial signup needs a separate tenant');
for(const created of [a,b]){
  const row=await store.getSystemJSON(`auth/users/${created.principal.userId}`,null);
  assert.equal(row?.authProvider,'netlify_identity');
  assert.equal('passwordHash' in row,false,'commercial Identity users must not store application password hashes');
  assert.equal(row?.termsVersion,'2026-10-01');
}

// Email-confirmation lifecycle: an unverified Identity signup prepares IDs but must not create an active tenant/user.
qa.autoconfirm=false;
qa.user=null;
const pendingOnly=await auth.createCommercialAccount(mkReq(),{email:'pending@example.com',password:'correct-horse-3',fullName:'Pending User',acceptedTermsVersion:'2026-10-01',acceptedRiskDisclosure:true});
assert.equal(pendingOnly.emailVerified,false);
assert.equal(await store.getSystemJSON(`auth/users/${pendingOnly.principal.userId}`,null),null,'unverified signup must not create an active app user');
assert.equal(await store.getSystemJSON(`auth/tenants/${pendingOnly.principal.tenantId}`,null),null,'unverified signup must not create an active tenant');
const premature=await auth.loginPrincipal(mkReq(),'pending@example.com','correct-horse-3').catch(e=>String(e?.message||e));
assert.ok(premature===null || premature==='TENANT_NOT_PROVISIONED','unverified Identity login must not provision a tenant');
const pendingRow=qa.users.get('pending@example.com');
const confirmed=await auth.confirmCommercialEmail(mkReq(),pendingRow.confirmationToken);
assert.equal(confirmed.userId,pendingOnly.principal.userId,'confirmation must provision the prepared user id');
assert.equal(confirmed.tenantId,pendingOnly.principal.tenantId,'confirmation must provision the prepared tenant id');
assert.equal((await store.getSystemJSON(`auth/users/${confirmed.userId}`,null))?.status,'active');
assert.equal((await store.getSystemJSON(`auth/tenants/${confirmed.tenantId}`,null))?.status,'active');
qa.autoconfirm=true;

// A partial system-write failure must be recoverable from the pre-created pending signup record
// once the same authenticated Identity user returns. Identity passwords are never needed for repair.
const emailDigest=crypto.createHash('sha256').update(a.principal.email).digest('hex');
await store.deleteSystemKey(`auth/identity/${a.principal.identityUserId}`);
await store.deleteSystemKey(`auth/users/${a.principal.userId}`);
await store.deleteSystemKey(`auth/tenants/${a.principal.tenantId}`);
await store.deleteSystemKey(`auth/login/${emailDigest}`);
qa.user={id:a.principal.identityUserId,email:a.principal.email,emailVerified:true,roles:['member']};
store.configurePersistenceForRequest({});
const repaired=await auth.requireSession(new Request('https://local/.netlify/functions/auth-session'));
assert.equal(repaired?.userId,a.principal.userId,'authenticated Identity user should repair a partial tenant mapping');
assert.equal(repaired?.tenantId,a.principal.tenantId,'recovery must reuse the prepared tenant rather than create a new one');
const repairedPending=(await Promise.all((await store.listSystemKeys('auth/pending-signups/')).map(k=>store.getSystemJSON(k,null)))).find(x=>x?.email===a.principal.email);
assert.equal(repairedPending?.status,'complete');

// AsyncLocalStorage must keep overlapping request tenant contexts separated.
const delay=ms=>new Promise(r=>setTimeout(r,ms));
await Promise.all([
  (async()=>{ store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:'tenant_async_a',userId:'ua',role:'owner'}); await delay(20); await store.setJSON('isolation/probe',{tenant:'a'}); await delay(15); assert.equal((await store.getJSON('isolation/probe')).tenant,'a'); })(),
  (async()=>{ store.configurePersistenceForRequest({}); store.configureTenantForRequest({tenantId:'tenant_async_b',userId:'ub',role:'owner'}); await delay(5); await store.setJSON('isolation/probe',{tenant:'b'}); await delay(30); assert.equal((await store.getJSON('isolation/probe')).tenant,'b'); })()
]);

const migration=fs.readFileSync(new URL('../netlify/database/migrations/20261001000100_kairos-commercial-core/migration.sql',import.meta.url),'utf8');
assert.ok(migration.includes('kairos_system_state'));
assert.ok(migration.includes('kairos_tenant_state'));
const dbLib=fs.readFileSync(new URL('../netlify/lib/database.mjs',import.meta.url),'utf8');
assert.ok(dbLib.includes("@netlify/database"));
assert.ok(dbLib.includes('pg_advisory_lock'));
const storeLib=fs.readFileSync(new URL('../netlify/lib/store.mjs',import.meta.url),'utf8');
assert.ok(storeLib.includes('DATABASE_NAMESPACE_UNRESOLVED'));
assert.ok(storeLib.includes('deploy_${deployId}'));
assert.ok(storeLib.includes('scopedTenantId'));
assert.ok(storeLib.includes('scopedSystemKey'));
const status=store.persistenceStatus();
assert.equal(status.transactionalProvider,'netlify_database');
assert.equal(status.databaseBranchIsolation,'local');

const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.ok(index.includes('PAPER SIMULATION · NO REAL ORDERS'));
assert.ok(index.includes('KAIROS RESEARCH'));
assert.ok(!index.includes('PRIVATE ADVISOR'));
const authLib=fs.readFileSync(new URL('../netlify/lib/auth.mjs',import.meta.url),'utf8');
assert.ok(authLib.includes("from './identity-provider.mjs'"));
const identityProviderSrc=fs.readFileSync(new URL('../netlify/lib/identity-provider.mjs',import.meta.url),'utf8');
assert.ok(identityProviderSrc.includes("from '@netlify/identity'"));
assert.ok(identityProviderSrc.includes('IDENTITY_TEST_ADAPTER_FORBIDDEN'));
assert.ok(authLib.includes('PUBLIC_SIGNUP_NOT_RELEASED'));
assert.ok(authLib.includes('commercial_multi_tenant'));
assert.ok(authLib.includes('migrateLegacyTenantData'));
const aiChatSrc=fs.readFileSync(new URL('../netlify/functions/ai-chat.mjs',import.meta.url),'utf8');
const marketRefreshSrc=fs.readFileSync(new URL('../netlify/functions/market-refresh.mjs',import.meta.url),'utf8');
const providerHealthSrc=fs.readFileSync(new URL('../netlify/functions/provider-health.mjs',import.meta.url),'utf8');
assert.ok(aiChatSrc.includes("consumeWorkflowBudget('coach'"));
assert.ok(marketRefreshSrc.includes("consumeWorkflowBudget('market-refresh'"));
assert.ok(providerHealthSrc.includes("consumeWorkflowBudget('provider-health'"));
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.ok(authLib.includes('if(!verified)'), 'unverified Identity signup must remain pending until email verification');
assert.ok(authLib.includes('confirmCommercialEmail'));
const authConfirmSrc=fs.readFileSync(new URL('../netlify/functions/auth-confirm.mjs',import.meta.url),'utf8');
assert.ok(authConfirmSrc.includes('confirmCommercialEmail'));
const appSrc=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
assert.ok(appSrc.includes('confirmation_token') && appSrc.includes("api('auth-confirm'"));
const backupSrc=fs.readFileSync(new URL('../netlify/functions/backup.mjs',import.meta.url),'utf8');
assert.ok(backupSrc.includes("requireRole(session,['owner','admin'])"),'backup restore must be owner/admin only');
const healthSrc=fs.readFileSync(new URL('../netlify/functions/provider-health.mjs',import.meta.url),'utf8');
assert.ok(!healthSrc.includes('final CROWN gate'));
assert.equal(pkg.dependencies['@netlify/identity'],'2.0.0');
identityProvider.resetIdentityAdapterForTests();
console.log(JSON.stringify({ok:true,tests:['legacy state migration with source preservation','tenant isolation','legacy session binding','Netlify Identity owner linking','Identity-backed concurrent signup','unverified signup waits for email confirmation','partial signup self-repair','overlapping async tenant isolation','Postgres transactional authority scaffold','paper/research disclosure']},null,2));
