import { loadAll } from "../ingestion/dataLoader.js";
import { runPhase1 } from "../ingestion/phase1.js";
import { runPhase2 } from "../analytics/phase2.js";
import { buildRankedSignals } from "./signals.js";
import { computeReasoningConfidence } from "./confidence.js";
import { buildTemplateBriefing } from "./templateBriefing.js";
import { generateBriefingWithGemini } from "./geminiBriefing.js";
import { evaluateReasoningQuality, type ReasoningQuality } from "./reasoningQuality.js";
import { flushLangfuse, getLangfuseClient } from "../observability/langfuseClient.js";
import { config } from "../config.js";
import type { Briefing } from "../schemas/briefing.js";
import type { RankedSignal, ConflictSeed } from "./signals.js";
import { isUserAllowedForLlm } from "./adviseLlmAccess.js";

export type Phase3Result = {
  portfolioId: string;
  asOf: string;
  generatedAt: string;
  confidence: number;
  briefing: Briefing;
  usedLlm: boolean;
  model?: string;
  usage?: { total_tokens?: number };
  /** How the briefing was produced: default = Gemini if key exists, else template. */
  mode: "llm" | "template";
  meta: {
    signalCount: number;
    conflictCount: number;
    criticalRiskCount: number;
  };
  /** Phase 4 — rule-based narrative quality (distinct from `confidence`). */
  reasoningQuality: ReasoningQuality;
  /** Phase 4 — Langfuse trace when LLM + keys; `null` means keys set but no trace (e.g. template). */
  observability?: {
    langfuse: { traceId: string; traceUrl?: string } | null;
  };
};

export type Phase3RunOptions = {
  /**
   * - `auto` — LLM when `GEMINI_API_KEY` is set, else template (default).
   * - `llm` — require Gemini; throws if no API key.
   * - `template` — rule-based briefing only; ignores API key.
   */
  mode?: "auto" | "llm" | "template";
  /**
   * Who is calling: must match `ADVISE_LLM_ALLOWLIST` when that list is set.
   * CLI: `--as` (required when the list is set). HTTP: `X-Adviser-User-Email` or `?userEmail=`; when the list is set there is no `ADVISE_USER_EMAIL` fallback. When the list is empty, `ADVISE_USER_EMAIL` in config may supply identity for the API.
   */
  userEmail?: string;
};

/** Run `evaluateReasoningQuality` and, when Langfuse is on, post a `reasoning_quality` score on the trace. */
async function attachPhase4(
  briefing: Briefing,
  signals: RankedSignal[],
  conflictSeeds: ConflictSeed[],
  dayPnlRupees: number,
  langfuseTraceId?: string,
  langfuseTraceUrl?: string
): Promise<Pick<Phase3Result, "reasoningQuality" | "observability">> {
  const reasoningQuality = evaluateReasoningQuality(briefing, {
    validNewsIds: new Set(signals.map((s) => s.newsId)),
    conflictSeedCount: conflictSeeds.length,
    dayPnlRupees,
    signalCount: signals.length,
  });

  if (!config.langfuseEnabled) {
    return { reasoningQuality };
  }

  const lf = getLangfuseClient();
  if (langfuseTraceId && lf) {
    lf.score({
      traceId: langfuseTraceId,
      name: "reasoning_quality",
      value: reasoningQuality.score,
      comment: reasoningQuality.summary.slice(0, 300),
    });
    await flushLangfuse();
    return {
      reasoningQuality,
      observability: { langfuse: { traceId: langfuseTraceId, traceUrl: langfuseTraceUrl } },
    };
  }

  return {
    reasoningQuality,
    observability: { langfuse: null },
  };
}

/**
 * Phase 3 end-to-end: P1+P2, ranked signals, confidence, then template or Gemini briefing and Phase 4 quality.
 * Numbered `// 1.` … `// 8c` comments inside describe each step.
 */
export async function runPhase3(portfolioId: string, options: Phase3RunOptions = {}): Promise<Phase3Result> {
  // 1. Normalize id, resolve mode (auto | llm | template), and whether this caller may use Gemini (allowlist).
  const id = portfolioId.toUpperCase();
  const modeOpt = options.mode ?? "auto";
  const userEmail = options.userEmail;
  const allowLlm = isUserAllowedForLlm(userEmail, config.adviseLlmAllowlist);

  // 2. Fail fast when LLM is required or allowed by mode but identity/key policy blocks it.
  if (modeOpt === "llm" && !config.geminiApiKey) {
    throw new Error(
      "Phase 3 LLM mode requires GEMINI_API_KEY. Set it in .env or run: npm run cli -- advise " +
        id +
        " --template"
    );
  }
  if (modeOpt === "llm" && config.geminiApiKey && !allowLlm) {
    throw new Error(
      "LLM advise is limited to emails in ADVISE_LLM_ALLOWLIST. For the CLI: npm run cli -- advise <id> --as you@co.com ...  (or set ADVISE_USER_EMAIL only when the allowlist is empty). " +
        "For the API: send the X-Adviser-User-Email header or ?userEmail= (required on each request when the allowlist is set; ADVISE_USER_EMAIL is not used as a server-side default). " +
        "Or use --template (CLI) / mode=template (API)."
    );
  }

  // 3. Ingestion + analytics: Phase 1 (market/news) and Phase 2 (this portfolio) in parallel; load raw JSON and look up the portfolio row.
  const [p1, p2] = await Promise.all([runPhase1(), runPhase2(id)]);
  const { market, mutualFundsFile, portfoliosFile } = await loadAll();
  const record = portfoliosFile.portfolios[id];
  if (!record) {
    throw new Error(`Portfolio '${id}' not found.`);
  }

  // 4. Reasoning inputs: rank news against holdings (signals) and surface headline vs price conflict seeds.
  const { signals, conflictSeeds } = buildRankedSignals(
    p1.newsIndex,
    market,
    record,
    mutualFundsFile.mutual_funds,
    p1.sectorTrends
  );

  // 5. Scalar reasoning quality hint: critical risk count + confidence from signals/conflicts.
  const criticalRiskCount = p2.risks.filter((r) => r.severity === "CRITICAL").length;
  const confidence = computeReasoningConfidence(signals, conflictSeeds.length, criticalRiskCount);

  // 6. Payload for optional Gemini: structured portfolio, P&L, allocation, risks, market, ranked signals, conflicts, confidence.
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

  // 7. Response metadata common to all branches.
  const generatedAt = new Date().toISOString();
  const meta = {
    signalCount: signals.length,
    conflictCount: conflictSeeds.length,
    criticalRiskCount,
  };

  // 8a. Forced template: deterministic briefing, then Phase 4 quality scores.
  if (modeOpt === "template") {
    const briefing = buildTemplateBriefing(p1, p2, signals, conflictSeeds);
    const p4 = await attachPhase4(briefing, signals, conflictSeeds, p2.pnl.dayPnlRupees);
    return {
      portfolioId: id,
      asOf: p2.asOf,
      generatedAt,
      confidence,
      briefing,
      usedLlm: false,
      mode: "template",
      meta,
      ...p4,
    };
  }

  // 8b. Gemini path: key present, caller allowed, and mode is auto or llm — generate JSON briefing, optional Langfuse trace, Phase 4.
  if (config.geminiApiKey && allowLlm && (modeOpt === "llm" || modeOpt === "auto")) {
    const { briefing, model, usage, langfuseTraceId, langfuseTraceUrl } = await generateBriefingWithGemini(
      context,
      { portfolioId: id }
    );
    const p4 = await attachPhase4(
      briefing,
      signals,
      conflictSeeds,
      p2.pnl.dayPnlRupees,
      langfuseTraceId,
      langfuseTraceUrl
    );
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
      meta,
      ...p4,
    };
  }

  // 8c. Fallback template: auto without key, or allowlist denied under auto — same as 8a but implied by configuration.
  const briefing = buildTemplateBriefing(p1, p2, signals, conflictSeeds);
  const p4 = await attachPhase4(briefing, signals, conflictSeeds, p2.pnl.dayPnlRupees);
  return {
    portfolioId: id,
    asOf: p2.asOf,
    generatedAt,
    confidence,
    briefing,
    usedLlm: false,
    mode: "template",
    meta,
    ...p4,
  };
}
