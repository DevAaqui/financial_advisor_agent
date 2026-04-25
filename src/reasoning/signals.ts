import type { MarketData } from "../schemas/market.js";
import type { PortfolioRecord } from "../schemas/portfolio.js";
import type { MutualFundScheme } from "../schemas/mutualFund.js";
import type { NewsIndex, EnrichedNewsItem } from "../ingestion/newsProcessor.js";
import { newsForStock, newsForSector } from "../ingestion/newsProcessor.js";
import type { SectorTrendsOutput } from "../ingestion/sectorTrends.js";

export type RankedSignal = {
  newsId: string;
  headline: string;
  summary: string;
  sentiment: string;
  scope: string;
  impactLevel: string;
  strength: number;
  relevanceScore: number;
  linkKind: "STOCK" | "SECTOR_MF" | "MARKET";
  symbol?: string;
  sector?: string;
  weightContext: string;
  dayChangePercent?: number;
  sectorDayChangePercent?: number;
};

export type ConflictSeed = {
  newsId: string;
  headline: string;
  symbol?: string;
  sector?: string;
  newsSentiment: string;
  dayChangePercent?: number;
  note: string;
};

/** Today’s % move for a sector from Phase 1 sector trends (for signal context). */
function sectorDayChange(sectorTrends: SectorTrendsOutput, sector: string): number | undefined {
  const s = sectorTrends.sectors.find((x) => x.sector === sector.toUpperCase());
  return s?.changePercent;
}

/** Today’s % move for a stock from `market.stocks`, or a holding-level fallback. */
function stockDayChange(market: MarketData, symbol: string, fallback?: number): number | undefined {
  const q = market.stocks[symbol.toUpperCase()];
  if (q) return q.change_percent;
  return fallback;
}

/** From `n.scope`: MARKET_WIDE → MARKET, else STOCK (MF sector rows set `SECTOR_MF` at the call site). */
function linkKind(n: EnrichedNewsItem): "STOCK" | "SECTOR_MF" | "MARKET" {
  if (n.scope === "MARKET_WIDE") return "MARKET";
  if (n.scope === "STOCK_SPECIFIC") return "STOCK";
  return "STOCK";
}

type SignalPartial = Pick<
  RankedSignal,
  | "linkKind"
  | "weightContext"
  | "symbol"
  | "sector"
  | "dayChangePercent"
  | "sectorDayChangePercent"
>;

/** Keep the best `relevanceScore` per `newsId` when the same story could match multiple links. */
function upsertSignal(
  best: Map<string, RankedSignal>,
  n: EnrichedNewsItem,
  mult: number,
  base: SignalPartial
): void {
  const relevanceScore = +(n.strength * mult).toFixed(4);
  const prev = best.get(n.id);
  if (!prev || relevanceScore > prev.relevanceScore) {
    best.set(n.id, {
      ...base,
      newsId: n.id,
      headline: n.headline,
      summary: n.summary,
      sentiment: n.sentiment,
      scope: n.scope,
      impactLevel: n.impact_level,
      strength: n.strength,
      relevanceScore,
    });
  }
}

/**
 * For each stock and top MF sector sleeves, join news to positions with a weight-based score;
 * return top signals plus headline-vs-price `conflictSeeds` for the briefing.
 */
export function buildRankedSignals(
  newsIndex: NewsIndex,
  market: MarketData,
  record: PortfolioRecord,
  mutualFundsCatalog: Record<string, MutualFundScheme>,
  sectorTrends: SectorTrendsOutput
): { signals: RankedSignal[]; conflictSeeds: ConflictSeed[] } {
  const best = new Map<string, RankedSignal>();

  for (const h of record.holdings.stocks) {
    const w = h.weight_in_portfolio / 100;
    const mult = w * 5;
    const dayCh = stockDayChange(market, h.symbol, h.day_change_percent);
    const sdc = sectorDayChange(sectorTrends, h.sector);
    const linked = newsForStock(newsIndex, h.symbol, h.sector, 12);

    const buckets: EnrichedNewsItem[] = [
      ...linked.stock,
      ...linked.sector.filter((x) => !linked.stock.some((s) => s.id === x.id)),
      ...linked.market.filter(
        (x) =>
          !linked.stock.some((s) => s.id === x.id) && !linked.sector.some((s) => s.id === x.id)
      ),
    ];

    for (const n of buckets) {
      upsertSignal(
        best,
        n,
        mult,
        {
          linkKind: linkKind(n),
          symbol: h.symbol,
          sector: h.sector,
          weightContext: `${h.symbol} ~${h.weight_in_portfolio.toFixed(1)}% of portfolio`,
          dayChangePercent: dayCh,
          sectorDayChangePercent: sdc,
        }
      );
    }
  }

  for (const m of record.holdings.mutual_funds) {
    const scheme = mutualFundsCatalog[m.scheme_code];
    const w = m.weight_in_portfolio / 100;
    if (!scheme?.sector_allocation) continue;

    const sectors = Object.entries(scheme.sector_allocation)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    for (const [sec, pct] of sectors) {
      const mult = w * (pct / 100) * 3;
      const sdc = sectorDayChange(sectorTrends, sec);
      for (const n of newsForSector(newsIndex, sec, 6)) {
        upsertSignal(best, n, mult, {
          linkKind: "SECTOR_MF",
          sector: sec,
          weightContext: `${m.scheme_code} ~${m.weight_in_portfolio.toFixed(1)}% × ${pct.toFixed(1)}% in ${sec}`,
          sectorDayChangePercent: sdc,
        });
      }
    }
  }

  const scored = [...best.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const top = scored.slice(0, 18);

  const conflictSeeds: ConflictSeed[] = [];
  for (const s of top) {
    const d = s.dayChangePercent;
    if (d === undefined) continue;
    if (s.linkKind === "SECTOR_MF") continue;
    if (s.sentiment === "POSITIVE" && d < -0.4) {
      if (s.scope === "MARKET_WIDE") continue;
      conflictSeeds.push({
        newsId: s.newsId,
        headline: s.headline,
        symbol: s.symbol,
        sector: s.sector,
        newsSentiment: s.sentiment,
        dayChangePercent: d,
        note: "Positive headline but stock down today — sector or market may dominate.",
      });
    } else if (s.sentiment === "NEGATIVE" && d > 0.4) {
      if (s.scope === "MARKET_WIDE") continue;
      conflictSeeds.push({
        newsId: s.newsId,
        headline: s.headline,
        symbol: s.symbol,
        sector: s.sector,
        newsSentiment: s.sentiment,
        dayChangePercent: d,
        note: "Negative headline but stock up — possible idiosyncratic drivers.",
      });
    } else if (s.sentiment === "MIXED" && Math.abs(d) > 1) {
      if (s.scope === "MARKET_WIDE") continue; // avoid unrelated macro + stock move
      conflictSeeds.push({
        newsId: s.newsId,
        headline: s.headline,
        symbol: s.symbol,
        sector: s.sector,
        newsSentiment: s.sentiment,
        dayChangePercent: d,
        note: "Mixed narrative with a large price move — worth unpacking.",
      });
    }
  }

  return { signals: top, conflictSeeds: conflictSeeds.slice(0, 6) };
}
