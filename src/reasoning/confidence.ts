import type { RankedSignal } from "./signals.js";

/**
 * Deterministic 0–1 score: coverage of ranked signals, their strength, conflict penalty, critical risk penalty.
 * The LLM does not set this value.
 */
export function computeReasoningConfidence(
  signals: RankedSignal[],
  conflictCount: number,
  criticalRiskCount: number
): number {
  const n = signals.length;
  const coverage = Math.min(1, n / 10);
  const top = signals.slice(0, 5);
  const strength =
    top.length > 0 ? Math.min(1, top.reduce((s, x) => s + x.relevanceScore, 0) / 8) : 0.25;
  const conflictPenalty = Math.min(0.35, conflictCount * 0.07);
  const riskPenalty = Math.min(0.12, criticalRiskCount * 0.04);
  const raw = 0.4 * coverage + 0.35 * strength + 0.25 * (1 - conflictPenalty) - riskPenalty;
  return Math.round(Math.max(0.12, Math.min(0.92, raw)) * 1000) / 1000;
}
