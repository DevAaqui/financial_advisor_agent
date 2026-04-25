import type { StockHolding, MFHolding } from "../schemas/portfolio.js";

export type HoldingPnlLine = {
  kind: "STOCK" | "MF";
  symbol: string;
  name?: string;
  dayPnlRupees: number;
  dayPnlPercent: number;
  weightInPortfolio: number;
  currentValue: number;
};

export type PortfolioPnL = {
  currentValue: number;
  dayPnlRupees: number;
  /**
   * Day return vs **prior-day** portfolio value (`currentValue - dayPnlRupees`),
   * matching the convention in `portfolios.json` → `analytics.day_summary`.
   */
  dayPnlPercent: number;
  /** Same P&L as a share of **today's** market value — useful for sensitivity / MTM views. */
  dayPnlPercentOfCurrentValue: number;
  /** Sum of line `day_change` — should match `dayPnlRupees`. */
  reconciledFromHoldings: boolean;
  stockDayPnlRupees: number;
  mfDayPnlRupees: number;
  topDayGainers: HoldingPnlLine[];
  topDayLosers: HoldingPnlLine[];
};

/** Map a direct stock row from `portfolios.json` into a uniform P&L line for sorting and display. */
function lineFromStock(s: StockHolding): HoldingPnlLine {
  return {
    kind: "STOCK",
    symbol: s.symbol,
    name: s.name,
    dayPnlRupees: s.day_change,
    dayPnlPercent: s.day_change_percent,
    weightInPortfolio: s.weight_in_portfolio,
    currentValue: s.current_value,
  };
}

/** Same as `lineFromStock` for an MF holding row. */
function lineFromMf(m: MFHolding): HoldingPnlLine {
  return {
    kind: "MF",
    symbol: m.scheme_code,
    name: m.scheme_name,
    dayPnlRupees: m.day_change,
    dayPnlPercent: m.day_change_percent,
    weightInPortfolio: m.weight_in_portfolio,
    currentValue: m.current_value,
  };
}

/**
 * Aggregate one portfolio’s day P&L from stock + MF `day_change` fields: totals, % vs prior value, and top movers.
 */
export function computePortfolioPnl(
  currentValue: number,
  stocks: StockHolding[],
  mutualFunds: MFHolding[]
): PortfolioPnL {
  const stockLines = stocks.map(lineFromStock);
  const mfLines = mutualFunds.map(lineFromMf);
  const all = [...stockLines, ...mfLines];

  const dayPnlRupees = all.reduce((s, l) => s + l.dayPnlRupees, 0);
  const stockDayPnlRupees = stockLines.reduce((s, l) => s + l.dayPnlRupees, 0);
  const mfDayPnlRupees = mfLines.reduce((s, l) => s + l.dayPnlRupees, 0);

  const priorValue = currentValue - dayPnlRupees;
  const dayPnlPercent =
    priorValue !== 0 ? (dayPnlRupees / priorValue) * 100 : currentValue > 0 ? (dayPnlRupees / currentValue) * 100 : 0;
  const dayPnlPercentOfCurrentValue = currentValue > 0 ? (dayPnlRupees / currentValue) * 100 : 0;

  const sortedByMove = [...all].sort((a, b) => b.dayPnlRupees - a.dayPnlRupees);
  const topDayGainers = sortedByMove.filter((l) => l.dayPnlRupees > 0).slice(0, 5);
  const topDayLosers = [...all]
    .sort((a, b) => a.dayPnlRupees - b.dayPnlRupees)
    .filter((l) => l.dayPnlRupees < 0)
    .slice(0, 5);

  return {
    currentValue,
    dayPnlRupees: +dayPnlRupees.toFixed(2),
    dayPnlPercent: +dayPnlPercent.toFixed(3),
    dayPnlPercentOfCurrentValue: +dayPnlPercentOfCurrentValue.toFixed(3),
    reconciledFromHoldings: true,
    stockDayPnlRupees: +stockDayPnlRupees.toFixed(2),
    mfDayPnlRupees: +mfDayPnlRupees.toFixed(2),
    topDayGainers,
    topDayLosers,
  };
}
