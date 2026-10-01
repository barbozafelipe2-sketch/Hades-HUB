import crypto from 'node:crypto';
import {
  getIdentityUser, getIdentityConfig, identityLogin, identitySignup, identityConfirmEmail, identityLogout,
  verifyIdentityRequestOrigin,
} from './identity-provider.mjs';
import {
  getSystemJSON,setSystemJSON,deleteSystemKey,getLegacyGlobalJSON,listLegacyGlobalKeys,setTenantJSONForMigration,
  withSystemKeyLock,persistenceStatus,configureTenantForRequest,currentTenantContext
} from './store.mjs';
import { getEnv, isNetlifyRuntime } from './env.mjs';
import { commercialReleaseGate } from './release-gate.mjs';

const COOKIE='kairos_session';
const LEGACY_COOKIE='sauron_session';
const INITIAL_DEFAULT_PASSWORD='admin123';
const SESSION_MAX_AGE_MS=Math.max(15*60*1000,Math.min(7*24*60*60*1000,Number(getEnv('HADES_SESSION_MAX_AGE_MS',12*60*60*1000))));
const SESSION_CLOCK_SKEW_MS=5*60*1000;
const USER_INDEX_KEY='auth/users/index';
const TENANT_INDEX_KEY='auth/tenants/index';
const LEGACY_MIGRATION_KEY='migrations/legacy-tenant-v1';

function hashPassword(password,salt){return crypto.scryptSync(password,salt,64).toString('hex')}
function safeEqual(a,b){const A=Buffer.from(String(a)),B=Buffer.from(String(b));return A.length===B.length&&crypto.timingSafeEqual(A,B)}
function digest(v){return crypto.createHash('sha256').update(String(v)).digest('hex')}
function normalizeIdentifier(v){return String(v||'').trim().toLowerCase().slice(0,160)}
function userKey(id){return `auth/users/${String(id)}`}
function tenantKey(id){return `auth/tenants/${String(id)}`}
function loginKey(identifier){return `auth/login/${digest(normalizeIdentifier(identifier))}`}
function identityKey(id){return `auth/identity/${String(id).replace(/[^A-Za-z0-9._:-]/g,'_').slice(0,160)}`}
function pendingSignupKey(email){return `auth/pending-signups/${digest(cleanEmail(email))}`}
function legacyAuthEnabled(){ return String(getEnv('KAIROS_LEGACY_AUTH_ENABLED','false')).toLowerCase()==='true'; }
function cleanUsername(value){
  const s=String(value||'').trim();
  if(s.length<3) throw new Error('USERNAME_TOO_SHORT');
  if(s.length>40) throw new Error('USERNAME_TOO_LONG');
  if(!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('USERNAME_INVALID');
  return s;
}
function cleanEmail(value){
  const s=normalizeIdentifier(value);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length>160) throw new Error('EMAIL_INVALID');
  return s;
}
function sessionSecret(){
  const configured=String(getEnv('SAURON_SESSION_SECRET')||getEnv('KAIROS_SESSION_SECRET')||'').trim();
  if(configured) return configured;
  if(isNetlifyRuntime()) throw new Error('SAURON_SESSION_SECRET_MISSING');
  return 'kairos-local-session-secret-not-for-production';
}
function signPayload(payload,key){return crypto.createHmac('sha256',key).update(payload).digest('base64url')}
function stableBootstrapId(prefix,seed){return `${prefix}_${digest(seed).slice(0,20)}`}
function commercialLegalConfig(){
  const termsVersion=String(getEnv('KAIROS_TERMS_VERSION')||'').trim();
  const riskVersion=String(getEnv('KAIROS_RISK_DISCLOSURE_VERSION')||'').trim();
  const legalEntity=String(getEnv('KAIROS_LEGAL_ENTITY_NAME')||'').trim();
  const termsUrl=String(getEnv('KAIROS_TERMS_URL')||'').trim();
  const riskUrl=String(getEnv('KAIROS_RISK_DISCLOSURE_URL')||'').trim();
  const privacyUrl=String(getEnv('KAIROS_PRIVACY_URL')||'').trim();
  const requested=String(getEnv('KAIROS_ALLOW_SIGNUPS')||'').toLowerCase()==='true';
  const launchGate=String(getEnv('KAIROS_PUBLIC_SIGNUP_READY')||'').toLowerCase()==='true';
  const billingRequired=String(getEnv('KAIROS_REQUIRE_BILLING_FOR_SIGNUP','true')).toLowerCase()!=='false';
  const validHttps=(v)=>{ try{ const u=new URL(v); return u.protocol==='https:'; }catch{return false;} };
  const configured=!!(termsVersion&&riskVersion&&legalEntity&&validHttps(termsUrl)&&validHttps(riskUrl)&&validHttps(privacyUrl));
  const billingAppUrl=String(getEnv('KAIROS_APP_URL')||'').trim();
  const billingConfigured=!!(String(getEnv('STRIPE_SECRET_KEY')||'').trim()&&String(getEnv('STRIPE_WEBHOOK_SECRET')||'').trim()&&/^price_[A-Za-z0-9]+$/.test(String(getEnv('KAIROS_STRIPE_PRO_PRICE_ID')||'').trim())&&validHttps(billingAppUrl));
  let identityConfigured=false; try{ identityConfigured=!!getIdentityConfig(); }catch{}
  const releaseGate=commercialReleaseGate({identityConfigured,legalConfigured:configured,billingConfigured,signupRequested:requested,publicSignupReady:launchGate,billingRequired});
  const signupAllowed=releaseGate.ready;
  return {termsVersion,riskVersion,legalEntity,termsUrl,riskUrl,privacyUrl,signupRequested:requested,signupAllowed,configured,launchGate,billingRequired,billingConfigured,identityConfigured,releaseGate};
}

async function getUserRecord(id){ return id?await getSystemJSON(userKey(id),null):null; }
async function getTenant(id){ return id?await getSystemJSON(tenantKey(id),null):null; }
async function writeIndex(key,id){
  await withSystemKeyLock(`index:${key}`,async()=>{
    const list=await getSystemJSON(key,[]); const rows=Array.isArray(list)?list:[];
    if(!rows.includes(id)) rows.push(id);
    await setSystemJSON(key,rows.slice(-10000));
  });
}
async function bindLogin(identifier,userId){
  const n=normalizeIdentifier(identifier); if(!n) return;
  const key=loginKey(n);
  await withSystemKeyLock(`login:${digest(n).slice(0,24)}`,async()=>{
    const current=await getSystemJSON(key,null);
    if(current && current!==userId) throw new Error('LOGIN_IDENTIFIER_IN_USE');
    if(!current){
      await setSystemJSON(key,userId,{onlyIfNew:true});
      const after=await getSystemJSON(key,null);
      if(after!==userId) throw new Error('LOGIN_IDENTIFIER_IN_USE');
    }
  });
}

function principalFromUser(user,identityId=null){
  return {
    userId:user.id,tenantId:user.tenantId,role:user.role||'member',username:user.username,email:user.email||'',
    credentialVersion:Number(user.credentialVersion)||1,authProvider:identityId?'netlify_identity':(user.authProvider||'legacy'),
    ...(identityId?{identityUserId:identityId}:{})
  };
}
function newPendingSignup(clean,fullName,legal){
  const now=new Date().toISOString();
  const tenantId=`t_${crypto.randomUUID().replace(/-/g,'')}`,userId=`u_${crypto.randomUUID().replace(/-/g,'')}`;
  const base=(clean.split('@')[0].replace(/[^a-z0-9._-]/gi,'').slice(0,28)||'user');
  return {
    version:1,status:'prepared',email:clean,tenantId,userId,username:`${base}_${userId.slice(-8)}`,
    workspaceName:String(fullName||'Kairos Workspace').trim().slice(0,100)||'Kairos Workspace',
    fullName:String(fullName||'').trim().slice(0,100),termsVersion:legal.termsVersion,riskVersion:legal.riskVersion,
    createdAt:now,updatedAt:now
  };
}
async function provisionPendingIdentity(identityUser,pending){
  const identityId=String(identityUser?.id||'');
  const email=identityUser?.email?cleanEmail(identityUser.email):'';
  if(!identityId||!email||!pending||pending.email!==email) throw new Error('IDENTITY_PROVISIONING_MISMATCH');
  if(pending.identityUserId && pending.identityUserId!==identityId) throw new Error('IDENTITY_PROVISIONING_MISMATCH');
  return await withSystemKeyLock(`identity-provision:${identityId}`,async()=>{
    const mapped=await getSystemJSON(identityKey(identityId),null);
    if(mapped){
      const existing=await getUserRecord(mapped);
      if(existing?.status==='active') return principalFromUser(existing,identityId);
    }
    const loginOwner=await getSystemJSON(loginKey(email),null);
    if(loginOwner && loginOwner!==pending.userId) throw new Error('ACCOUNT_EXISTS');
    const now=new Date().toISOString();
    const tenant={
      id:pending.tenantId,name:pending.workspaceName,status:'active',plan:'trial',createdAt:pending.createdAt||now,
      ownerUserId:pending.userId,commercial:{termsVersion:pending.termsVersion,riskVersion:pending.riskVersion}
    };
    const user={
      id:pending.userId,tenantId:pending.tenantId,username:pending.username,email,role:'owner',status:'active',
      authProvider:'netlify_identity',identityUserId:identityId,credentialVersion:1,mustChangeDefault:false,
      createdAt:pending.createdAt||now,termsAcceptedAt:pending.createdAt||now,termsVersion:pending.termsVersion,
      riskDisclosureVersion:pending.riskVersion
    };
    await setSystemJSON(tenantKey(tenant.id),tenant,{onlyIfNew:true});
    const storedTenant=await getTenant(tenant.id);
    if(!storedTenant||storedTenant.ownerUserId!==user.id) throw new Error('TENANT_PROVISIONING_CONFLICT');
    await setSystemJSON(userKey(user.id),user,{onlyIfNew:true});
    const storedUser=await getUserRecord(user.id);
    if(!storedUser||storedUser.tenantId!==tenant.id||normalizeIdentifier(storedUser.email)!==email) throw new Error('USER_PROVISIONING_CONFLICT');
    await bindLogin(email,user.id);
    await bindLogin(user.username,user.id);
    await setSystemJSON(identityKey(identityId),user.id,{onlyIfNew:true});
    if(await getSystemJSON(identityKey(identityId),null)!==user.id) throw new Error('IDENTITY_PROVISIONING_CONFLICT');
    await writeIndex(TENANT_INDEX_KEY,tenant.id);
    await writeIndex(USER_INDEX_KEY,user.id);
    await setSystemJSON(pendingSignupKey(email),{...pending,status:'complete',identityUserId:identityId,completedAt:now,updatedAt:now});
    return principalFromUser(storedUser,identityId);
  });
}
function isLegacyTenantKey(key){
  const exact=new Set(['user/profile','user/settings','portfolio/transactions','portfolio/marks','trace/status','trace/world-state/latest','decisions/index','mirror/ai/latest','mirror/ai/history','mirror/wallet/latest','evolution/state','broker/orders','broker/watchlist','market/research-series']);
  if(exact.has(key)) return true;
  return ['snapshots/','traces/','trace/world-state/','decisions/','jobs/','ops/','limits/','restore/'].some(p=>key.startsWith(p));
}
async function migrateLegacyTenantData(tenantId){
  return await withSystemKeyLock('legacy-tenant-migration-v1',async()=>{
    const prior=await getSystemJSON(LEGACY_MIGRATION_KEY,null);
    if(prior?.status==='complete') return prior;
    const keys=(await listLegacyGlobalKeys('')).filter(isLegacyTenantKey);
    let copied=0,skipped=0;
    for(const key of keys){
      const value=await getLegacyGlobalJSON(key,null);
      if(value===null){ skipped++; continue; }
      const result=await setTenantJSONForMigration(tenantId,key,value,{onlyIfNew:true});
      if(result?.modified===false) skipped++; else copied++;
    }
    const marker={status:'complete',tenantId,copied,skipped,sourcePreserved:true,completedAt:new Date().toISOString()};
    await setSystemJSON(LEGACY_MIGRATION_KEY,marker);
    return marker;
  });
}

async function bootstrapCommercialAuth(){
  return await withSystemKeyLock('commercial-auth-bootstrap',async()=>{
    const ids=await getSystemJSON(USER_INDEX_KEY,[]);
    if(Array.isArray(ids)&&ids.length){
      const users=(await Promise.all(ids.map(id=>getUserRecord(id)))).filter(Boolean);
      const owner=users.find(user=>user.status==='active'&&user.role==='owner')||null;
      const firstActive=owner||users.find(user=>user.status==='active')||users[0]||null;
      if(firstActive){
        const marker=await getSystemJSON(LEGACY_MIGRATION_KEY,null);
        if(marker?.status!=='complete'&&owner) await migrateLegacyTenantData(owner.tenantId);
        return firstActive;
      }
    }
    const legacy=await getLegacyGlobalJSON('auth/credentials',null).catch(()=>null);
    const configuredPassword=String(getEnv('SAURON_ADMIN_PASSWORD')||'');
    // Fresh commercial installations may rely entirely on Netlify Identity and have no legacy owner.
    if(!legacy && !configuredPassword) return null;
    const username=cleanUsername(legacy?.username||getEnv('SAURON_ADMIN_USER','admin'));
    const password=configuredPassword||INITIAL_DEFAULT_PASSWORD;
    const tenantId=stableBootstrapId('t',getEnv('KAIROS_BOOTSTRAP_TENANT_ID')||`bootstrap:${username}`);
    const userId=stableBootstrapId('u',`bootstrap:${username}`);
    const salt=legacy?.salt||crypto.randomBytes(16).toString('hex');
    const passwordHash=legacy?.passwordHash||hashPassword(password,salt);
    const emailRaw=String(getEnv('KAIROS_ADMIN_EMAIL')||'').trim().toLowerCase();
    const email=emailRaw&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)?emailRaw:'';
    const now=new Date().toISOString();
    const tenant={id:tenantId,name:String(getEnv('KAIROS_BOOTSTRAP_TENANT_NAME')||'Kairos Workspace').slice(0,100),status:'active',plan:'private',createdAt:now,ownerUserId:userId};
    const user={
      id:userId,tenantId,username,email,role:'owner',status:'active',authProvider:'legacy',salt,passwordHash,
      credentialVersion:Number(legacy?.credentialVersion)||1,
      mustChangeDefault:legacy?.mustChangeDefault===true || (!legacy && password===INITIAL_DEFAULT_PASSWORD),
      createdAt:legacy?.createdAt||now,migratedFromLegacy:!!legacy
    };
    await setSystemJSON(tenantKey(tenantId),tenant,{onlyIfNew:true});
    await setSystemJSON(userKey(userId),user,{onlyIfNew:true});
    await bindLogin(username,userId); if(email) await bindLogin(email,userId);
    await writeIndex(TENANT_INDEX_KEY,tenantId); await writeIndex(USER_INDEX_KEY,userId);
    await migrateLegacyTenantData(tenantId);
    return (await getUserRecord(userId))||user;
  });
}
export async function ensureAuth(){ return bootstrapCommercialAuth(); }

async function principalFromIdentity(identityUser,{allowBootstrapLink=true}={}){
  if(!identityUser?.id) return null;
  if(identityUser?.emailVerified===false) return null;
  await bootstrapCommercialAuth();
  let internalId=await getSystemJSON(identityKey(identityUser.id),null);
  let user=internalId?await getUserRecord(internalId):null;
  const email=identityUser.email?cleanEmail(identityUser.email):'';
  if(!user && email){
    const pending=await getSystemJSON(pendingSignupKey(email),null);
    if(pending?.email===email && pending?.status!=='cancelled'){
      const recovered=await provisionPendingIdentity(identityUser,pending);
      user=await getUserRecord(recovered.userId);
      internalId=recovered.userId;
    }
  }
  if(!user && allowBootstrapLink && email){
    const adminEmail=normalizeIdentifier(getEnv('KAIROS_ADMIN_EMAIL'));
    if(adminEmail && adminEmail===email){
      const mappedId=await getSystemJSON(loginKey(email),null);
      const candidate=mappedId?await getUserRecord(mappedId):null;
      if(candidate?.role==='owner'){
        user={...candidate,email,identityUserId:identityUser.id,authProvider:'netlify_identity',updatedAt:new Date().toISOString()};
        await setSystemJSON(userKey(user.id),user);
        await setSystemJSON(identityKey(identityUser.id),user.id,{onlyIfNew:true});
        await bindLogin(email,user.id);
      }
    }
  }
  if(!user) return null;
  const tenant=await getTenant(user.tenantId); if(!tenant||tenant.status!=='active'||user.status!=='active') return null;
  const roles=Array.isArray(identityUser.roles)?identityUser.roles:[];
  const role=user.role||roles[0]||'member';
  return {userId:user.id,tenantId:user.tenantId,role,username:user.username,email:user.email||email,credentialVersion:Number(user.credentialVersion)||1,authProvider:'netlify_identity',identityUserId:identityUser.id};
}

async function authenticateLegacyCredentials(identifier,password){
  if(!legacyAuthEnabled()) return null;
  await bootstrapCommercialAuth();
  const normalized=normalizeIdentifier(identifier); if(!normalized) return null;
  const id=await getSystemJSON(loginKey(normalized),null); if(!id) return null;
  const user=await getUserRecord(id); if(!user||user.status!=='active'||!user.passwordHash||!user.salt) return null;
  const tenant=await getTenant(user.tenantId); if(!tenant||tenant.status!=='active') return null;
  if(!safeEqual(hashPassword(String(password||''),user.salt),user.passwordHash)) return null;
  return {userId:user.id,tenantId:user.tenantId,role:user.role||'member',username:user.username,email:user.email||'',credentialVersion:Number(user.credentialVersion)||1,authProvider:'legacy'};
}

export async function loginPrincipal(req,identifier,password){
  if(isNetlifyRuntime()) verifyIdentityRequestOrigin(req);
  const normalized=normalizeIdentifier(identifier);
  let identityError=null;
  if(normalized.includes('@') && getIdentityConfig()){
    try{
      const identityUser=await identityLogin(normalized,String(password||''));
      const principal=await principalFromIdentity(identityUser,{allowBootstrapLink:true});
      if(!principal) throw Object.assign(new Error('TENANT_NOT_PROVISIONED'),{status:403});
      return principal;
    }catch(e){ identityError=e; }
  }
  const legacy=await authenticateLegacyCredentials(normalized,password);
  if(legacy) return legacy;
  if(identityError){
    const code=String(identityError?.message||identityError),status=Number(identityError?.status||0);
    if(code.includes('TENANT_NOT_PROVISIONED')) throw identityError;
    if(status && ![400,401,422].includes(status)) throw new Error('IDENTITY_UNAVAILABLE');
    if(!status && !/invalid|credential|password|login/i.test(code)) throw new Error('IDENTITY_UNAVAILABLE');
  }
  return null;
}
export async function authenticateCredentials(identifier,password){ return authenticateLegacyCredentials(identifier,password); }
export async function verifyCredentials(identifier,password){ return !!(await authenticateLegacyCredentials(identifier,password)); }

function payloadForPrincipal(principal){ return {uid:principal.userId,tid:principal.tenantId,role:principal.role||'member',iat:Date.now(),v:5,cv:Number(principal.credentialVersion)||1}; }
export async function createSessionToken(principal=null){
  let p=principal; if(!p){ const user=await bootstrapCommercialAuth(); if(!user) throw new Error('AUTH_NOT_BOOTSTRAPPED'); p={userId:user.id,tenantId:user.tenantId,role:user.role,credentialVersion:Number(user.credentialVersion)||1}; }
  const payload=Buffer.from(JSON.stringify(payloadForPrincipal(p))).toString('base64url');
  return `${payload}.${signPayload(payload,sessionSecret())}`;
}
function parseCookie(req){
  const raw=req.headers.get('cookie')||'';
  for(const name of [COOKIE,LEGACY_COOKIE]){
    const hit=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));
    if(hit) return decodeURIComponent(hit.slice(name.length+1));
  }
  return null;
}
async function requireAppSession(req){
  const token=parseCookie(req); if(!token)return null;
  const [payload,sig]=token.split('.'); if(!payload||!sig)return null;
  if(!safeEqual(signPayload(payload,sessionSecret()),sig))return null;
  try{
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); const iat=Number(data?.iat),now=Date.now();
    if(data.v!==5||!data.uid||!data.tid||!Number.isFinite(iat)||iat>now+SESSION_CLOCK_SKEW_MS||now-iat>SESSION_MAX_AGE_MS) return null;
    const user=await getUserRecord(data.uid); if(!user||user.status!=='active'||user.tenantId!==data.tid) return null;
    const tenant=await getTenant(data.tid); if(!tenant||tenant.status!=='active'||Number(data.cv)!==(Number(user.credentialVersion)||1)) return null;
    return {userId:user.id,tenantId:user.tenantId,role:user.role||'member',username:user.username,email:user.email||'',iat,v:5,cv:Number(user.credentialVersion)||1,authProvider:user.authProvider||'legacy',identityUserId:user.identityUserId||null};
  }catch{return null}
}
export async function requireSession(req){
  const appSession=await requireAppSession(req);
  if(appSession){ configureTenantForRequest(appSession); return appSession; }
  const identityUser=await getIdentityUser().catch(()=>null);
  if(identityUser){
    const principal=await principalFromIdentity(identityUser,{allowBootstrapLink:true});
    if(principal){ configureTenantForRequest(principal); return principal; }
  }
  return null;
}
export function sessionCookie(token){return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_AGE_MS/1000)}`}
export function clearSessionCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}
export async function logoutIdentitySession(req){
  if(isNetlifyRuntime()) verifyIdentityRequestOrigin(req);
  try{ if(getIdentityConfig()) await identityLogout(); }catch(e){ if(Number(e?.status||0)===403) throw e; }
}


export function hasRole(session,roles=[]){ return !!session && roles.includes(String(session.role||'')); }
export function requireRole(session,roles=[]){ if(!hasRole(session,roles)) throw new Error('FORBIDDEN'); return session; }

export async function updateCredentials(session,{currentPassword,newUsername,newPassword}){
  if(!session?.userId) throw new Error('UNAUTHORIZED');
  const user=await getUserRecord(session.userId); if(!user||user.status!=='active') throw new Error('UNAUTHORIZED');
  const username=newUsername?cleanUsername(newUsername):user.username;
  if(session.authProvider==='netlify_identity'){
    if(newPassword) throw new Error('IDENTITY_PASSWORD_MANAGED');
    if(username.toLowerCase()!==String(user.username||'').toLowerCase()) await bindLogin(username,user.id);
    const next={...user,username,updatedAt:new Date().toISOString()}; await setSystemJSON(userKey(user.id),next);
    return publicAuthState({...session,username});
  }
  if(!safeEqual(hashPassword(currentPassword||'',user.salt),user.passwordHash))throw new Error('CURRENT_PASSWORD_INVALID');
  if(username.toLowerCase()!==String(user.username||'').toLowerCase()){ const current=await getSystemJSON(loginKey(username),null); if(current&&current!==user.id) throw new Error('USERNAME_IN_USE'); }
  let salt=user.salt,passwordHash=user.passwordHash,passwordChanged=false;
  if(newPassword){ if(newPassword.length<12)throw new Error('PASSWORD_TOO_SHORT'); if(newPassword===INITIAL_DEFAULT_PASSWORD)throw new Error('DEFAULT_PASSWORD_FORBIDDEN'); salt=crypto.randomBytes(16).toString('hex'); passwordHash=hashPassword(newPassword,salt); passwordChanged=true; }
  const next={...user,username,salt,passwordHash,mustChangeDefault:passwordChanged?false:!!user.mustChangeDefault,credentialVersion:(Number(user.credentialVersion)||1)+1,updatedAt:new Date().toISOString()};
  await setSystemJSON(userKey(user.id),next); await bindLogin(username,user.id);
  return publicAuthState({...session,username,cv:next.credentialVersion});
}

export async function confirmCommercialEmail(req,token){
  const cleanToken=String(token||'').trim();
  if(cleanToken.length<16 || cleanToken.length>4096) throw new Error('CONFIRMATION_TOKEN_INVALID');
  if(!getIdentityConfig()) throw new Error('IDENTITY_NOT_CONFIGURED');
  if(isNetlifyRuntime()) verifyIdentityRequestOrigin(req);
  const identityUser=await identityConfirmEmail(cleanToken);
  const principal=await principalFromIdentity(identityUser,{allowBootstrapLink:true});
  if(!principal) throw new Error('TENANT_PROVISIONING_FAILED');
  return principal;
}

export async function createCommercialAccount(req,{email,password,fullName,acceptedTermsVersion,acceptedRiskDisclosure}){
  const legal=commercialLegalConfig();
  if(!legal.signupAllowed){ if(!legal.signupRequested) throw new Error('SIGNUPS_DISABLED'); if(!legal.launchGate) throw new Error('PUBLIC_SIGNUP_NOT_RELEASED'); if(!legal.configured) throw new Error('COMMERCIAL_LEGAL_CONFIG_REQUIRED'); if(!legal.identityConfigured) throw new Error('IDENTITY_NOT_CONFIGURED'); if(legal.billingRequired&&!legal.billingConfigured) throw new Error('COMMERCIAL_BILLING_CONFIG_REQUIRED'); if(!legal.releaseGate?.ready) throw new Error('COMMERCIAL_RELEASE_GATE_CLOSED'); throw new Error('SIGNUPS_DISABLED'); }
  if(!getIdentityConfig()) throw new Error('IDENTITY_NOT_CONFIGURED');
  await bootstrapCommercialAuth();
  const clean=cleanEmail(email); if(String(password||'').length<12) throw new Error('PASSWORD_TOO_SHORT');
  if(acceptedTermsVersion!==legal.termsVersion||acceptedRiskDisclosure!==true) throw new Error('TERMS_ACCEPTANCE_REQUIRED');
  if(isNetlifyRuntime()) verifyIdentityRequestOrigin(req);
  return await withSystemKeyLock(`signup-email:${digest(clean).slice(0,24)}`,async()=>{
    if(await getSystemJSON(loginKey(clean),null)) throw new Error('ACCOUNT_EXISTS');
    const pkey=pendingSignupKey(clean);
    let pending=await getSystemJSON(pkey,null);
    if(pending?.status==='complete') throw new Error('ACCOUNT_EXISTS');
    if(pending && (pending.termsVersion!==legal.termsVersion || pending.riskVersion!==legal.riskVersion)) throw new Error('SIGNUP_RESTART_REQUIRED');
    if(!pending){
      pending=newPendingSignup(clean,fullName,legal);
      await setSystemJSON(pkey,pending,{onlyIfNew:true});
      pending=(await getSystemJSON(pkey,null))||pending;
    }
    let identityUser;
    try{
      identityUser=await identitySignup(clean,String(password),{
        full_name:String(fullName||'').trim().slice(0,100),
        kairos_terms_version:legal.termsVersion,
        kairos_risk_version:legal.riskVersion
      });
    }catch(e){
      const status=Number(e?.status||0),message=String(e?.message||e);
      if(status===422 && /already|registered|exists/i.test(message)) throw Object.assign(new Error('ACCOUNT_PENDING_LOGIN'),{status:409});
      throw e;
    }
    const identityId=String(identityUser?.id||''); if(!identityId) throw new Error('IDENTITY_SIGNUP_FAILED');
    const verified=identityUser?.emailVerified===true;
    pending={...pending,status:verified?'identity_verified':'awaiting_verification',identityUserId:identityId,updatedAt:new Date().toISOString()};
    await setSystemJSON(pkey,pending);
    if(!verified){
      return {principal:{userId:pending.userId,tenantId:pending.tenantId,role:'owner',username:pending.username,email:clean,credentialVersion:1,authProvider:'netlify_identity',identityUserId:identityId},emailVerified:false};
    }
    const principal=await provisionPendingIdentity(identityUser,pending);
    return {principal,emailVerified:true};
  });
}

export async function activateTenantForInternal(tenantId){ const tenant=await getTenant(String(tenantId||'')); if(!tenant||tenant.status!=='active') throw new Error('TENANT_NOT_ACTIVE'); configureTenantForRequest({tenantId:tenant.id,role:'system',userId:'system'}); return tenant; }
export async function listActiveTenants(){ await bootstrapCommercialAuth(); const ids=await getSystemJSON(TENANT_INDEX_KEY,[]),out=[]; for(const id of Array.isArray(ids)?ids:[]){ const t=await getTenant(id); if(t?.status==='active') out.push(t); } return out; }
export function commercialReleaseState(){ return commercialLegalConfig().releaseGate; }
export async function publicAuthState(session=null){
  const legal=commercialLegalConfig(); const identityConfigured=legal.identityConfigured===true; let user=null,tenant=null;
  if(session?.userId){ user=await getUserRecord(session.userId); tenant=await getTenant(session.tenantId); }
  return {mode:'commercial_multi_tenant',authProvider:session?.authProvider||null,user:user?{id:user.id,username:user.username,email:user.email||'',role:user.role||'member'}:null,tenant:tenant?{id:tenant.id,name:tenant.name,plan:tenant.plan||'private',status:tenant.status}:null,username:user?.username||null,mustChangeDefault:!!user?.mustChangeDefault,sessionMaxAgeHours:Math.round((SESSION_MAX_AGE_MS/3600000)*10)/10,signupAllowed:legal.signupAllowed&&identityConfigured,identityConfigured,billingReady:legal.billingConfigured,billingRequired:legal.billingRequired,legalEntity:legal.legalEntity||null,termsVersion:legal.termsVersion||null,riskDisclosureVersion:legal.riskVersion||null,termsUrl:legal.termsUrl||null,riskDisclosureUrl:legal.riskUrl||null,privacyUrl:legal.privacyUrl||null,release:{ready:legal.releaseGate?.ready===true,productMode:legal.releaseGate?.productMode||'paper_research',realMoneyExecution:legal.releaseGate?.realMoneyExecution===true,publicReleaseApproved:legal.releaseGate?.publicReleaseApproved===true,previewSmokeApproved:legal.releaseGate?.previewSmokeApproved===true},persistence:persistenceStatus(),tenantContext:currentTenantContext()?true:false,legacyAuthEnabled:legacyAuthEnabled()};
}
