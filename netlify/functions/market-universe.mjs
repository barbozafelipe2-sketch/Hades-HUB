import { requireSession } from '../lib/auth.mjs';
import { json, readJSON } from '../lib/http.mjs';
import { buildUniverseView, buildDynamicAssetView } from '../lib/market-universe.mjs';
import { configurePersistenceForRequest } from '../lib/store.mjs';
import { searchCryptoCatalog, findCryptoAsset } from '../lib/crypto-catalog.mjs';
import { normalizeSymbolInput } from '../lib/input.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  if(!(await requireSession(req))) return json({error:'UNAUTHORIZED'},401);

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
};
