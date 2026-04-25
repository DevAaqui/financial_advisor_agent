import { Router, type Request, type Response, type NextFunction } from "express";
import { runPhase1 } from "../ingestion/phase1.js";
import { newsForSector, newsForStock, type NewsIndex } from "../ingestion/newsProcessor.js";

/**
 * Serialize a NewsIndex so it can be sent over the wire (Maps aren't JSON).
 * Only emits the fields useful to API consumers.
 */
function serializeNewsIndex(idx: NewsIndex) {
  return {
    asOf: idx.asOf,
    total: idx.total,
    counts: idx.counts,
    items: idx.items,
    marketWide: idx.marketWide,
    byStock: Object.fromEntries(idx.byStock),
    bySector: Object.fromEntries(idx.bySector),
    byIndex: Object.fromEntries(idx.byIndex),
  };
}

export const phase1Router: Router = Router();

/** Wrap an async route so rejections are passed to Express `next` (avoids unhandled rejections). */
const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** GET /api/v1/phase1 — full market intelligence bundle. */
phase1Router.get(
  "/",
  asyncRoute(async (_req, res) => {
    const intel = await runPhase1();
    res.json({
      ...intel,
      newsIndex: serializeNewsIndex(intel.newsIndex),
    });
  })
);

/** GET /api/v1/phase1/market — overall market sentiment + per-index trends. */
phase1Router.get(
  "/market",
  asyncRoute(async (_req, res) => {
    const intel = await runPhase1();
    res.json(intel.marketTrend);
  })
);

/** GET /api/v1/phase1/sectors — sector trends (sorted by magnitude of move). */
phase1Router.get(
  "/sectors",
  asyncRoute(async (_req, res) => {
    const intel = await runPhase1();
    res.json(intel.sectorTrends);
  })
);

/** GET /api/v1/phase1/sectors/:sector — details + related news for a sector. */
phase1Router.get(
  "/sectors/:sector",
  asyncRoute(async (req, res) => {
    const key = String(req.params.sector).toUpperCase();
    const intel = await runPhase1();
    const signal = intel.sectorTrends.sectors.find((s) => s.sector === key);
    if (!signal) {
      res.status(404).json({ error: `Sector '${key}' not found.` });
      return;
    }
    res.json({
      ...signal,
      news: newsForSector(intel.newsIndex, key, 10),
    });
  })
);

/** GET /api/v1/phase1/news — full news index (scope/sentiment/impact + lookups). */
phase1Router.get(
  "/news",
  asyncRoute(async (_req, res) => {
    const intel = await runPhase1();
    res.json(serializeNewsIndex(intel.newsIndex));
  })
);

/**
 * GET /api/v1/phase1/news/for-stock/:symbol
 * Returns stock-specific / sector-level / market-wide news relevant to this stock,
 * already ranked by strength — ready for Phase 3 causal linking.
 */
phase1Router.get(
  "/news/for-stock/:symbol",
  asyncRoute(async (req, res) => {
    const sym = String(req.params.symbol).toUpperCase();
    const intel = await runPhase1();
    const stock = (await import("../ingestion/dataLoader.js")).loadAll;
    const { market } = await stock();
    const sector = market.stocks[sym]?.sector;
    if (!sector) {
      res.status(404).json({ error: `Stock '${sym}' not in market_data.json` });
      return;
    }
    const linked = newsForStock(intel.newsIndex, sym, sector, 10);
    res.json({
      symbol: sym,
      sector,
      stockNews: linked.stock,
      sectorNews: linked.sector,
      marketNews: linked.market,
    });
  })
);
