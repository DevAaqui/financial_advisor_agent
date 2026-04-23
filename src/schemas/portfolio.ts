import { z } from "zod";

/** Stock line in portfolios.json */
export const StockHoldingSchema = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  sector: z.string(),
  quantity: z.number(),
  avg_buy_price: z.number(),
  current_price: z.number(),
  investment_value: z.number().optional(),
  current_value: z.number(),
  gain_loss: z.number().optional(),
  gain_loss_percent: z.number().optional(),
  day_change: z.number(),
  day_change_percent: z.number(),
  weight_in_portfolio: z.number(),
});
export type StockHolding = z.infer<typeof StockHoldingSchema>;

/** MF line — `current_price` appears in one mock row as a typo for `current_nav`. */
export const MFHoldingSchema = z
  .object({
    scheme_code: z.string(),
    scheme_name: z.string().optional(),
    category: z.string(),
    amc: z.string().optional(),
    units: z.number(),
    avg_nav: z.number(),
    current_nav: z.number().optional(),
    current_price: z.number().optional(),
    investment_value: z.number().optional(),
    current_value: z.number(),
    gain_loss: z.number().optional(),
    gain_loss_percent: z.number().optional(),
    day_change: z.number(),
    day_change_percent: z.number(),
    weight_in_portfolio: z.number(),
    top_holdings: z.array(z.string()).optional(),
  })
  .passthrough();
export type MFHolding = z.infer<typeof MFHoldingSchema>;

export const HoldingsBlockSchema = z.object({
  stocks: z.array(StockHoldingSchema),
  mutual_funds: z.array(MFHoldingSchema),
});

export const PortfolioRecordSchema = z
  .object({
    user_id: z.string().optional(),
    user_name: z.string(),
    portfolio_type: z.string(),
    risk_profile: z.string().optional(),
    investment_horizon: z.string().optional(),
    description: z.string().optional(),
    total_investment: z.number().optional(),
    current_value: z.number(),
    overall_gain_loss: z.number().optional(),
    overall_gain_loss_percent: z.number().optional(),
    holdings: HoldingsBlockSchema,
    analytics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const PortfoliosFileSchema = z.object({
  metadata: z
    .object({
      date: z.string().optional(),
      data_source: z.string().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  portfolios: z.record(z.string(), PortfolioRecordSchema),
});
export type PortfoliosFile = z.infer<typeof PortfoliosFileSchema>;
export type PortfolioRecord = z.infer<typeof PortfolioRecordSchema>;
