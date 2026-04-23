import type { Briefing } from "../schemas/briefing.js";

export type ReasoningQualityCheck = { name: string; passed: boolean; detail?: string };

export type ReasoningQuality = {
  score: number;
  method: "rules";
  checks: ReasoningQualityCheck[];
  summary: string;
};

export type ReasoningQualityInput = {
  validNewsIds: Set<string>;
  conflictSeedCount: number;
  dayPnlRupees: number;
  signalCount: number;
};

const NEGATIVE_PNL = /(declin|fall|fell|down|negat|pressur|drift|drop|loss|losses|weak|bear|red|lower|shed|tight|strain|underperform)/i;
const POSITIVE_PNL = /(gain|gains|up|posit|rise|rose|tailwind|rally|strong|bull|higher|green|advance|rebound|beat)/i;

function checkNonemptyCore(b: Briefing): ReasoningQualityCheck {
  const ok =
    b.headline.trim().length > 0 &&
    b.summary.trim().length > 0 &&
    b.why_portfolio_moved.trim().length > 0;
  return { name: "nonempty_core", passed: ok, detail: ok ? undefined : "headline, summary, or why_portfolio_moved is empty" };
}

function checkKeyDriversCap(b: Briefing): ReasoningQualityCheck {
  const ok = b.key_drivers.length <= 5;
  return {
    name: "key_drivers_max_5",
    passed: ok,
    detail: ok ? undefined : `got ${b.key_drivers.length} items`,
  };
}

function checkNewsIdGrounding(b: Briefing, validNewsIds: Set<string>): ReasoningQualityCheck {
  const bad: string[] = [];
  for (const c of b.causal_chains) {
    for (const nid of c.news_ids) {
      if (!validNewsIds.has(nid)) {
        bad.push(nid);
      }
    }
  }
  if (bad.length === 0) {
    return { name: "news_id_grounding", passed: true };
  }
  return { name: "news_id_grounding", passed: false, detail: `unknown news_ids: ${[...new Set(bad)].slice(0, 5).join(", ")}` };
}

function checkConflictAck(b: Briefing, conflictSeedCount: number): ReasoningQualityCheck {
  if (conflictSeedCount < 1) {
    return { name: "conflict_ack", passed: true, detail: "no conflict seeds" };
  }
  const ok = b.conflicts.length >= 1;
  return {
    name: "conflict_ack",
    passed: ok,
    detail: ok ? undefined : `${conflictSeedCount} conflict seed(s) but no conflicts in briefing`,
  };
}

function checkPnlTone(b: Briefing, dayPnlRupees: number): ReasoningQualityCheck {
  const t = " ".concat(b.headline, " ", b.summary, " ", b.why_portfolio_moved);
  if (Math.abs(dayPnlRupees) < 1e-6) {
    return { name: "pnl_tone", passed: true, detail: "flat P&L" };
  }
  if (dayPnlRupees < 0) {
    const ok = NEGATIVE_PNL.test(t);
    return {
      name: "pnl_tone",
      passed: ok,
      detail: ok ? undefined : "negative day P&L: use clearer down/loss language in headline, summary, or why",
    };
  }
  const ok = POSITIVE_PNL.test(t);
  return {
    name: "pnl_tone",
    passed: ok,
    detail: ok ? undefined : "positive day P&L: use clearer up/gain language in headline, summary, or why",
  };
}

function checkThinData(b: Briefing, signalCount: number): ReasoningQualityCheck {
  if (signalCount > 0) {
    return { name: "thin_data", passed: true };
  }
  const lim = (b.limitations ?? "").trim();
  const ok = lim.length >= 10;
  return {
    name: "thin_data",
    passed: ok,
    detail: ok ? undefined : "no ranked signals: limitations should mention data thinness",
  };
}

/**
 * Rule-based 0..1 "reasoning quality" score: grounding to ranked news ids, conflict coverage, P&L tone, structure.
 * Independent of `confidence` in Phase 3 (which is evidence coverage, not narrative quality).
 */
export function evaluateReasoningQuality(briefing: Briefing, input: ReasoningQualityInput): ReasoningQuality {
  const checks = [
    checkNonemptyCore(briefing),
    checkKeyDriversCap(briefing),
    checkNewsIdGrounding(briefing, input.validNewsIds),
    checkConflictAck(briefing, input.conflictSeedCount),
    checkPnlTone(briefing, input.dayPnlRupees),
    checkThinData(briefing, input.signalCount),
  ];
  const passed = checks.filter((c) => c.passed).length;
  const score = +(passed / checks.length).toFixed(4);
  const failed = checks.filter((c) => !c.passed);
  const summary =
    failed.length === 0
      ? "All rule checks passed."
      : `Failed: ${failed.map((c) => c.name + (c.detail ? ` (${c.detail})` : "")).join("; ")}`;
  return { score, method: "rules", checks, summary };
}
