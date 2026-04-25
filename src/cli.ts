import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { runPhase1 } from "./ingestion/phase1.js";
import { newsForStock } from "./ingestion/newsProcessor.js";
import { loadAll } from "./ingestion/dataLoader.js";
import { listPortfoliosMeta, runPhase2 } from "./analytics/phase2.js";
import { runPhase3 } from "./reasoning/phase3.js";
import { config } from "./config.js";
import { flushLangfuse } from "./observability/langfuseClient.js";
import { consumeAdviseRateLimitIfEnabled, quitCliRateLimitRedis } from "./rateLimit/cliAdviseRateLimit.js";
import { isUserAllowedForLlm } from "./reasoning/adviseLlmAccess.js";

// Root CLI: binary name, global description, and --version; subcommands are registered below.
const program = new Command();

program
  .name("advisor")
  .description("Financial Advisor Agent — Phases 1–4 CLI")
  .version("0.1.0");

/** Colors a sentiment label for terminal output: positive in green, negative in red, else yellow. */
function sentimentChalk(s: string): string {
  if (s === "BULLISH" || s === "POSITIVE") return chalk.green(s);
  if (s === "BEARISH" || s === "NEGATIVE") return chalk.red(s);
  return chalk.yellow(s);
}

/** Formats a number as a signed percent string (e.g. `+1.20%`) and colors it green / red / yellow by sign. */
function pct(n: number): string {
  const s = `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  return n > 0 ? chalk.green(s) : n < 0 ? chalk.red(s) : chalk.yellow(s);
}

// Phase 1: print broad market read (indices, optional breadth & FII/DII flows) from `runPhase1()`.
program
  .command("market")
  .description("Show market trend analysis")
  .action(async () => {
    const { marketTrend } = await runPhase1();
    console.log(chalk.bold.cyan(`\nMarket Intelligence — ${marketTrend.asOf}\n`));
    console.log(
      `Overall: ${sentimentChalk(marketTrend.overallSentiment)}  (${pct(
        marketTrend.overallChangePercent
      )})`
    );
    console.log(chalk.gray(marketTrend.narrative));

    const t = new Table({
      head: ["Index", "Change", "Day Sentiment", "7-Day Trend", "Cum %"],
    });
    for (const i of marketTrend.indices) {
      t.push([
        i.name,
        pct(i.changePercent),
        sentimentChalk(i.daySentiment),
        i.sevenDayTrend ?? "—",
        i.sevenDayCumulativePercent !== undefined ? pct(i.sevenDayCumulativePercent) : "—",
      ]);
    }
    console.log(t.toString());

    if (marketTrend.marketBreadth) {
      const b = marketTrend.marketBreadth;
      console.log(
        chalk.gray(
          `Breadth: ${b.advances ?? "—"} advances / ${b.declines ?? "—"} declines ` +
            `(ratio ${b.ratio ?? "—"})${b.sentimentIndicator ? ` • ${b.sentimentIndicator}` : ""}`
        )
      );
    }
    if (marketTrend.flows) {
      const f = marketTrend.flows;
      console.log(
        chalk.gray(
          `Flows: FII ${f.fiiEquityNetCr ?? "—"} Cr, DII ${f.diiEquityNetCr ?? "—"} Cr` +
            (f.observation ? ` — ${f.observation}` : "")
        )
      );
    }
  });

// Phase 1: print sector table (day/weekly %, tags, top gainers/losers); limit rows with --top.
program
  .command("sectors")
  .description("Show sector trend analysis")
  .option("--top <n>", "Show top N sectors by magnitude", "10")
  .action(async (opts: { top: string }) => {
    const { sectorTrends } = await runPhase1();
    const n = Math.max(1, parseInt(opts.top, 10) || 10);
    console.log(chalk.bold.cyan(`\nSector Trends — ${sectorTrends.asOf}\n`));

    const t = new Table({
      head: ["Sector", "Day %", "Sentiment", "Weekly %", "Tags", "Top Gainers", "Top Losers"],
    });
    for (const s of sectorTrends.sectors.slice(0, n)) {
      const tags = [
        s.rateSensitive ? "rate-sensitive" : null,
        s.defensive ? "defensive" : null,
        s.cyclical ? "cyclical" : null,
        s.exportOriented ? "export" : null,
      ]
        .filter(Boolean)
        .join(", ");
      t.push([
        s.sector,
        pct(s.changePercent),
        sentimentChalk(s.sentiment),
        s.weeklyChangePercent !== undefined ? pct(s.weeklyChangePercent) : "—",
        tags || "—",
        s.topGainers.join(", ") || "—",
        s.topLosers.join(", ") || "—",
      ]);
    }
    console.log(t.toString());
  });

// Phase 1: print news index rollups and the five highest-strength headlines.
program
  .command("news")
  .description("Show news index summary")
  .action(async () => {
    const { newsIndex } = await runPhase1();
    console.log(chalk.bold.cyan(`\nNews Feed — ${newsIndex.asOf}  (${newsIndex.total} articles)\n`));

    const counts = new Table({ head: ["Dimension", "Breakdown"] });
    counts.push(
      ["Scope", JSON.stringify(newsIndex.counts.byScope)],
      ["Sentiment", JSON.stringify(newsIndex.counts.bySentiment)],
      ["Impact", JSON.stringify(newsIndex.counts.byImpact)]
    );
    console.log(counts.toString());

    console.log(chalk.bold("\nTop 5 by strength:"));
    const t = new Table({ head: ["#", "ID", "Strength", "Scope", "Sentiment", "Impact", "Headline"] });
    newsIndex.items.slice(0, 5).forEach((n, i) => {
      t.push([
        String(i + 1),
        n.id,
        n.strength.toFixed(2),
        n.scope,
        sentimentChalk(n.sentiment),
        n.impact_level,
        n.headline.slice(0, 70) + (n.headline.length > 70 ? "…" : ""),
      ]);
    });
    console.log(t.toString());
  });

// Phase 1: resolve symbol → sector, then show ranked news buckets (stock / sector / market) via `newsForStock`.
program
  .command("news-for")
  .description("Show ranked news relevant to a stock symbol")
  .argument("<symbol>", "Stock symbol (e.g., HDFCBANK)")
  .action(async (symbol: string) => {
    const [{ market }, { newsIndex }] = await Promise.all([loadAll(), runPhase1()]);
    const sym = symbol.toUpperCase();
    const sector = market.stocks[sym]?.sector;
    if (!sector) {
      console.error(chalk.red(`Stock '${sym}' not found in market_data.json`));
      process.exit(1);
    }
    const linked = newsForStock(newsIndex, sym, sector, 5);
    console.log(chalk.bold.cyan(`\nNews for ${sym}  (sector: ${sector})\n`));
    for (const [label, list] of [
      ["Stock-specific", linked.stock],
      ["Sector-level", linked.sector],
      ["Market-wide", linked.market],
    ] as const) {
      console.log(chalk.bold(`\n${label} (${list.length}):`));
      if (list.length === 0) {
        console.log(chalk.gray("  — none —"));
        continue;
      }
      for (const n of list) {
        console.log(
          `  ${chalk.bold(n.id)} [${sentimentChalk(n.sentiment)}, ${n.impact_level}, str=${n.strength.toFixed(2)}] ${n.headline}`
        );
      }
    }
  });

// List mock portfolio ids with investor name, type, and notional value (no full analytics).
program
  .command("portfolios")
  .description("List available mock portfolio IDs")
  .action(async () => {
    const rows = await listPortfoliosMeta();
    const t = new Table({ head: ["ID", "Investor", "Type", "Value (₹)"] });
    for (const r of rows) {
      t.push([r.id, r.userName, r.portfolioType, r.currentValue.toLocaleString("en-IN")]);
    }
    console.log(t.toString());
  });

// Phase 2: full analytics for one portfolio (P&L, allocation, sector look-through, risk flags); --json for raw object.
program
  .command("portfolio")
  .description("Show Phase 2 portfolio analytics (P&L, allocation, risks)")
  .argument("<id>", "Portfolio id, e.g. PORTFOLIO_001")
  .option("--json", "Print raw JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    const pid = id.toUpperCase();
    const a = await runPhase2(pid);
    if (opts.json) {
      console.log(JSON.stringify(a, null, 2));
      return;
    }
    console.log(chalk.bold.cyan(`\nPortfolio — ${a.profile.userName} (${a.portfolioId})\n`));
    console.log(`Type: ${a.profile.portfolioType}  |  As of: ${a.asOf}`);
    console.log(`Current value: ₹${a.pnl.currentValue.toLocaleString("en-IN")}`);
    const rupee = `₹${a.pnl.dayPnlRupees.toLocaleString("en-IN")}`;
    const pnlCol = a.pnl.dayPnlRupees >= 0 ? chalk.green : chalk.red;
    console.log(`Day P&L: ${pnlCol(rupee)}  (${pct(a.pnl.dayPnlPercent)})\n`);

    const alloc = new Table({ head: ["Slice", "Weight %"] });
    alloc.push(["Direct stocks", a.allocation.assetTypes.DIRECT_STOCKS.toFixed(2)]);
    alloc.push(["Mutual funds (total)", a.allocation.assetTypes.MUTUAL_FUNDS.toFixed(2)]);
    for (const [k, v] of Object.entries(a.allocation.assetTypes.mfByType ?? {})) {
      if (v !== undefined) alloc.push([`  MF: ${k}`, v.toFixed(2)]);
    }
    console.log(chalk.bold("Asset mix"));
    console.log(alloc.toString());

    const sec = new Table({ head: ["Sector (w/ MF look-through)", "Weight %"] });
    for (const [k, v] of Object.entries(a.allocation.sectors.bySectorWithFunds).slice(0, 12)) {
      sec.push([k, v.toFixed(2)]);
    }
    console.log(chalk.bold("\nTop sectors (look-through)"));
    console.log(sec.toString());

    if (a.risks.length > 0) {
      console.log(chalk.bold.yellow("\nRisk flags:"));
      for (const r of a.risks) {
        console.log(`  [${r.severity}] ${r.code}: ${r.message}`);
      }
    } else {
      console.log(chalk.green("\nNo concentration flags."));
    }
  });

// Phase 3: causal briefing for a portfolio (LLM or template), allowlist / rate limit / Langfuse; --json for full payload.
program
  .command("advise")
  .description(
    "Phase 3: causal briefing. Default: Google Gemini when GEMINI_API_KEY is set, else template. Use --llm or --template to force."
  )
  .argument("<id>", "Portfolio id, e.g. PORTFOLIO_002")
  .option("--json", "Print full API JSON")
  .option("--llm", "Force Gemini briefing (errors if GEMINI_API_KEY is missing)")
  .option("--template", "Force rule-based template; ignore API key")
  .option(
    "--as <email>",
    "Who is calling (required when ADVISE_LLM_ALLOWLIST is set; must be one of those emails)"
  )
  .action(
    async (
      id: string,
      opts: { json?: boolean; llm?: boolean; template?: boolean; as?: string }
    ) => {
    if (opts.llm && opts.template) {
      console.error(chalk.red("Use only one of --llm or --template."));
      process.exit(1);
    }
    const mode = opts.llm ? "llm" : opts.template ? "template" : "auto";
    const asFlag = typeof opts.as === "string" ? opts.as.trim() : undefined;
    let userEmail: string | undefined;
    if (config.adviseLlmAllowlist.length > 0) {
      if (!asFlag) {
        console.error(
          chalk.red(
            "You must be an authorised person to execute this command. Please provide your email address."
            // "When ADVISE_LLM_ALLOWLIST is set, you must pass your email on the command line, e.g. npm run cli -- advise PORTFOLIO_002 --as alice@co.com --llm  (use an address that appears in ADVISE_LLM_ALLOWLIST)"
          )
        );
        process.exit(1);
      }
      if (!isUserAllowedForLlm(asFlag, config.adviseLlmAllowlist)) {
        console.error(
          chalk.red(
            `--as ${asFlag} is not in ADVISE_LLM_ALLOWLIST. Only allowlisted users may run advise.`
          )
        );
        process.exit(1);
      }
      userEmail = asFlag;
    } else {
      userEmail = asFlag || config.adviseUserEmail?.trim() || undefined;
    }
    try {
      await consumeAdviseRateLimitIfEnabled();
      const r = await runPhase3(id, { mode, userEmail });
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      const b = r.briefing;
      console.log(chalk.bold.cyan(`\nBriefing — ${r.portfolioId}  (${r.asOf})\n`));
      console.log(
        chalk.gray(
          `Mode: ${r.mode === "llm" ? `Gemini (${r.model ?? "?"})` : "template (rule-based)"}  |  Confidence: ${r.confidence}  |  Signals: ${r.meta.signalCount}  |  Reasoning quality: ${r.reasoningQuality.score} (${r.reasoningQuality.method})`
        )
      );
      if (r.observability?.langfuse) {
        console.log(chalk.gray(`Langfuse trace: ${r.observability.langfuse.traceId}`));
        if (r.observability.langfuse.traceUrl) {
          console.log(chalk.gray(`  ${r.observability.langfuse.traceUrl}`));
        }
      } else if (r.observability?.langfuse === null) {
        console.log(chalk.gray("(Langfuse configured; no LLM trace this run — template mode)"));
      }
      console.log(chalk.bold("\n") + b.headline + "\n");
      console.log(b.summary + "\n");
      console.log(chalk.bold("Why it moved:"));
      console.log(b.why_portfolio_moved + "\n");
      if (b.causal_chains.length > 0) {
        console.log(chalk.bold("Causal links:"));
        b.causal_chains.forEach((c, i) => console.log(`  ${i + 1}. ${c.text}`));
      }
      if (b.conflicts.length > 0) {
        console.log(chalk.bold.yellow("\nConflicts / nuance:"));
        for (const c of b.conflicts) {
          console.log(`  • ${c.description}\n    → ${c.how_to_read_it}`);
        }
      }
      if (b.key_drivers.length > 0) {
        console.log(chalk.bold("\nKey drivers:"));
        b.key_drivers.forEach((k) => console.log(`  - ${k}`));
      }
      if (b.limitations) {
        console.log(chalk.gray(`\nNote: ${b.limitations}`));
      }
    } finally {
      await quitCliRateLimitRedis();
    }
  });

// Parse argv, dispatch the matching subcommand, flush Langfuse traces, then exit 0; on error print message and exit 1.
program
  .parseAsync()
  .then(() => flushLangfuse())
  .catch((err) => {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
