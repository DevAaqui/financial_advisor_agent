import { loadAll } from "../ingestion/dataLoader.js";
import { computePortfolioPnl, type PortfolioPnL } from "./pnl.js";
import { computeAllocation, type AssetTypeBreakdown, type SectorAllocation } from "./allocation.js";
import { detectRisks, type RiskFlag } from "./risk.js";

/** One portfolio’s analytics: profile, P&L, allocation (incl. MF look-through), and heuristic risk flags. */
export type PortfolioAnalytics = {
  portfolioId: string;
  asOf: string;
  generatedAt: string;
  profile: {
    userId?: string;
    userName: string;
    portfolioType: string;
    description?: string;
    currentValue: number;
  };
  pnl: PortfolioPnL;
  allocation: {
    assetTypes: AssetTypeBreakdown;
    sectors: SectorAllocation;
  };
  risks: RiskFlag[];
};

/**
 * Phase 2 — build analytics for a single portfolio: load data, validate id, then P&L, allocation, and risk rules.
 */
export async function runPhase2(portfolioId: string): Promise<PortfolioAnalytics> {
  const { market, portfoliosFile, mutualFundsFile, sectorMap } = await loadAll();
  const record = portfoliosFile.portfolios[portfolioId];
  if (!record) {
    throw new Error(`Portfolio '${portfolioId}' not found. Valid: ${listPortfolioIds(portfoliosFile).join(", ")}`);
  }

  const { stocks, mutual_funds: mutualFunds } = record.holdings;
  const pnl = computePortfolioPnl(record.current_value, stocks, mutualFunds);
  const allocation = computeAllocation(stocks, mutualFunds, mutualFundsFile.mutual_funds);

  const singleStockWeights = stocks.map((s) => ({
    symbol: s.symbol,
    weight: s.weight_in_portfolio,
  }));

  const risks = detectRisks(
    allocation.sectors.bySectorWithFunds,
    singleStockWeights,
    sectorMap
  );

  return {
    portfolioId,
    asOf: portfoliosFile.metadata?.date ?? market.metadata.date,
    generatedAt: new Date().toISOString(),
    profile: {
      userId: record.user_id,
      userName: record.user_name,
      portfolioType: record.portfolio_type,
      description: record.description,
      currentValue: record.current_value,
    },
    pnl,
    allocation,
    risks,
  };
}

/** Sorted list of portfolio keys from a loaded `portfolios.json` (used for 404 messages and UIs). */
export function listPortfolioIds(portfoliosFile: { portfolios: Record<string, unknown> }): string[] {
  return Object.keys(portfoliosFile.portfolios).sort();
}

/** Lightweight table of every portfolio: id, display name, type, and current value (for list endpoints). */
export async function listPortfoliosMeta(): Promise<
  Array<{
    id: string;
    userName: string;
    portfolioType: string;
    currentValue: number;
  }>
> {
  const { portfoliosFile } = await loadAll();
  return listPortfolioIds(portfoliosFile).map((id) => {
    const p = portfoliosFile.portfolios[id]!;
    return {
      id,
      userName: p.user_name,
      portfolioType: p.portfolio_type,
      currentValue: p.current_value,
    };
  });
}
