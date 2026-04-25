import { z } from "zod";

export const CausalChainSchema = z.object({
  text: z.string(),
  news_ids: z.array(z.string()).default([]),
});

export const ConflictSchema = z.object({
  description: z.string(),
  how_to_read_it: z.string(),
});

export const BriefingSchema = z.object({
  headline: z.string(),
  summary: z.string().max(4000),
  /** Main explanation of today's P&L in one or two sentences. */
  why_portfolio_moved: z.string(),
  causal_chains: z.array(CausalChainSchema).default([]),
  conflicts: z.array(ConflictSchema).default([]),
  key_drivers: z.array(z.string()).default([]),
  /**
   * What the briefing does not know or is uncertain about.
   * Models sometimes return a string[]; we join into one string.
   */
  limitations: z.preprocess(
    (raw) => {
      if (raw === undefined || raw === null) return undefined;
      if (Array.isArray(raw)) {
        return raw
          .map((x) => (typeof x === "string" ? x : String(x)).trim())
          .filter(Boolean)
          .join("\n");
      }
      return raw;
    },
    z.string().optional()
  ),
});
export type Briefing = z.infer<typeof BriefingSchema>;
