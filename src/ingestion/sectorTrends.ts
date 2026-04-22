import type {
  MarketData,
  Sentiment,
  SectorMapping,
  Stock,
} from "../schemas/index.js";
import type { HistoricalData } from "../schemas/historical.js";
import { sentimentFromChange } from "./marketTrend.js";

export type SectorSignal = {
  sector: string;
  /** From sector_performance when available (authoritative). */
  providedChangePercent?: number;
  providedSentiment?: Sentiment;
  /** Re-computed from individual stocks in this sector (for cross-check). */
  derivedChangePercent?: number;
  derivedSentiment?: Sentiment;
  /** The change used for reasoning downstream. */
  changePercent: number;
  sentiment: Sentiment;
  stockCount: number;
  topGainers: string[];
  topLosers: string[];
  keyDrivers: string[];
  weeklyChangePercent?: number;
  weeklyCatalyst?: string;
  rateSensitive?: boolean;
  defensive?: boolean;
  cyclical?: boolean;
  exportOriented?: boolean;
};

export type SectorTrendsOutput = {
  asOf: string;
  sectors: SectorSignal[];
  bullishSectors: string[];
  bearishSectors: string[];
};

function groupStocksBySector(stocks: Record<string, Stock>): Map<string, Array<{ symbol: string; stock: Stock }>> {
  const by = new Map<string, Array<{ symbol: string; stock: Stock }>>();
  for (const [symbol, stock] of Object.entries(stocks)) {
    const key = stock.sector.toUpperCase();
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push({ symbol, stock });
  }
  return by;
}

function topByChange(
  items: Array<{ symbol: string; stock: Stock }>,
  n: number,
  direction: "gain" | "loss"
): string[] {
  const sorted = [...items].sort((a, b) =>
    direction === "gain"
      ? b.stock.change_percent - a.stock.change_percent
      : a.stock.change_percent - b.stock.change_percent
  );
  const filtered = sorted.filter(
    (x) => (direction === "gain" ? x.stock.change_percent > 0 : x.stock.change_percent < 0)
  );
  return filtered.slice(0, n).map((x) => x.symbol);
}

export function analyzeSectorTrends(
  market: MarketData,
  sectorMap: SectorMapping,
  history?: HistoricalData
): SectorTrendsOutput {
  const grouped = groupStocksBySector(market.stocks);
  const rateSensitive = new Set(sectorMap.rate_sensitive_sectors.map((s) => s.toUpperCase()));
  const defensive = new Set(sectorMap.defensive_sectors.map((s) => s.toUpperCase()));
  const cyclical = new Set(sectorMap.cyclical_sectors.map((s) => s.toUpperCase()));
  const exportOriented = new Set(sectorMap.export_oriented_sectors.map((s) => s.toUpperCase()));

  const allSectorKeys = new Set<string>([
    ...Object.keys(market.sector_performance),
    ...grouped.keys(),
    ...Object.keys(sectorMap.sectors),
  ]);

  const signals: SectorSignal[] = [];

  for (const sector of allSectorKeys) {
    const provided = market.sector_performance[sector];
    const stocksInSector = grouped.get(sector) ?? [];

    const derivedChangePercent =
      stocksInSector.length > 0
        ? +(
            stocksInSector.reduce((s, { stock }) => s + stock.change_percent, 0) /
            stocksInSector.length
          ).toFixed(3)
        : undefined;

    const changePercent =
      provided?.change_percent ?? derivedChangePercent ?? 0;

    const sentiment: Sentiment = provided?.sentiment ?? sentimentFromChange(changePercent);
    const derivedSentiment =
      derivedChangePercent !== undefined
        ? sentimentFromChange(derivedChangePercent)
        : undefined;

    const weekly = history?.sector_weekly_performance?.[sector];

    signals.push({
      sector,
      providedChangePercent: provided?.change_percent,
      providedSentiment: provided?.sentiment,
      derivedChangePercent,
      derivedSentiment,
      changePercent,
      sentiment,
      stockCount: stocksInSector.length,
      topGainers:
        provided?.top_gainers && provided.top_gainers.length > 0
          ? provided.top_gainers
          : topByChange(stocksInSector, 3, "gain"),
      topLosers:
        provided?.top_losers && provided.top_losers.length > 0
          ? provided.top_losers
          : topByChange(stocksInSector, 3, "loss"),
      keyDrivers: provided?.key_drivers ?? [],
      weeklyChangePercent: weekly?.weekly_change_percent,
      weeklyCatalyst: weekly?.catalyst,
      rateSensitive: rateSensitive.has(sector) || undefined,
      defensive: defensive.has(sector) || undefined,
      cyclical: cyclical.has(sector) || undefined,
      exportOriented: exportOriented.has(sector) || undefined,
    });
  }

  // Rank by magnitude of move so callers get the most informative signals first.
  signals.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  return {
    asOf: market.metadata.date,
    sectors: signals,
    bullishSectors: signals.filter((s) => s.sentiment === "BULLISH").map((s) => s.sector),
    bearishSectors: signals.filter((s) => s.sentiment === "BEARISH").map((s) => s.sector),
  };
}
