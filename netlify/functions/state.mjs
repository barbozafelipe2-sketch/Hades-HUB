import { requireSession } from '../lib/auth.mjs';
import { json } from '../lib/http.mjs';
import { publicAuthState } from '../lib/auth.mjs';
import { getProfile,getSettings,getPortfolio,getWorldState,getTraceStatus,getDecisions,getPerformance,getSnapshots,getAIMirror,getWalletMirror,getEvolutionState,getPaperOrders,getWatchlist } from '../lib/state.mjs';
import { openAIConnectionStatus } from '../lib/openai.mjs';
import { providerStatus } from '../lib/providers.mjs';
import { persistenceStatus, configurePersistenceForRequest } from '../lib/store.mjs';
import { DEFAULT_STRATEGY,normalizeStrategy,evaluateStrategy,diagnoseDecisions,splitScoredHoldout,MATURITY_THRESHOLD } from '../lib/evolution.mjs';

export default async (req,context)=>{
  configurePersistenceForRequest(context);
  const session=await requireSession(req);
  if(!session) return json({error:'UNAUTHORIZED'},401);
  const [profile,settings,portfolio,worldState,traceStatus,decisions,performance,snapshots,auth,aiMirror,walletMirror,evolution,paperOrders,watchlist]=await Promise.all([
    getProfile(),getSettings(),getPortfolio(),getWorldState(),getTraceStatus(),getDecisions(),getPerformance(),getSnapshots(),publicAuthState(session),getAIMirror(),getWalletMirror(),getEvolutionState(),getPaperOrders(),getWatchlist()
  ]);
  const providers=providerStatus();
  const marketSource=String(worldState?._meta?.market_source||'');
  providers.market={...providers.market,
    verified:marketSource==='licensed_market_feed',
    activeSource:marketSource||null,
    activeProvider:worldState?._meta?.provider||null,
    fallbackUsed:worldState?._meta?.fallback_used===true,
    dataClass:marketSource==='licensed_market_feed'?'verified_market_feed':marketSource==='ai_context_only'?'context_only_no_prices':providers.market.dataClass
  };
  const split=splitScoredHoldout(decisions);
  const holdoutSet=split.holdout.length?split.holdout:split.all;
  const inspireSet=split.inspire.length?split.inspire:split.all;
  const championPolicy=normalizeStrategy(evolution?.champion?.policy||DEFAULT_STRATEGY);
  const holdoutMetrics=evaluateStrategy(holdoutSet,championPolicy);
  const inspireMetrics=evaluateStrategy(inspireSet,championPolicy);
  const evolutionEnriched={
    ...evolution,
    champion:{...(evolution.champion||{}),policy:championPolicy,metrics:{...holdoutMetrics,inspire:inspireMetrics,holdout:holdoutMetrics,maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount}},
    diagnosis:evolution.diagnosis||diagnoseDecisions(inspireSet),
    split:{maturedCount:split.maturedCount,inspireCount:split.inspireCount,holdoutCount:split.holdoutCount,threshold:MATURITY_THRESHOLD},
    live:split.maturedCount>=MATURITY_THRESHOLD
  };
  return json({profile,settings,portfolio,worldState,traceStatus,decisions,performance,snapshots:snapshots.slice(-120),auth,aiMirror,walletMirror,evolution:evolutionEnriched,paperOrders,watchlist,openAIStatus:openAIConnectionStatus(worldState),providers,persistence:persistenceStatus(),serverTime:new Date().toISOString()});
};
