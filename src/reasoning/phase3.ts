import { loadAll } from "../ingestion/dataLoader.js";
import { runPhase1 } from "../ingestion/phase1.js";
import { runPhase2 } from "../analytics/phase2.js";
import { buildRankedSignals } from "./signals.js";
import { computeReasoningConfidence } from "./confidence.js";
import { buildTemplateBriefing } from "./templateBriefing.js";
import { generateBriefingWithLlm } from "./llmBriefing.js";
import { config } from "../config.js";
import type { Briefing } from "../schemas/briefing.js";

export type Phase3Result = {
  portfolioId: string;
  asOf: string;
  generatedAt: string;
  confidence: number;
  briefing: Briefing;
  usedLlm: boolean;
  model?: string;
  usage?: { total_tokens?: number };
  /** How the briefing was produced: default = OpenAI if key exists, else template. */
  mode: "llm" | "template";
  meta: {
    signalCount: number;
    conflictCount: number;
    criticalRiskCount: number;
  };
};

export type Phase3RunOptions = {
  /**
   * - `auto` — LLM when `OPENAI_API_KEY` is set, else template (default).
   * - `llm` — require OpenAI; throws if no API key.
   * - `template` — rule-based briefing only; ignores API key.
   */
  mode?: "auto" | "llm" | "template";
};

export async function runPhase3(portfolioId: string, options: Phase3RunOptions = {}): Promise<Phase3Result> {
  const id = portfolioId.toUpperCase();
  const modeOpt = options.mode ?? "auto";
  if (modeOpt === "llm" && !config.openaiApiKey) {
    throw new Error(
      "Phase 3 LLM mode requires OPENAI_API_KEY. Set it in .env or run: npm run cli -- advise " +
        id +
        " --template"
    );
  }

  const [p1, p2] = await Promise.all([runPhase1(), runPhase2(id)]);
  const { market, mutualFundsFile, portfoliosFile } = await loadAll();
  const record = portfoliosFile.portfolios[id];
  if (!record) {
    throw new Error(`Portfolio '${id}' not found.`);
  }

  const { signals, conflictSeeds } = buildRankedSignals(
    p1.newsIndex,
    market,
    record,
    mutualFundsFile.mutual_funds,
    p1.sectorTrends
  );

  const criticalRiskCount = p2.risks.filter((r) => r.severity === "CRITICAL").length;
  const confidence = computeReasoningConfidence(signals, conflictSeeds.length, criticalRiskCount);

  const context = {
    portfolio: {
      id,
      investor: p2.profile.userName,
      type: p2.profile.portfolioType,
      description: p2.profile.description,
      currentValueInr: p2.profile.currentValue,
    },
    pnl: {
      dayPnlRupees: p2.pnl.dayPnlRupees,
      dayPnlPercentVsPriorDay: p2.pnl.dayPnlPercent,
      dayPnlPercentOfCurrentValue: p2.pnl.dayPnlPercentOfCurrentValue,
      stockDayPnlRupees: p2.pnl.stockDayPnlRupees,
      mfDayPnlRupees: p2.pnl.mfDayPnlRupees,
    },
    allocationSummary: {
      topSectorsWithLookthrough: Object.entries(p2.allocation.sectors.bySectorWithFunds)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([sector, weightPercent]) => ({ sector, weightPercent })),
      directStocksPercent: p2.allocation.assetTypes.DIRECT_STOCKS,
      mutualFundsPercent: p2.allocation.assetTypes.MUTUAL_FUNDS,
      mfCategorySplit: p2.allocation.assetTypes.mfByType,
    },
    risks: p2.risks.map((r) => ({
      code: r.code,
      severity: r.severity,
      message: r.message,
    })),
    market: {
      asOf: p1.asOf,
      overallSentiment: p1.marketTrend.overallSentiment,
      overallChangePercent: p1.marketTrend.overallChangePercent,
      narrative: p1.marketTrend.narrative,
    },
    rankedSignals: signals.map((s) => ({
      newsId: s.newsId,
      headline: s.headline,
      summary: s.summary.slice(0, 400),
      sentiment: s.sentiment,
      scope: s.scope,
      relevanceScore: s.relevanceScore,
      linkKind: s.linkKind,
      symbol: s.symbol,
      sector: s.sector,
      weightContext: s.weightContext,
      dayChangePercent: s.dayChangePercent,
      sectorDayChangePercent: s.sectorDayChangePercent,
    })),
    conflictSeeds,
    confidenceHint: confidence,
  };

  const generatedAt = new Date().toISOString();

  if (modeOpt === "template") {
    const briefing = buildTemplateBriefing(p1, p2, signals, conflictSeeds);
    return {
      portfolioId: id,
      asOf: p2.asOf,
      generatedAt,
      confidence,
      briefing,
      usedLlm: false,
      mode: "template",
      meta: {
        signalCount: signals.length,
        conflictCount: conflictSeeds.length,
        criticalRiskCount,
      },
    };
  }

  if (modeOpt === "llm" || (modeOpt === "auto" && config.openaiApiKey)) {
    const { briefing, model, usage } = await generateBriefingWithLlm(context);
    return {
      portfolioId: id,
      asOf: p2.asOf,
      generatedAt,
      confidence,
      briefing,
      usedLlm: true,
      model,
      usage,
      mode: "llm",
      meta: {
        signalCount: signals.length,
        conflictCount: conflictSeeds.length,
        criticalRiskCount,
      },
    };
  }

  const briefing = buildTemplateBriefing(p1, p2, signals, conflictSeeds);
  return {
    portfolioId: id,
    asOf: p2.asOf,
    generatedAt,
    confidence,
    briefing,
    usedLlm: false,
    mode: "template",
    meta: {
      signalCount: signals.length,
      conflictCount: conflictSeeds.length,
      criticalRiskCount,
    },
  };
}
