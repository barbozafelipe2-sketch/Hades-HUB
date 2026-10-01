import crypto from 'node:crypto';
import { requireSession, requireRole, clearSessionCookie, logoutIdentitySession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { stageWorkspaceDeletion,revertStagedDeletion } from '../lib/data-lifecycle.mjs';
import { internalToken } from '../lib/internal.mjs';
import { getEnv } from '../lib/env.mjs';
import { verifyIdentityRequestOrigin } from '../lib/identity-provider.mjs';
import { auditCommercialEvent } from '../lib/commercial-control.mjs';

async function trigger(jobId,tenantId){
  const base=getEnv('DEPLOY_PRIME_URL')||getEnv('DEPLOY_URL')||getEnv('URL'); if(!base) throw new Error('DELETION_TRIGGER_URL_MISSING');
  const r=await fetch(base+'/.netlify/functions/privacy-delete-background',{method:'POST',headers:{'x-sauron-internal':internalToken(),'content-type':'application/json'},body:JSON.stringify({jobId,tenantId})});
  if(!(r.ok||r.status===202)) throw new Error('DELETION_TRIGGER_FAILED:'+r.status);
}
export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req); if(!session) return json({error:'UNAUTHORIZED'},401);
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  try{ requireRole(session,['owner']); }catch{ return json({error:'FORBIDDEN'},403); }
  if(session.authProvider==='netlify_identity'){ try{ verifyIdentityRequestOrigin(req); }catch{ return json({error:'ORIGIN_REJECTED'},403); } }
  const body=await readJSON(req,{maxBytes:4096}).catch(()=>({}));
  const jobId=crypto.randomUUID(); let staged;
  try{
    staged=await stageWorkspaceDeletion(session,{jobId,confirmation:body?.confirmation});
    await auditCommercialEvent(session,'privacy.deletion_requested',{requestId:context?.requestId,details:{action:'delete_workspace'}}).catch(()=>{});
    await trigger(staged.jobId,staged.tenantId);
    await logoutIdentitySession(req).catch(()=>{});
    return json({ok:true,status:'QUEUED',jobId:staged.jobId,message:'Workspace deletion queued. Access is blocked immediately.'},202,{'set-cookie':clearSessionCookie()});
  }catch(e){
    if(staged) await revertStagedDeletion({tenantId:staged.tenantId,jobId:staged.jobId,error:e?.message||e}).catch(()=>{});
    const code=String(e?.message||e);
    const status=/PRIVATE_OWNER_DELETE_BLOCKED|DELETION_CONFIRMATION_REQUIRED/.test(code)?400:/FORBIDDEN/.test(code)?403:503;
    return json({error:code},status);
  }
};
