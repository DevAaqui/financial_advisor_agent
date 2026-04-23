import { Router, type Request, type Response, type NextFunction } from "express";
import { runPhase3, type Phase3RunOptions } from "../reasoning/phase3.js";

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
      note: "Set GEMINI_API_KEY for LLM. Query: ?mode=auto|llm|template (default auto). /cli: npm run cli -- advise ID --llm | --template",
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
      const result = await runPhase3(id, { mode: m });
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
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
