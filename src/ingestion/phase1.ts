import { loadAll } from "./dataLoader.js";
import { analyzeMarketTrend, type MarketTrend } from "./marketTrend.js";
import { analyzeSectorTrends, type SectorTrendsOutput } from "./sectorTrends.js";
import { buildNewsIndex, type NewsIndex } from "./newsProcessor.js";

export type MarketIntelligence = {
  asOf: string;
  generatedAt: string;
  marketTrend: MarketTrend;
  sectorTrends: SectorTrendsOutput;
  newsIndex: NewsIndex;
};

/**
 * Phase 1 — Market Intelligence Layer.
 *
 *   market_data.json  ─┐
 *   news_data.json    ─┼──► loadAll()  ──► analyze* ──► MarketIntelligence
 *   sector_mapping    ─┤
 *   historical_data   ─┘
 */
export async function runPhase1(): Promise<MarketIntelligence> {
  const { market, news, sectorMap, history } = await loadAll();

  const marketTrend = analyzeMarketTrend(market, history);
  const sectorTrends = analyzeSectorTrends(market, sectorMap, history);
  const newsIndex = buildNewsIndex(news);

  return {
    asOf: market.metadata.date,
    generatedAt: new Date().toISOString(),
    marketTrend,
    sectorTrends,
    newsIndex,
  };
}
