import { Router, type Request, type Response, type NextFunction } from "express";
import { runPhase3, type Phase3RunOptions } from "../reasoning/phase3.js";
import { config } from "../config.js";

export const phase3Router: Router = Router();

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

phase3Router.get(
  "/",
  asyncRoute(async (_req, res) => {
    res.json({
      description: "Phase 3 — Autonomous reasoning (causal briefing)",
      path: "GET /api/v1/phase3/:portfolioId",
      note:
        "LLM: ADVISE_LLM_ALLOWLIST + explicit identity. When the list is set: X-Adviser-User-Email or ?userEmail= (no ADVISE_USER_EMAIL fallback). When the list is empty, ADVISE_USER_EMAIL may be used. Phase 4 + Langfuse. ?mode=auto|llm|template",
    });
  })
);

function parseMode(q: unknown): Phase3RunOptions["mode"] | "invalid" {
  if (q === undefined || q === "") return "auto";
  const s = String(q).toLowerCase();
  if (s === "auto" || s === "llm" || s === "template") return s;
  return "invalid";
}

phase3Router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const m = parseMode(req.query.mode);
    if (m === "invalid") {
      res.status(400).json({ error: "Query 'mode' must be auto, llm, or template" });
      return;
    }
    try {
      const q = req.query.userEmail;
      const fromHeader = req.get("X-Adviser-User-Email")?.trim();
      const fromQuery = typeof q === "string" ? q.trim() : undefined;
      const fromRequest = fromHeader || fromQuery || undefined;
      const hasAllowlist = config.adviseLlmAllowlist.length > 0;
      const userEmail = hasAllowlist
        ? fromRequest
        : fromRequest || config.adviseUserEmail?.trim() || undefined;
      const result = await runPhase3(id, { mode: m, userEmail });
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg.includes("ADVISE_LLM_ALLOWLIST") || msg.includes("LLM advise is limited")) {
        res.status(403).json({ error: msg });
        return;
      }
      if (msg.includes("GEMINI_API_KEY") || msg.includes("LLM mode")) {
        res.status(400).json({ error: msg });
        return;
      }
      throw e;
    }
  })
);
