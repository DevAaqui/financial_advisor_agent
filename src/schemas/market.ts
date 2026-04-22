import { z } from "zod";

export const SentimentEnum = z.enum(["BULLISH", "BEARISH", "NEUTRAL"]);
export type Sentiment = z.infer<typeof SentimentEnum>;

export const IndexSchema = z.object({
  name: z.string(),
  current_value: z.number(),
  previous_close: z.number(),
  change_percent: z.number(),
  change_absolute: z.number(),
  day_high: z.number().optional(),
  day_low: z.number().optional(),
  "52_week_high": z.number().optional(),
  "52_week_low": z.number().optional(),
  sentiment: SentimentEnum.optional(),
});
export type IndexQuote = z.infer<typeof IndexSchema>;

export const SectorPerformanceSchema = z.object({
  change_percent: z.number(),
  sentiment: SentimentEnum,
  key_drivers: z.array(z.string()).default([]),
  top_gainers: z.array(z.string()).default([]),
  top_losers: z.array(z.string()).default([]),
});
export type SectorPerformance = z.infer<typeof SectorPerformanceSchema>;

export const StockSchema = z.object({
  name: z.string(),
  sector: z.string(),
  sub_sector: z.string().optional(),
  current_price: z.number(),
  previous_close: z.number(),
  change_percent: z.number(),
  change_absolute: z.number().optional(),
  volume: z.number().optional(),
  avg_volume_20d: z.number().optional(),
  market_cap_cr: z.number().optional(),
  pe_ratio: z.number().optional(),
  "52_week_high": z.number().optional(),
});
export type Stock = z.infer<typeof StockSchema>;

export const MarketDataSchema = z.object({
  metadata: z.object({
    date: z.string(),
    data_source: z.string().optional(),
    currency: z.string().optional(),
    market_status: z.string().optional(),
  }),
  indices: z.record(z.string(), IndexSchema),
  sector_performance: z.record(z.string(), SectorPerformanceSchema),
  stocks: z.record(z.string(), StockSchema),
});
export type MarketData = z.infer<typeof MarketDataSchema>;
