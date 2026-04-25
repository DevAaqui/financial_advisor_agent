/**
 * Classify mutual fund rows for asset-type breakdown (equity vs debt vs hybrid).
 * These heuristics match the spirit of the mock `asset_type_allocation` in portfolios.json.
 */

export type MfAssetBucket = "EQUITY_MF" | "DEBT_MF" | "HYBRID_MF" | "ARBITRAGE_MF" | "INDEX_MF";

const DEBT_CATEGORIES = new Set([
  "CORPORATE_BOND",
  "GILT",
  "DYNAMIC_BOND",
  "SHORT_DURATION",
  "CREDIT_RISK",
]);

const HYBRID_CATEGORIES = new Set(["BALANCED_ADVANTAGE", "AGGRESSIVE_HYBRID", "CONSERVATIVE_HYBRID"]);

/** Map a scheme `category` string to a coarse asset bucket (equity / debt / hybrid / …) for the allocation pie. */
export function classifyMutualFund(category: string): MfAssetBucket {
  const c = category.toUpperCase();
  if (DEBT_CATEGORIES.has(c) || c.includes("BOND") || c.includes("GILT")) return "DEBT_MF";
  if (HYBRID_CATEGORIES.has(c)) return "HYBRID_MF";
  if (c === "ARBITRAGE") return "ARBITRAGE_MF";
  if (c === "INDEX") return "INDEX_MF";
  return "EQUITY_MF";
}
