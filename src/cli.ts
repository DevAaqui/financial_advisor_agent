import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { runPhase1 } from "./ingestion/phase1.js";
import { newsForSector, newsForStock } from "./ingestion/newsProcessor.js";
import { loadAll } from "./ingestion/dataLoader.js";

const program = new Command();

program
  .name("advisor")
  .description("Financial Advisor Agent — Phase 1 CLI")
  .version("0.1.0");

function sentimentChalk(s: string): string {
  if (s === "BULLISH" || s === "POSITIVE") return chalk.green(s);
  if (s === "BEARISH" || s === "NEGATIVE") return chalk.red(s);
  return chalk.yellow(s);
}

function pct(n: number): string {
  const s = `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  return n > 0 ? chalk.green(s) : n < 0 ? chalk.red(s) : chalk.yellow(s);
}

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
    void newsForSector;
  });

program.parseAsync().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
