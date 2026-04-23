import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../observability/logger.js";
import {
  MarketDataSchema,
  NewsDataSchema,
  SectorMappingSchema,
  HistoricalDataSchema,
  PortfoliosFileSchema,
  MutualFundsFileSchema,
  type MarketData,
  type NewsData,
  type SectorMapping,
  type HistoricalData,
  type PortfoliosFile,
  type MutualFundsFile,
} from "../schemas/index.js";

type Loaded = {
  market: MarketData;
  news: NewsData;
  sectorMap: SectorMapping;
  history: HistoricalData;
  portfoliosFile: PortfoliosFile;
  mutualFundsFile: MutualFundsFile;
  loadedAt: string;
};

let cache: Loaded | null = null;

async function readJson<T>(relFile: string, parser: (v: unknown) => T): Promise<T> {
  const abs = path.join(config.dataDir, relFile);
  logger.debug({ abs }, `loading ${relFile}`);
  const raw = await fs.readFile(abs, "utf-8");
  const json = JSON.parse(raw);
  return parser(json);
}

export async function loadAll(force = false): Promise<Loaded> {
  if (cache && !force) return cache;

  const [market, news, sectorMap, history, portfoliosFile, mutualFundsFile] = await Promise.all([
    readJson("market_data.json", (v) => MarketDataSchema.parse(v)),
    readJson("news_data.json", (v) => NewsDataSchema.parse(v)),
    readJson("sector_mapping.json", (v) => SectorMappingSchema.parse(v)),
    readJson("historical_data.json", (v) => HistoricalDataSchema.parse(v)),
    readJson("portfolios.json", (v) => PortfoliosFileSchema.parse(v)),
    readJson("mutual_funds.json", (v) => MutualFundsFileSchema.parse(v)),
  ]);

  cache = {
    market,
    news,
    sectorMap,
    history,
    portfoliosFile,
    mutualFundsFile,
    loadedAt: new Date().toISOString(),
  };

  logger.info(
    {
      dataDir: config.dataDir,
      indices: Object.keys(market.indices).length,
      sectors: Object.keys(market.sector_performance).length,
      stocks: Object.keys(market.stocks).length,
      news: news.news.length,
      portfolioIds: Object.keys(portfoliosFile.portfolios).length,
      mutualFundSchemes: Object.keys(mutualFundsFile.mutual_funds).length,
    },
    "Data loaded"
  );

  return cache;
}

export function invalidateCache(): void {
  cache = null;
}
