import type {
  ImpactLevel,
  NewsData,
  NewsItem,
  NewsScope,
  NewsSentiment,
} from "../schemas/index.js";

/**
 * Numeric weight used for ranking. We combine impact_level and |sentiment_score|
 * to get a single "signal strength" per article.
 */
const IMPACT_WEIGHT: Record<ImpactLevel, number> = {
  HIGH: 1.0,
  MEDIUM: 0.6,
  LOW: 0.3,
};

export function newsStrength(item: NewsItem): number {
  const impact = IMPACT_WEIGHT[item.impact_level];
  const magnitude = Math.abs(item.sentiment_score ?? 0);
  // Give impact_level 70% weight, sentiment magnitude 30%.
  return +(impact * 0.7 + magnitude * 0.3).toFixed(3);
}

export type NewsIndex = {
  asOf: string;
  total: number;
  items: EnrichedNewsItem[];
  byScope: Record<NewsScope, EnrichedNewsItem[]>;
  bySentiment: Record<NewsSentiment, EnrichedNewsItem[]>;
  byImpact: Record<ImpactLevel, EnrichedNewsItem[]>;
  /** stocks symbol (upper) → articles */
  byStock: Map<string, EnrichedNewsItem[]>;
  /** sector key (upper) → articles */
  bySector: Map<string, EnrichedNewsItem[]>;
  /** index symbol (upper) → articles */
  byIndex: Map<string, EnrichedNewsItem[]>;
  marketWide: EnrichedNewsItem[];
  counts: {
    total: number;
    byScope: Record<NewsScope, number>;
    bySentiment: Record<NewsSentiment, number>;
    byImpact: Record<ImpactLevel, number>;
  };
};

export type EnrichedNewsItem = NewsItem & {
  /** Pre-computed weight used to prioritise this article downstream. */
  strength: number;
};

function emptyScopeMap(): Record<NewsScope, EnrichedNewsItem[]> {
  return {
    MARKET_WIDE: [],
    SECTOR_SPECIFIC: [],
    STOCK_SPECIFIC: [],
  };
}
function emptySentimentMap(): Record<NewsSentiment, EnrichedNewsItem[]> {
  return { POSITIVE: [], NEGATIVE: [], NEUTRAL: [], MIXED: [] };
}
function emptyImpactMap(): Record<ImpactLevel, EnrichedNewsItem[]> {
  return { HIGH: [], MEDIUM: [], LOW: [] };
}

function pushKey<K, V>(map: Map<K, V[]>, key: K, val: V) {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

export function buildNewsIndex(news: NewsData): NewsIndex {
  const byScope = emptyScopeMap();
  const bySentiment = emptySentimentMap();
  const byImpact = emptyImpactMap();
  const byStock = new Map<string, EnrichedNewsItem[]>();
  const bySector = new Map<string, EnrichedNewsItem[]>();
  const byIndex = new Map<string, EnrichedNewsItem[]>();
  const marketWide: EnrichedNewsItem[] = [];

  const enriched: EnrichedNewsItem[] = news.news.map((n) => ({
    ...n,
    strength: newsStrength(n),
  }));

  // Sort globally by strength desc so all downstream slices are pre-ranked.
  enriched.sort((a, b) => b.strength - a.strength);

  for (const item of enriched) {
    byScope[item.scope].push(item);
    bySentiment[item.sentiment].push(item);
    byImpact[item.impact_level].push(item);

    for (const s of item.entities.stocks) pushKey(byStock, s.toUpperCase(), item);
    for (const s of item.entities.sectors) pushKey(bySector, s.toUpperCase(), item);
    for (const s of item.entities.indices) pushKey(byIndex, s.toUpperCase(), item);

    if (item.scope === "MARKET_WIDE") marketWide.push(item);
  }

  const counts = {
    total: enriched.length,
    byScope: {
      MARKET_WIDE: byScope.MARKET_WIDE.length,
      SECTOR_SPECIFIC: byScope.SECTOR_SPECIFIC.length,
      STOCK_SPECIFIC: byScope.STOCK_SPECIFIC.length,
    },
    bySentiment: {
      POSITIVE: bySentiment.POSITIVE.length,
      NEGATIVE: bySentiment.NEGATIVE.length,
      NEUTRAL: bySentiment.NEUTRAL.length,
      MIXED: bySentiment.MIXED.length,
    },
    byImpact: {
      HIGH: byImpact.HIGH.length,
      MEDIUM: byImpact.MEDIUM.length,
      LOW: byImpact.LOW.length,
    },
  };

  return {
    asOf: news.metadata?.date ?? new Date().toISOString().slice(0, 10),
    total: enriched.length,
    items: enriched,
    byScope,
    bySentiment,
    byImpact,
    byStock,
    bySector,
    byIndex,
    marketWide,
    counts,
  };
}

/**
 * Retrieve news for a given stock symbol: stock-specific first, then sector-level,
 * then market-wide. Results are already strength-ranked.
 */
export function newsForStock(
  index: NewsIndex,
  stockSymbol: string,
  sector?: string,
  limit = 5
): { stock: EnrichedNewsItem[]; sector: EnrichedNewsItem[]; market: EnrichedNewsItem[] } {
  const stockHits = index.byStock.get(stockSymbol.toUpperCase()) ?? [];
  const sectorHits = sector ? index.bySector.get(sector.toUpperCase()) ?? [] : [];
  const marketHits = index.marketWide;

  return {
    stock: stockHits.slice(0, limit),
    sector: sectorHits.slice(0, limit),
    market: marketHits.slice(0, limit),
  };
}

export function newsForSector(
  index: NewsIndex,
  sector: string,
  limit = 5
): EnrichedNewsItem[] {
  return (index.bySector.get(sector.toUpperCase()) ?? []).slice(0, limit);
}
