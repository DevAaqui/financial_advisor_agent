import express, { type Request, type Response, type NextFunction } from "express";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { config } from "./config.js";
import { logger } from "./observability/logger.js";
import { phase1Router } from "./api/phase1Routes.js";
import { phase2Router } from "./api/phase2Routes.js";
import { loadAll, invalidateCache } from "./ingestion/dataLoader.js";

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSec: Math.round(process.uptime()) });
  });

  app.post("/admin/reload", (_req, res) => {
    invalidateCache();
    res.json({ reloaded: true });
  });

  app.use("/api/v1/phase1", phase1Router);
  app.use("/api/v1/phase2", phase2Router);

  app.get("/", (_req, res) => {
    res.json({
      name: "Financial Advisor Agent — Phases 1 & 2 API",
      dataDir: config.dataDir,
      endpoints: [
        "GET  /health",
        "POST /admin/reload",
        "GET  /api/v1/phase1",
        "GET  /api/v1/phase1/market",
        "GET  /api/v1/phase1/sectors",
        "GET  /api/v1/phase1/sectors/:sector",
        "GET  /api/v1/phase1/news",
        "GET  /api/v1/phase1/news/for-stock/:symbol",
        "GET  /api/v1/phase2",
        "GET  /api/v1/phase2/portfolios",
        "GET  /api/v1/phase2/:id",
        "GET  /api/v1/phase2/:id/pnl | /allocation | /risks",
      ],
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      req.log.warn({ issues: err.issues }, "Validation error");
      res.status(400).json({ error: "ValidationError", issues: err.issues });
      return;
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    req.log.error({ err }, "Unhandled error");
    res.status(500).json({ error: "InternalServerError", message });
  });

  return app;
}

async function main() {
  await loadAll();
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`API listening on http://localhost:${config.port} (phases 1 & 2)`);
  });
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
}
