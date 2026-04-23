import { Router, type Request, type Response, type NextFunction } from "express";
import { loadAll } from "../ingestion/dataLoader.js";
import { listPortfoliosMeta, runPhase2 } from "../analytics/phase2.js";

export const phase2Router: Router = Router();

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** GET /api/v1/phase2/ — index */
phase2Router.get(
  "/",
  asyncRoute(async (_req, res) => {
    const { portfoliosFile } = await loadAll();
    res.json({
      description: "Phase 2 — Portfolio Analytics Engine",
      portfolioIds: Object.keys(portfoliosFile.portfolios).sort(),
      examples: {
        full: "GET /api/v1/phase2/PORTFOLIO_001",
        pnl: "GET /api/v1/phase2/PORTFOLIO_001/pnl",
        list: "GET /api/v1/phase2/portfolios",
      },
    });
  })
);

/** GET /api/v1/phase2/portfolios — must be registered before /:id */
phase2Router.get(
  "/portfolios",
  asyncRoute(async (_req, res) => {
    const rows = await listPortfoliosMeta();
    res.json({ count: rows.length, portfolios: rows });
  })
);

/** GET /api/v1/phase2/:id/pnl */
phase2Router.get(
  "/:id/pnl",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const analytics = await runPhase2(id);
    res.json({
      portfolioId: analytics.portfolioId,
      asOf: analytics.asOf,
      pnl: analytics.pnl,
    });
  })
);

/** GET /api/v1/phase2/:id/allocation */
phase2Router.get(
  "/:id/allocation",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const analytics = await runPhase2(id);
    res.json({
      portfolioId: analytics.portfolioId,
      asOf: analytics.asOf,
      allocation: analytics.allocation,
    });
  })
);

/** GET /api/v1/phase2/:id/risks */
phase2Router.get(
  "/:id/risks",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const analytics = await runPhase2(id);
    res.json({
      portfolioId: analytics.portfolioId,
      asOf: analytics.asOf,
      risks: analytics.risks,
    });
  })
);

/** GET /api/v1/phase2/:id — full portfolio analytics */
phase2Router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = String(req.params.id).toUpperCase();
    try {
      const analytics = await runPhase2(id);
      res.json(analytics);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
        return;
      }
      throw e;
    }
  })
);
