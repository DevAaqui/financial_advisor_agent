import type {
  MarketData,
  Sentiment,
  IndexQuote,
} from "../schemas/index.js";
import type { HistoricalData, Trend } from "../schemas/historical.js";

/**
 * Thresholds (in percent) used to derive day-level sentiment from an index move.
 * These are intentionally deterministic — no LLM involved.
 *   | change % |       sentiment       |
 *   |----------|-----------------------|
 *   |  >= +0.50 |      BULLISH          |
 *   |  <= -0.50 |      BEARISH          |
 *   |  else     |      NEUTRAL          |
 */
export const SENTIMENT_THRESHOLD = 0.5;

export function sentimentFromChange(changePercent: number): Sentiment {
  if (changePercent >= SENTIMENT_THRESHOLD) return "BULLISH";
  if (changePercent <= -SENTIMENT_THRESHOLD) return "BEARISH";
  return "NEUTRAL";
}

export type IndexTrend = {
  symbol: string;
  name: string;
  changePercent: number;
  daySentiment: Sentiment;
  providedSentiment?: Sentiment;
  sevenDayTrend?: Trend;
  sevenDayCumulativePercent?: number;
};

export type MarketTrend = {
  asOf: string;
  indices: IndexTrend[];
  /**
   * Aggregate market sentiment derived from the two broad-based indices
   * (NIFTY50 + SENSEX). This is the agent's global view of the day.
   */
  overallSentiment: Sentiment;
  overallChangePercent: number;
  narrative: string;
  marketBreadth?: {
    advances?: number;
    declines?: number;
    ratio?: number;
    new52wHighs?: number;
    new52wLows?: number;
    sentimentIndicator?: string;
  };
  flows?: {
    fiiEquityNetCr?: number;
    diiEquityNetCr?: number;
    observation?: string;
  };
};

function pickBroadMarketIndices(indices: Record<string, IndexQuote>): {
  nifty?: IndexQuote & { symbol: string };
  sensex?: IndexQuote & { symbol: string };
} {
  const nifty = indices.NIFTY50 ? { symbol: "NIFTY50", ...indices.NIFTY50 } : undefined;
  const sensex = indices.SENSEX ? { symbol: "SENSEX", ...indices.SENSEX } : undefined;
  return { nifty, sensex };
}

function buildNarrative(overall: Sentiment, changePct: number, indexTrends: IndexTrend[]): string {
  const dir =
    overall === "BULLISH" ? "advanced" : overall === "BEARISH" ? "declined" : "traded flat";
  const broad = indexTrends
    .filter((i) => i.symbol === "NIFTY50" || i.symbol === "SENSEX")
    .map((i) => `${i.name} ${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%`)
    .join(", ");
  const outliers = indexTrends
    .filter((i) => i.symbol !== "NIFTY50" && i.symbol !== "SENSEX")
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 2)
    .map((i) => `${i.name} ${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%`)
    .join(", ");

  const base = `Broad market ${dir} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%): ${broad}.`;
  return outliers ? `${base} Notable divergence: ${outliers}.` : base;
}

export function analyzeMarketTrend(
  market: MarketData,
  history?: HistoricalData
): MarketTrend {
  const indexTrends: IndexTrend[] = Object.entries(market.indices).map(([symbol, q]) => {
    const hist = history?.index_history?.[symbol];
    return {
      symbol,
      name: q.name,
      changePercent: q.change_percent,
      daySentiment: sentimentFromChange(q.change_percent),
      providedSentiment: q.sentiment,
      sevenDayTrend: hist?.trend,
      sevenDayCumulativePercent: hist?.cumulative_change_percent,
    };
  });

  const { nifty, sensex } = pickBroadMarketIndices(market.indices);
  const broadChanges = [nifty?.change_percent, sensex?.change_percent].filter(
    (v): v is number => typeof v === "number"
  );
  const overallChangePercent =
    broadChanges.length > 0 ? broadChanges.reduce((a, b) => a + b, 0) / broadChanges.length : 0;
  const overallSentiment = sentimentFromChange(overallChangePercent);

  const breadth = history?.market_breadth;
  const breadthBucket = breadth?.nifty50 ?? breadth?.nifty500;
  const breadthOut =
    breadthBucket
      ? {
          advances: breadthBucket.advances,
          declines: breadthBucket.declines,
          ratio:
            breadthBucket.advance_decline_ratio ??
            (breadthBucket.advances !== undefined &&
            breadthBucket.declines !== undefined &&
            breadthBucket.declines > 0
              ? +(breadthBucket.advances / breadthBucket.declines).toFixed(2)
              : undefined),
          new52wHighs: breadth?.new_52_week_highs,
          new52wLows: breadth?.new_52_week_lows,
          sentimentIndicator: breadth?.sentiment_indicator,
        }
      : undefined;

  const flows = history?.fii_dii_data
    ? {
        fiiEquityNetCr: history.fii_dii_data.fii?.net_value_cr,
        diiEquityNetCr: history.fii_dii_data.dii?.net_value_cr,
        observation: history.fii_dii_data.observation,
      }
    : undefined;

  return {
    asOf: market.metadata.date,
    indices: indexTrends,
    overallSentiment,
    overallChangePercent: +overallChangePercent.toFixed(3),
    narrative: buildNarrative(overallSentiment, overallChangePercent, indexTrends),
    marketBreadth: breadthOut,
    flows,
  };
}
