# Financial Advisor Agent — Phase 1: Market Intelligence Layer

Express + TypeScript backend for the **Autonomous Financial Advisor Agent** challenge.
This repo implements **Phase 1** (Market Intelligence) end-to-end:

1. **Trend Analysis** — derives Bullish / Bearish / Neutral sentiment from NIFTY 50 + SENSEX.
2. **Sector Extraction** — dynamically ranks sector performance, cross-checks `sector_performance` against per-stock moves, tags sectors as rate-sensitive / defensive / cyclical / export-oriented.
3. **News Processing** — indexes the pre-tagged news feed by **scope** (Market / Sector / Stock), **sentiment**, **impact level**, and **entities**; computes a numeric `strength` for downstream ranking.

> The provided news feed is already tagged with sentiment + scope + entities, so Phase 1 does not call any LLM. This keeps latency at a few milliseconds and saves budget for Phase 3 reasoning.

---

## Stack

| Concern          | Choice                          |
| ---------------- | ------------------------------- |
| Runtime          | Node 20+                        |
| Language         | TypeScript (strict)             |
| Framework        | Express 4                       |
| Validation       | Zod                             |
| Logging          | Pino + pino-http                |
| CLI              | Commander + chalk + cli-table3  |
| Dev runner       | tsx (no build step in dev)      |

---

## Directory Layout

```
financial_advisor_agent/
├── src/
│   ├── config.ts                # Env + data-dir resolution
│   ├── server.ts                # Express entry point
│   ├── cli.ts                   # Commander CLI
│   ├── observability/
│   │   └── logger.ts            # Pino logger
│   ├── schemas/                 # Zod schemas matching the provided JSONs
│   │   ├── market.ts
│   │   ├── news.ts
│   │   ├── sector.ts
│   │   ├── historical.ts
│   │   └── index.ts
│   ├── ingestion/               # ====  Phase 1  ====
│   │   ├── dataLoader.ts        #  Loads & validates the 4 JSON sources
│   │   ├── marketTrend.ts       #  Indices → overall market sentiment
│   │   ├── sectorTrends.ts      #  Sector-level signals (+ classification)
│   │   ├── newsProcessor.ts     #  Indexes news by scope / entity / impact
│   │   └── phase1.ts            #  Orchestrator → MarketIntelligence
│   └── api/
│       └── phase1Routes.ts      #  /api/v1/phase1/* HTTP endpoints
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Data Sources

Phase 1 reads four files from `DATA_DIR` (default: the parent folder):

| File                    | What it feeds                                         |
| ----------------------- | ----------------------------------------------------- |
| `market_data.json`      | Indices, sector performance, per-stock quotes         |
| `news_data.json`        | Pre-tagged news articles                              |
| `sector_mapping.json`   | Sector definitions, rate-sensitive / defensive tags   |
| `historical_data.json`  | 7-day index/stock history, FII/DII flows, breadth     |

All four files are validated with Zod at load time. Any schema drift produces a clear 400 with the exact Zod issues at `/api/v1/*`.

---

## Setup

```bash
cd financial_advisor_agent
cp .env.example .env        # optional — defaults work out of the box
npm install
```

`DATA_DIR` defaults to `../` (the folder where the challenge dropped the JSONs). Change it in `.env` if your data lives elsewhere.

---

## Run the API Server

```bash
npm run dev                 # watch mode (tsx)
# or
npm start                   # one-shot
```

You should see:

```
Phase 1 API listening on http://localhost:3000
```

### Endpoints

| Method | Path                                            | Purpose                                                         |
| ------ | ----------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/health`                                       | Liveness probe                                                  |
| POST   | `/admin/reload`                                 | Invalidate in-memory cache (re-reads JSONs on next request)     |
| GET    | `/api/v1/phase1`                                | Full market-intelligence bundle                                 |
| GET    | `/api/v1/phase1/market`                         | Overall sentiment + per-index trends + breadth + FII/DII flows  |
| GET    | `/api/v1/phase1/sectors`                        | All sectors, ranked by magnitude of day-move                    |
| GET    | `/api/v1/phase1/sectors/:sector`                | Single sector details + ranked related news                     |
| GET    | `/api/v1/phase1/news`                           | Complete news index: counts + by-scope / by-sentiment / by-entity |
| GET    | `/api/v1/phase1/news/for-stock/:symbol`         | Stock / sector / market news for one symbol (ranked by strength) |

### Quick checks

```bash
curl -s http://localhost:3000/api/v1/phase1/market | jq .overallSentiment
curl -s http://localhost:3000/api/v1/phase1/sectors | jq '.sectors[0]'
curl -s http://localhost:3000/api/v1/phase1/news/for-stock/HDFCBANK | jq
```

---

## Run the CLI

The same pipeline is exposed through a friendly terminal UI — ideal for the demo video.

```bash
npm run cli -- market
npm run cli -- sectors --top 10
npm run cli -- news
npm run cli -- news-for HDFCBANK
```

Sample output (`market`):

```
Market Intelligence — 2026-04-21

Overall: BEARISH  (-0.99%)
Broad market declined (-0.99%): NIFTY 50 -1.00%, BSE SENSEX -0.99%. Notable divergence: NIFTY BANK -2.33%, NIFTY IT +1.22%.

┌────────────┬────────┬────────────────┬──────────────────┬────────┐
│ Index      │ Change │ Day Sentiment  │ 7-Day Trend      │ Cum %  │
├────────────┼────────┼────────────────┼──────────────────┼────────┤
│ NIFTY 50   │ -1.00% │ BEARISH        │ DOWNTREND        │ -2.34% │
│ BSE SENSEX │ -0.99% │ BEARISH        │ DOWNTREND        │ -2.18% │
│ NIFTY BANK │ -2.33% │ BEARISH        │ STRONG_DOWNTREND │ -4.15% │
│ NIFTY IT   │ +1.22% │ BULLISH        │ UPTREND          │ +2.83% │
└────────────┴────────┴────────────────┴──────────────────┴────────┘
```

---

## Design Notes

- **Deterministic before probabilistic.** Every number returned in Phase 1 is a pure function of the inputs. No LLM is involved — so this layer is trivially reproducible, diff-friendly, and cheap to run thousands of times for evaluation.
- **`sentiment` threshold is explicit.** `±0.5%` on the broad market decides Bullish / Bearish / Neutral. Tune via `SENTIMENT_THRESHOLD` in `marketTrend.ts`.
- **Provided vs. derived.** For each sector we keep both the authoritative `sector_performance` value **and** the re-derived average from the stocks we have data for. Any divergence is visible to downstream consumers (helps Phase 3 surface "sector vs. stock" conflicts like Tata Motors vs. Auto).
- **News strength** = `0.7 × impact_weight + 0.3 × |sentiment_score|`. Higher-impact, stronger-signed stories bubble to the top of every lookup.
- **Caching.** All JSONs are loaded once on first request. `POST /admin/reload` clears the cache without restarting.
- **Validation error UX.** Zod errors surface as `400 { error, issues[] }` so schema drift is obvious in dev.

---

## Next Phases

- Phase 2 will reuse `loadAll()` + the sector signal map to compute P&L, allocation, and concentration risk per portfolio.
- Phase 3 will consume `NewsIndex.byStock` / `bySector` / `marketWide` as pre-ranked candidate signals before a single LLM reasoning call.
- Phase 4 will wrap LLM calls in Langfuse tracing and grade the briefing's reasoning quality.
