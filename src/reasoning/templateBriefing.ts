import type { Briefing } from "../schemas/briefing.js";
import type { PortfolioAnalytics } from "../analytics/phase2.js";
import type { MarketIntelligence } from "../ingestion/phase1.js";
import type { ConflictSeed, RankedSignal } from "./signals.js";

export function buildTemplateBriefing(
  p1: MarketIntelligence,
  p2: PortfolioAnalytics,
  signals: RankedSignal[],
  conflictSeeds: ConflictSeed[]
): Briefing {
  const { pnl, profile, risks } = p2;
  const sign = pnl.dayPnlRupees >= 0 ? "gained" : "lost";
  const headline = `${profile.userName.split(" ")[0]}'s portfolio ${sign} ${Math.abs(pnl.dayPnlPercent).toFixed(2)}% today as ${p1.marketTrend.overallSentiment.toLowerCase()} conditions hit key sleeves.`;

  const summary = [
    `On ${p2.asOf}, the portfolio (₹${(profile.currentValue / 1e5).toFixed(2)}L) moved ${pnl.dayPnlPercent.toFixed(2)}% (₹${pnl.dayPnlRupees.toLocaleString("en-IN")}).`,
    p1.marketTrend.narrative,
    risks[0] ? `Risk context: ${risks[0]!.message}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const why = [
    `Today's mark-to-market is driven by your largest exposures and how they interacted with ${p1.marketTrend.overallSentiment.toLowerCase()} index action.`,
    signals[0]
      ? `The strongest news link in our engine is: "${signals[0]!.headline.slice(0, 120)}…" (${signals[0]!.weightContext}).`
      : "Limited high-confidence news-to-position links were found in the top ranks.",
  ].join(" ");

  const causal_chains = signals.slice(0, 5).map((s) => ({
    text: `[${s.linkKind}] ${s.headline} → context: ${s.weightContext}${s.dayChangePercent !== undefined ? `; stock day: ${s.dayChangePercent.toFixed(2)}%` : s.sectorDayChangePercent !== undefined ? `; sector day: ${s.sectorDayChangePercent.toFixed(2)}%` : ""}.`,
    news_ids: [s.newsId],
  }));

  const conflicts = conflictSeeds.map((c) => ({
    description: `${c.symbol ?? c.sector ?? "Holding"}: ${c.headline.slice(0, 100)} (news ${c.newsSentiment}, price ${c.dayChangePercent?.toFixed(2)}%).`,
    how_to_read_it: c.note,
  }));

  const key_drivers = [
    `Market tone: ${p1.marketTrend.overallSentiment} on broad indices`,
    ...signals.slice(0, 3).map((s) => s.headline.slice(0, 80) + (s.headline.length > 80 ? "…" : "")),
  ];

  return {
    headline,
    summary,
    why_portfolio_moved: why,
    causal_chains,
    conflicts,
    key_drivers,
    limitations:
      "Template mode (no GEMINI_API_KEY). Narrative is rule-based. Set GEMINI_API_KEY for a richer, judge-style briefing.",
  };
}
