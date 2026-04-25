import type { StockHolding, MFHolding } from "../schemas/portfolio.js";
import type { MutualFundsFile } from "../schemas/mutualFund.js";
import { classifyMutualFund, type MfAssetBucket } from "./mfClassification.js";

export type AssetTypeBreakdown = {
  DIRECT_STOCKS: number;
  MUTUAL_FUNDS: number;
  /** Finer split of the MF sleeve (percent of total portfolio). */
  mfByType: Partial<Record<MfAssetBucket | "OTHER_MF", number>>;
};

export type SectorAllocation = {
  /** Direct equity only — sum of `weight_in_portfolio` by stock sector. */
  bySectorDirect: Record<string, number>;
  /**
   * Direct equity + MF look-through using `mutual_funds.json` → `sector_allocation`
   * × each MF's `weight_in_portfolio` / 100.
   */
  bySectorWithFunds: Record<string, number>;
};

/** Add `w` to `map[key]` (uppercased) — used when rolling up sector weights. */
function addTo(map: Record<string, number>, key: string, w: number): void {
  const k = key.toUpperCase();
  map[k] = (map[k] ?? 0) + w;
}

/**
 * Direct stock weights by sector, MF category split, and look-through sector weights using `mutual_funds.json` sector_allocation.
 */
export function computeAllocation(
  stocks: StockHolding[],
  mutualFunds: MFHolding[],
  mutualFundsCatalog: MutualFundsFile["mutual_funds"]
): { assetTypes: AssetTypeBreakdown; sectors: SectorAllocation } {
  const bySectorDirect: Record<string, number> = {};
  let directStocks = 0;
  for (const s of stocks) {
    directStocks += s.weight_in_portfolio;
    addTo(bySectorDirect, s.sector, s.weight_in_portfolio);
  }

  let totalMfWeight = 0;
  const mfByType: Partial<Record<MfAssetBucket | "OTHER_MF", number>> = {};

  for (const m of mutualFunds) {
    totalMfWeight += m.weight_in_portfolio;
    const bucket = classifyMutualFund(m.category);
    mfByType[bucket] = (mfByType[bucket] ?? 0) + m.weight_in_portfolio;
  }

  const assetTypes: AssetTypeBreakdown = {
    DIRECT_STOCKS: +directStocks.toFixed(2),
    MUTUAL_FUNDS: +totalMfWeight.toFixed(2),
    mfByType: Object.fromEntries(
      Object.entries(mfByType).map(([k, v]) => [k, +v.toFixed(2)])
    ) as AssetTypeBreakdown["mfByType"],
  };

  const bySectorWithFunds: Record<string, number> = { ...bySectorDirect };
  for (const m of mutualFunds) {
    const scheme = mutualFundsCatalog[m.scheme_code];
    const alloc = scheme?.sector_allocation;
    const w = m.weight_in_portfolio;
    if (alloc && Object.keys(alloc).length > 0) {
      for (const [sector, pct] of Object.entries(alloc)) {
        addTo(bySectorWithFunds, sector, (w * pct) / 100);
      }
    } else {
      addTo(bySectorWithFunds, "DIVERSIFIED_MF", w);
    }
  }

  const roundMap = (m: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(m)
        .map(([k, v]) => [k, +v.toFixed(2)] as const)
        .filter(([, v]) => Math.abs(v) > 0.001)
        .sort((a, b) => b[1] - a[1])
    );

  return {
    assetTypes,
    sectors: {
      bySectorDirect: roundMap(bySectorDirect),
      bySectorWithFunds: roundMap(bySectorWithFunds),
    },
  };
}
