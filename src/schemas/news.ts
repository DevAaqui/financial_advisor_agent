import { z } from "zod";

export const NewsSentimentEnum = z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED"]);
export type NewsSentiment = z.infer<typeof NewsSentimentEnum>;

export const NewsScopeEnum = z.enum(["MARKET_WIDE", "SECTOR_SPECIFIC", "STOCK_SPECIFIC"]);
export type NewsScope = z.infer<typeof NewsScopeEnum>;

export const ImpactLevelEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type ImpactLevel = z.infer<typeof ImpactLevelEnum>;

export const NewsEntitiesSchema = z.object({
  sectors: z.array(z.string()).default([]),
  stocks: z.array(z.string()).default([]),
  indices: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export const NewsItemSchema = z.object({
  id: z.string(),
  headline: z.string(),
  summary: z.string().default(""),
  published_at: z.string().optional(),
  source: z.string().optional(),
  sentiment: NewsSentimentEnum,
  sentiment_score: z.number().optional(),
  scope: NewsScopeEnum,
  impact_level: ImpactLevelEnum,
  entities: NewsEntitiesSchema,
  causal_factors: z.array(z.string()).default([]),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const NewsDataSchema = z.object({
  metadata: z
    .object({
      date: z.string().optional(),
      data_source: z.string().optional(),
      total_articles: z.number().optional(),
    })
    .optional(),
  news: z.array(NewsItemSchema),
});
export type NewsData = z.infer<typeof NewsDataSchema>;
