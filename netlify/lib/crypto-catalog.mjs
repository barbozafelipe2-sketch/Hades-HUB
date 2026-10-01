import { twelveConfigured, twelveCryptoCatalog } from './twelve-data.mjs';
import { finnhubConfigured, finnhubCryptoCatalog } from './finnhub.mjs';
import { getSystemJSON, setSystemJSON } from './store.mjs';

const CACHE_KEY='catalog/crypto-usd-v2';
const CACHE_TTL_MS=24*60*60*1000;
const MAX_CATALOG_ROWS=10000;

function cleanToken(v){ return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,18); }
function prettyName(v,fallback){
  const s=String(v||'').trim();
  if(!s) return fallback;
  if(/^[A-Z0-9]{2,12}$/.test(s)) return fallback;
  return s.slice(0,80);
}
export function canonicalCryptoSymbol(base){ const b=cleanToken(base); return b?`${b}-USD`:''; }
export function cryptoBaseFromSymbol(symbol){
  const s=String(symbol||'').trim().toUpperCase();
  const m=s.match(/^([A-Z0-9]{1,18})-USD$/); if(m) return m[1];
  if(s==='BTC'||s==='ETH') return s; // legacy featured symbols
  return '';
}
export function isCanonicalCryptoSymbol(symbol){ return /^[A-Z0-9]{1,18}-USD$/.test(String(symbol||'').trim().toUpperCase()); }

function normalizeCatalog(rows=[]){
  const byBase=new Map();
  for(const row of rows){
    const vendor=String(row?.symbol||'').trim().toUpperCase();
    const m=vendor.match(/^([A-Z0-9]{1,18})\/USD$/);
    if(!m) continue;
    const base=m[1];
    if(!base || byBase.has(base)) continue;
    const label=prettyName(row?.currencyBase,base);
    byBase.set(base,{
      id:base==='BTC'?'crypto':base==='ETH'?'ethereum':`crypto-${base.toLowerCase()}`,
      label,
      symbol:base==='BTC'?'BTC':base==='ETH'?'ETH':canonicalCryptoSymbol(base),
      displaySymbol:base,
      vendorSymbol:vendor,
      kind:'Crypto',
      assetType:'crypto',
      quoteCurrency:'USD',
      description:`${label} / USD digital-asset market pair.`,
      exchanges:Array.isArray(row?.availableExchanges)?row.availableExchanges.slice(0,40):[]
    });
    if(byBase.size>=MAX_CATALOG_ROWS) break;
  }
  return [...byBase.values()].sort((a,b)=>a.displaySymbol.localeCompare(b.displaySymbol));
}

function fallbackCatalog(){
  return [
    {id:'crypto-btc',label:'Bitcoin',symbol:'BTC',displaySymbol:'BTC',vendorSymbol:'BTC/USD',kind:'Crypto',assetType:'crypto',quoteCurrency:'USD',description:'Bitcoin / USD digital-asset market pair.',exchanges:[]},
    {id:'crypto-eth',label:'Ethereum',symbol:'ETH',displaySymbol:'ETH',vendorSymbol:'ETH/USD',kind:'Crypto',assetType:'crypto',quoteCurrency:'USD',description:'Ethereum / USD digital-asset market pair.',exchanges:[]}
  ];
}

export async function getCryptoCatalog({force=false}={}){
  const now=Date.now();
  let cached=null;
  try{ cached=await getSystemJSON(CACHE_KEY,null); }catch{}
  const cachedAt=Date.parse(cached?.generatedAt||0);
  if(!force && Array.isArray(cached?.assets) && cached.assets.length && Number.isFinite(cachedAt) && now-cachedAt<CACHE_TTL_MS){
    return {...cached,stale:false,cacheHit:true};
  }
  const rows=[]; const providers=[]; const errors=[];
  if(twelveConfigured()){
    try{ rows.push(...await twelveCryptoCatalog()); providers.push('twelve_data'); }
    catch(e){ errors.push(`twelve_data:${String(e?.message||e).slice(0,140)}`); }
  }
  if(finnhubConfigured()){
    try{ rows.push(...await finnhubCryptoCatalog()); providers.push('finnhub'); }
    catch(e){ errors.push(`finnhub:${String(e?.message||e).slice(0,140)}`); }
  }
  const assets=normalizeCatalog(rows);
  if(assets.length){
    const fresh={generatedAt:new Date().toISOString(),provider:providers.join('+')||null,quoteCurrency:'USD',assets,total:assets.length,providerErrors:errors};
    try{ await setSystemJSON(CACHE_KEY,fresh); }catch{}
    return {...fresh,stale:false,cacheHit:false};
  }
  if(Array.isArray(cached?.assets) && cached.assets.length){
    return {...cached,stale:true,cacheHit:true,error:errors.join('|')||'CRYPTO_CATALOG_REFRESH_FAILED'};
  }
  const fallback=fallbackCatalog();
  return {generatedAt:new Date().toISOString(),provider:null,quoteCurrency:'USD',assets:fallback,total:fallback.length,stale:true,cacheHit:false,error:errors.join('|')||(twelveConfigured()||finnhubConfigured()?'CRYPTO_CATALOG_UNAVAILABLE':'CRYPTO_CATALOG_PROVIDER_NOT_CONFIGURED')};
}

function score(asset,q){
  if(!q) return 1;
  const qq=q.toLowerCase();
  const sym=String(asset.displaySymbol||asset.symbol||'').toLowerCase();
  const label=String(asset.label||'').toLowerCase();
  let s=0;
  if(sym===qq) s+=100;
  else if(sym.startsWith(qq)) s+=80;
  else if(sym.includes(qq)) s+=40;
  if(label===qq) s+=70;
  else if(label.startsWith(qq)) s+=55;
  else if(label.includes(qq)) s+=25;
  return s;
}

export async function searchCryptoCatalog({q='',offset=0,limit=100}={}){
  const catalog=await getCryptoCatalog();
  const query=String(q||'').trim();
  const ranked=(catalog.assets||[]).map(a=>({a,score:score(a,query)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.a.displaySymbol.localeCompare(b.a.displaySymbol)).map(x=>x.a);
  const start=Math.max(0,Number(offset)||0);
  const take=Math.max(1,Math.min(200,Number(limit)||100));
  const assets=ranked.slice(start,start+take);
  return {assets,total:ranked.length,offset:start,limit:take,hasMore:start+assets.length<ranked.length,generatedAt:catalog.generatedAt,provider:catalog.provider,quoteCurrency:'USD',stale:!!catalog.stale,error:catalog.error||null};
}

export async function findCryptoAsset(symbolOrBase){
  const raw=String(symbolOrBase||'').trim().toUpperCase();
  const base=cryptoBaseFromSymbol(raw)||cleanToken(raw);
  if(!base) return null;
  const catalog=await getCryptoCatalog();
  return (catalog.assets||[]).find(a=>String(a.displaySymbol).toUpperCase()===base) || null;
}
