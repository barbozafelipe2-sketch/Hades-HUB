import { getEnv } from './env.mjs';
import { marketQuotes as truthQuotes, quote, licensedMarketConfigured, clearMarketTruthCache } from './market-truth.mjs';
import { twelveConfigured } from './twelve-data.mjs';
import { finnhubConfigured } from './finnhub.mjs';
import { sleep } from './finnhub.mjs';
// Sticky fallback is per symbol: licensed primary → Twelve Data → Finnhub.
export function marketQuotesConfigured(){return licensedMarketConfigured()||twelveConfigured()||finnhubConfigured();}
export function symbolShard(symbol){let h=2166136261;for(const c of String(symbol||'').trim().toUpperCase()){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0)%2;}
/** Compatibility helper; new truth router keeps fallback sticky per symbol. */
export function primaryProviderForSymbol(symbol){return licensedMarketConfigured()?'licensed_market_feed':(twelveConfigured()?'twelve':(finnhubConfigured()?'finnhub':null));}
export async function marketQuote(symbol,options={}){return quote(symbol,options);}
export async function marketQuotes(symbols,{deadlineAt}={}){return truthQuotes(symbols,{deadlineAt});}
export { sleep };
export function clearQuoteCache(){clearMarketTruthCache();}
