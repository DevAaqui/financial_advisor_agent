import { z } from "zod";

export const SectorDefinitionSchema = z.object({
  description: z.string().optional(),
  index: z.string().optional(),
  sub_sectors: z.array(z.string()).default([]),
  rate_sensitive: z.boolean().optional(),
  export_oriented: z.boolean().optional(),
  defensive: z.boolean().optional(),
  cyclical: z.boolean().optional(),
  key_metrics: z.array(z.string()).default([]).optional(),
  stocks: z.array(z.string()).default([]),
});
export type SectorDefinition = z.infer<typeof SectorDefinitionSchema>;

export const MacroCorrelationSchema = z.object({
  negative_impact: z.array(z.string()).default([]),
  positive_impact: z.array(z.string()).default([]),
  neutral: z.array(z.string()).default([]),
});
export type MacroCorrelation = z.infer<typeof MacroCorrelationSchema>;

export const SectorMappingSchema = z.object({
  metadata: z
    .object({
      description: z.string().optional(),
      last_updated: z.string().optional(),
    })
    .optional(),
  sectors: z.record(z.string(), SectorDefinitionSchema),
  macro_correlations: z.record(z.string(), MacroCorrelationSchema).default({}),
  defensive_sectors: z.array(z.string()).default([]),
  cyclical_sectors: z.array(z.string()).default([]),
  rate_sensitive_sectors: z.array(z.string()).default([]),
  export_oriented_sectors: z.array(z.string()).default([]),
});
export type SectorMapping = z.infer<typeof SectorMappingSchema>;
