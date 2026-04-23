# Financial Advisor Agent — Phases 1 & 2

Express + TypeScript backend for the **Autonomous Financial Advisor Agent** challenge.

### Phase 1 — Market Intelligence

1. **Trend Analysis** — Bullish / Bearish / Neutral from NIFTY 50 + SENSEX.
2. **Sector Extraction** — sector moves, tags (rate-sensitive, defensive, …).
3. **News Processing** — index pre-tagged news by scope, entities, impact; numeric `strength`.

### Phase 2 — Portfolio Analytics

1. **Daily P&L** — sum of `day_change` (₹); headline % vs prior-day portfolio value (matches mock `analytics.day_summary`).
2. **Allocation** — direct stocks vs MFs; MF categories (equity / debt / hybrid / …); **sector look-through** via `mutual_funds.json` → `sector_allocation`.
3. **Risk** — sector concentration (>40% / >70%), Banking+FS cluster, rate-sensitive exposure, single-name weight.

> Phases 1–2 use **no LLM**. See [docs/phase1-explained.md](./docs/phase1-explained.md) and [docs/phase2-explained.md](./docs/phase2-explained.md).

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
│   │   ├── portfolio.ts
│   │   ├── mutualFund.ts
│   │   └── index.ts
│   ├── ingestion/               # ====  Phase 1  ====
│   │   ├── dataLoader.ts        #  Loads & validates JSON (Phase 1 + Phase 2 sources)
│   │   ├── marketTrend.ts       #  Indices → overall market sentiment
│   │   ├── sectorTrends.ts      #  Sector-level signals (+ classification)
│   │   ├── newsProcessor.ts     #  Indexes news by scope / entity / impact
│   │   └── phase1.ts            #  Orchestrator → MarketIntelligence
│   ├── analytics/               # ====  Phase 2  ====
│   │   ├── pnl.ts
│   │   ├── allocation.ts
│   │   ├── mfClassification.ts
│   │   ├── risk.ts
│   │   └── phase2.ts            #  runPhase2(portfolioId)
│   └── api/
│       ├── phase1Routes.ts      #  /api/v1/phase1/*
│       └── phase2Routes.ts      #  /api/v1/phase2/*
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Data Sources

`loadAll()` reads from `DATA_DIR` (default: parent folder):

| File                    | Phase(s) | Purpose |
| ----------------------- | -------- | ------- |
| `market_data.json`      | 1 | Indices, sectors, stocks |
| `news_data.json`        | 1 | News feed |
| `sector_mapping.json`   | 1, 2 | Sector tags; **rate-sensitive** list for risk |
| `historical_data.json`  | 1 | History, breadth, FII/DII |
| `portfolios.json`       | 2 | Three mock portfolios (`PORTFOLIO_001` … `003`) |
| `mutual_funds.json`     | 2 | Scheme `sector_allocation` for MF look-through |

All files are validated with Zod at load time.

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
API listening on http://localhost:3000 (phases 1 & 2)
```

### Phase 1 endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/phase1` | Full market-intelligence bundle |
| GET | `/api/v1/phase1/market` | Sentiment, indices, breadth, flows |
| GET | `/api/v1/phase1/sectors` | Sector ranking |
| GET | `/api/v1/phase1/sectors/:sector` | Sector + news |
| GET | `/api/v1/phase1/news` | News index |
| GET | `/api/v1/phase1/news/for-stock/:symbol` | News for one stock |

### Phase 2 endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/phase2` | Index + example paths |
| GET | `/api/v1/phase2/portfolios` | List mock portfolios |
| GET | `/api/v1/phase2/:id` | Full P&L + allocation + risks |
| GET | `/api/v1/phase2/:id/pnl` | P&L only |
| GET | `/api/v1/phase2/:id/allocation` | Allocation only |
| GET | `/api/v1/phase2/:id/risks` | Risk flags only |

### Quick checks

```bash
curl -s http://localhost:3000/api/v1/phase1/market | jq .overallSentiment
curl -s http://localhost:3000/api/v1/phase2/portfolios | jq
curl -s http://localhost:3000/api/v1/phase2/PORTFOLIO_002 | jq .pnl
```

---

## Run the CLI

The same pipeline is exposed through a friendly terminal UI — ideal for the demo video.

```bash
npm run cli -- market
npm run cli -- sectors --top 10
npm run cli -- news
npm run cli -- news-for HDFCBANK
npm run cli -- portfolios
npm run cli -- portfolio PORTFOLIO_002
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
- **Phase 2 P&L %** matches the mock convention: return vs **prior** portfolio value (`current_value - day_pnl`), not only vs current value. Both numbers are in the `pnl` object.

---

## Next Phases

- **Phase 3** — Causal narrative: merge Phase 1 + Phase 2 outputs; one (or two) LLM call(s) for the briefing.
- **Phase 4** — Langfuse tracing + self-evaluation of reasoning quality.
