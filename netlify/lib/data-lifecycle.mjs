import crypto from 'node:crypto';
import { getEnv } from './env.mjs';
import { getSystemJSON,setSystemJSON,listSystemKeys,deleteSystemKey,withSystemKeyLock,configureTenantForRequest,purgeCurrentTenantData } from './store.mjs';
import { purgeTenantRelationalData } from './database.mjs';
import { getBillingState } from './commercial-control.mjs';
import { cancelStripeSubscription } from './stripe-billing.mjs';
import { identityAdminDeleteUser } from './identity-provider.mjs';

const USER_INDEX_KEY='auth/users/index';
const TENANT_INDEX_KEY='auth/tenants/index';
const CONFIRMATION='DELETE MY KAIROS WORKSPACE';

function digest(v){ return crypto.createHash('sha256').update(String(v||'').trim().toLowerCase()).digest('hex'); }
function userKey(id){ return 'auth/users/'+String(id); }
function tenantKey(id){ return 'auth/tenants/'+String(id); }
function loginKey(v){ return 'auth/login/'+digest(v); }
function identityKey(id){ return 'auth/identity/'+String(id||'').replace(/[^A-Za-z0-9._:-]/g,'_').slice(0,160); }
function pendingSignupKey(email){ return 'auth/pending-signups/'+digest(email); }
function jobKey(id){ return 'privacy/deletions/'+String(id); }
function receiptKey(id){ return 'privacy/deletion-receipts/'+String(id); }

export function deletionConfirmationPhrase(){ return CONFIRMATION; }
export function assertDeletionPolicy(tenant,confirmation){
  if(!tenant?.id) throw new Error('TENANT_NOT_FOUND');
  if(String(confirmation||'')!==CONFIRMATION) throw new Error('DELETION_CONFIRMATION_REQUIRED');
  const allowPrivate=String(getEnv('KAIROS_ALLOW_PRIVATE_OWNER_DELETE','false')).toLowerCase()==='true';
  if(String(tenant.plan||'').toLowerCase()==='private'&&!allowPrivate) throw new Error('PRIVATE_OWNER_DELETE_BLOCKED');
  return true;
}
async function tenantUsers(tenantId){
  const ids=await getSystemJSON(USER_INDEX_KEY,[]),out=[];
  for(const id of Array.isArray(ids)?ids:[]){ const u=await getSystemJSON(userKey(id),null); if(u?.tenantId===tenantId) out.push(u); }
  return out;
}
async function removeMappingsWithValue(prefix,value){
  let removed=0;
  for(const key of await listSystemKeys(prefix)){ if(await getSystemJSON(key,null)===value){ await deleteSystemKey(key); removed++; } }
  return removed;
}
export async function stageWorkspaceDeletion(session,{jobId,confirmation}={}){
  if(session?.role!=='owner') throw new Error('FORBIDDEN');
  const tenant=await getSystemJSON(tenantKey(session.tenantId),null);
  assertDeletionPolicy(tenant,confirmation);
  const id=String(jobId||crypto.randomUUID());
  return await withSystemKeyLock('privacy-delete:'+tenant.id,async()=>{
    const fresh=await getSystemJSON(tenantKey(tenant.id),null);
    if(!fresh||fresh.status!=='active') throw new Error('TENANT_NOT_ACTIVE');
    const now=new Date().toISOString();
    await setSystemJSON(jobKey(id),{id,tenantId:tenant.id,userId:session.userId,status:'QUEUED',requestedAt:now});
    await setSystemJSON(tenantKey(tenant.id),{...fresh,status:'deleting',deletionJobId:id,deletionRequestedAt:now});
    return {jobId:id,tenantId:tenant.id};
  });
}
export async function revertStagedDeletion({tenantId,jobId,error}={}){
  return await withSystemKeyLock('privacy-delete:'+tenantId,async()=>{
    const tenant=await getSystemJSON(tenantKey(tenantId),null);
    if(tenant?.status==='deleting'&&tenant?.deletionJobId===jobId) await setSystemJSON(tenantKey(tenantId),{...tenant,status:'active',deletionJobId:null,deletionRequestedAt:null,deletionError:String(error||'trigger_failed').slice(0,180)});
    const job=await getSystemJSON(jobKey(jobId),null);
    if(job) await setSystemJSON(jobKey(jobId),{...job,status:'TRIGGER_FAILED',failedAt:new Date().toISOString(),error:String(error||'trigger_failed').slice(0,180)});
  });
}
export async function purgeKairosTenantData({tenantId,jobId}={}){
  const tenant=await getSystemJSON(tenantKey(tenantId),null);
  if(!tenant||tenant.status!=='deleting'||tenant.deletionJobId!==jobId) throw new Error('DELETION_JOB_NOT_ACTIVE');
  configureTenantForRequest({tenantId,userId:'system',role:'system'});
  const users=await tenantUsers(tenantId);
  const content=await purgeCurrentTenantData();
  const relational=await purgeTenantRelationalData(tenantId);
  let identityDeleted=0;
  for(const user of users){
    if(user.identityUserId){
      try{ await identityAdminDeleteUser(user.identityUserId); identityDeleted++; }
      catch(e){ if(!/404|not.?found/i.test(String(e?.message||e))) throw e; }
    }
  }
  let mappingsRemoved=0;
  await withSystemKeyLock('privacy-delete-system:'+tenantId,async()=>{
    for(const user of users){
      mappingsRemoved+=await removeMappingsWithValue('auth/login/',user.id);
      mappingsRemoved+=await removeMappingsWithValue('auth/identity/',user.id);
      if(user.email){ await deleteSystemKey(pendingSignupKey(user.email)); mappingsRemoved++; }
      await deleteSystemKey(userKey(user.id)); mappingsRemoved++;
    }
    const userIndex=await getSystemJSON(USER_INDEX_KEY,[]);
    await setSystemJSON(USER_INDEX_KEY,(Array.isArray(userIndex)?userIndex:[]).filter(id=>!users.some(u=>u.id===id)));
    const tenantIndex=await getSystemJSON(TENANT_INDEX_KEY,[]);
    await setSystemJSON(TENANT_INDEX_KEY,(Array.isArray(tenantIndex)?tenantIndex:[]).filter(id=>id!==tenantId));
    mappingsRemoved+=await removeMappingsWithValue('billing/customer/',tenantId);
    mappingsRemoved+=await removeMappingsWithValue('billing/subscription/',tenantId);
    await deleteSystemKey(tenantKey(tenantId));
    await deleteSystemKey(jobKey(jobId));
    await setSystemJSON(receiptKey(jobId),{completedAt:new Date().toISOString(),contentKeysRemoved:content.removed,auditRowsRemoved:relational.auditRemoved,usageRowsRemoved:relational.usageRemoved,identityUsersDeleted:identityDeleted});
  });
  return {contentKeysRemoved:content.removed,...relational,identityUsersDeleted:identityDeleted,mappingsRemoved};
}
export async function executeWorkspaceDeletion({tenantId,jobId}={}){
  const tenant=await getSystemJSON(tenantKey(tenantId),null);
  if(!tenant||tenant.status!=='deleting'||tenant.deletionJobId!==jobId) throw new Error('DELETION_JOB_NOT_ACTIVE');
  configureTenantForRequest({tenantId,userId:'system',role:'system'});
  const billing=await getBillingState().catch(()=>null);
  const status=String(billing?.subscriptionStatus||'').toLowerCase();
  if(billing?.subscriptionId && !['canceled','cancelled','deleted','inactive'].includes(status)){
    try{ await cancelStripeSubscription({subscriptionId:billing.subscriptionId}); }
    catch(e){ if(!/404|resource_missing/i.test(String(e?.message||e))) throw Object.assign(new Error('STRIPE_CANCELLATION_FAILED'),{cause:e}); }
  }
  return await purgeKairosTenantData({tenantId,jobId});
}
