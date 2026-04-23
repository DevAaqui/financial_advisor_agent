import { z } from "zod";

export const MutualFundSchemeSchema = z
  .object({
    scheme_code: z.string(),
    scheme_name: z.string().optional(),
    category: z.string().optional(),
    sub_category: z.string().optional(),
    current_nav: z.number().optional(),
    previous_nav: z.number().optional(),
    nav_change: z.number().optional(),
    nav_change_percent: z.number().optional(),
    sector_allocation: z.record(z.string(), z.number()).optional(),
    top_holdings: z
      .array(
        z.object({
          stock: z.string().optional(),
          weight: z.number().optional(),
          sector: z.string().optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export const MutualFundsFileSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  mutual_funds: z.record(z.string(), MutualFundSchemeSchema),
});
export type MutualFundsFile = z.infer<typeof MutualFundsFileSchema>;
export type MutualFundScheme = z.infer<typeof MutualFundSchemeSchema>;
