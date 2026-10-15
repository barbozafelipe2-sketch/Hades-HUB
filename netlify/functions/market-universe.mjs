import { serializeTenantHandler } from '../lib/workspace-guard.mjs';
import { assertCommercialAccess, commercialErrorJSON } from '../lib/commercial-control.mjs';
import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { buildUniverseView, buildDynamicAssetView } from '../lib/market-universe.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { searchCryptoCatalog, findCryptoAsset } from '../lib/crypto-catalog.mjs';
import { normalizeSymbolInput } from '../lib/input.mjs';

export default serializeTenantHandler(async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);

  if(req.method==='GET'){
    const u=new URL(req.url);
    const category=String(u.searchParams.get('category')||'').toLowerCase();
    if(category==='crypto'){
      const q=String(u.searchParams.get('q')||'').slice(0,80);
      const offset=Math.max(0,Number(u.searchParams.get('offset'))||0);
      const limit=Math.max(1,Math.min(200,Number(u.searchParams.get('limit'))||100));
      const result=await searchCryptoCatalog({q,offset,limit});
      return json({ok:true,category:'crypto',...result});
    }
    return json({ok:true,assets:await buildUniverseView(),generatedAt:new Date().toISOString()});
  }

  if(req.method==='POST'){
    try{await assertCommercialAccess(session);}catch(e){const ce=commercialErrorJSON(e);if(ce)return json(ce.body,ce.status);throw e;}
    const body=await readJSON(req);
    if(body.action==='resolveCrypto'){
      let symbol;
      try{ symbol=normalizeSymbolInput(body.symbol,{required:true}); }
      catch(e){ return json({error:String(e.message||e)},400); }
      const asset=await findCryptoAsset(symbol);
      if(!asset) return json({error:'CRYPTO_ASSET_NOT_FOUND'},404);
      try{ return json({ok:true,asset:await buildDynamicAssetView(asset,{persistMark:true})}); }
      catch(e){ return json({error:String(e?.message||e)},502); }
    }
    return json({error:'UNKNOWN_ACTION'},400);
  }

  return json({error:'METHOD_NOT_ALLOWED'},405);
});
