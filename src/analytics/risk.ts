import type { SectorMapping } from "../schemas/sector.js";

export type RiskSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskFlag = {
  code: string;
  severity: RiskSeverity;
  message: string;
  evidence: Record<string, unknown>;
};

const SECTOR_WARN_PCT = 40;
const SECTOR_CRITICAL_PCT = 70;
const SINGLE_STOCK_WARN_PCT = 15;
const SINGLE_STOCK_HIGH_PCT = 22;
const RATE_SENSITIVE_WARN_PCT = 50;

/** Residual buckets from MF look-through — not a "single economic sector" bet. */
const NON_ECONOMIC_SECTORS = new Set(["DIVERSIFIED_MF", "CASH", "OTHERS", "DEBT_FUNDS"]);

/** Sum BANKING + FINANCIAL_SERVICES weights (they often move together on RBI / rate news). */
function bankingClusterPct(sectors: Record<string, number>): number {
  const b = sectors.BANKING ?? sectors["BANKING"] ?? 0;
  const f = sectors.FINANCIAL_SERVICES ?? sectors["FINANCIAL_SERVICES"] ?? 0;
  return b + f;
}

/** Sectors with meaningful “economic” concentration (excludes residual MF/cash buckets). */
function economicSectors(sectors: Record<string, number>): [string, number][] {
  return Object.entries(sectors).filter(([k]) => !NON_ECONOMIC_SECTORS.has(k));
}

/**
 * Rule-based risk flags: sector / banking cluster / rate sensitivity / single-name weight vs thresholds in `sectorMap`.
 */
export function detectRisks(
  bySectorWithFunds: Record<string, number>,
  singleStockWeights: Array<{ symbol: string; weight: number }>,
  sectorMap: SectorMapping
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const sortedSectors = economicSectors(bySectorWithFunds).sort((a, b) => b[1] - a[1]);
  const maxSector = sortedSectors[0];
  if (maxSector && maxSector[1] > SECTOR_WARN_PCT) {
    const sev =
      maxSector[1] >= SECTOR_CRITICAL_PCT
        ? "CRITICAL"
        : maxSector[1] >= SECTOR_WARN_PCT * 1.2
          ? "HIGH"
          : "MEDIUM";
    flags.push({
      code: "SECTOR_CONCENTRATION",
      severity: sev,
      message: `Largest sector exposure is ${maxSector[0]} at ${maxSector[1].toFixed(2)}% of portfolio (threshold ${SECTOR_WARN_PCT}%).`,
      evidence: { sector: maxSector[0], weightPercent: maxSector[1] },
    });
  }

  const cluster = bankingClusterPct(bySectorWithFunds);
  if (cluster > SECTOR_WARN_PCT) {
    flags.push({
      code: "BANKING_AND_FINANCIAL_CLUSTER",
      severity: cluster >= SECTOR_CRITICAL_PCT ? "CRITICAL" : "HIGH",
      message: `Combined Banking + Financial Services exposure is ${cluster.toFixed(2)}% (rate-sensitive cluster).`,
      evidence: { bankingPlusFsPercent: cluster },
    });
  }

  const rateSet = new Set(sectorMap.rate_sensitive_sectors.map((s) => s.toUpperCase()));
  let rateExposure = 0;
  for (const [sec, w] of Object.entries(bySectorWithFunds)) {
    if (rateSet.has(sec.toUpperCase())) rateExposure += w;
  }
  if (rateExposure > RATE_SENSITIVE_WARN_PCT) {
    flags.push({
      code: "RATE_SENSITIVE_EXPOSURE",
      severity: rateExposure > 75 ? "HIGH" : "MEDIUM",
      message: `~${rateExposure.toFixed(2)}% of the portfolio is in rate-sensitive sectors (RBI / bond moves).`,
      evidence: { rateSensitivePercent: +rateExposure.toFixed(2) },
    });
  }

  for (const { symbol, weight } of singleStockWeights) {
    if (weight > SINGLE_STOCK_HIGH_PCT) {
      flags.push({
        code: "SINGLE_STOCK_CONCENTRATION",
        severity: "HIGH",
        message: `${symbol} is ${weight.toFixed(2)}% of the portfolio — single-name risk.`,
        evidence: { symbol, weightPercent: weight },
      });
    } else if (weight > SINGLE_STOCK_WARN_PCT) {
      flags.push({
        code: "SINGLE_STOCK_CONCENTRATION",
        severity: "MEDIUM",
        message: `${symbol} is ${weight.toFixed(2)}% of the portfolio.`,
        evidence: { symbol, weightPercent: weight },
      });
    }
  }

  return flags.sort(
    (a, b) =>
      ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].indexOf(a.severity) -
      ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].indexOf(b.severity)
  );
}
