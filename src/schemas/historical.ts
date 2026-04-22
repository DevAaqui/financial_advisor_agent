import { z } from "zod";

export const TrendEnum = z.enum([
  "STRONG_UPTREND",
  "UPTREND",
  "SIDEWAYS",
  "DOWNTREND",
  "STRONG_DOWNTREND",
]);
export type Trend = z.infer<typeof TrendEnum>;

export const IndexHistoryPointSchema = z.object({
  date: z.string(),
  close: z.number(),
  change_percent: z.number(),
});

export const IndexHistorySchema = z.object({
  data: z.array(IndexHistoryPointSchema),
  trend: TrendEnum,
  trend_duration_days: z.number().optional(),
  cumulative_change_percent: z.number().optional(),
  support_level: z.number().optional(),
  resistance_level: z.number().optional(),
});
export type IndexHistory = z.infer<typeof IndexHistorySchema>;

export const SectorWeeklySchema = z.object({
  weekly_change_percent: z.number(),
  trend: TrendEnum,
  catalyst: z.string().optional(),
});

const BreadthBucketSchema = z
  .object({
    advances: z.number().optional(),
    declines: z.number().optional(),
    unchanged: z.number().optional(),
    advance_decline_ratio: z.number().optional(),
  })
  .passthrough();

export const MarketBreadthSchema = z
  .object({
    date: z.string().optional(),
    nifty50: BreadthBucketSchema.optional(),
    nifty500: BreadthBucketSchema.optional(),
    new_52_week_highs: z.number().optional(),
    new_52_week_lows: z.number().optional(),
    sentiment_indicator: z.string().optional(),
  })
  .passthrough();

const FlowBucketSchema = z
  .object({
    buy_value_cr: z.number().optional(),
    sell_value_cr: z.number().optional(),
    net_value_cr: z.number().optional(),
    mtd_net_cr: z.number().optional(),
    ytd_net_cr: z.number().optional(),
  })
  .passthrough();

export const FiiDiiSchema = z
  .object({
    date: z.string().optional(),
    fii: FlowBucketSchema.optional(),
    dii: FlowBucketSchema.optional(),
    observation: z.string().optional(),
  })
  .passthrough();

export const HistoricalDataSchema = z.object({
  metadata: z
    .object({
      description: z.string().optional(),
      period: z.string().optional(),
      end_date: z.string().optional(),
    })
    .optional(),
  index_history: z.record(z.string(), IndexHistorySchema).default({}),
  stock_history: z.record(z.string(), z.any()).default({}),
  sector_weekly_performance: z.record(z.string(), SectorWeeklySchema).default({}),
  market_breadth: MarketBreadthSchema.optional(),
  fii_dii_data: FiiDiiSchema.optional(),
});
export type HistoricalData = z.infer<typeof HistoricalDataSchema>;
