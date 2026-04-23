import OpenAI from "openai";
import { config } from "../config.js";
import { BriefingSchema, type Briefing } from "../schemas/briefing.js";
import { logger } from "../observability/logger.js";

const SYSTEM = `You are a senior India markets portfolio analyst writing a client briefing.
Rules:
- Use ONLY the provided JSON context. Do not invent tickers, numbers, or news.
- Link Macro News → Sector move → Stock/MF impact → Portfolio P&L where data allows.
- In conflicts, explain ambiguity (e.g. positive news but stock down: sector/flows/rates may dominate).
- Be concise: summary under 200 words unless context demands more.
- Output a single JSON object with keys: headline, summary, why_portfolio_moved, causal_chains, conflicts, key_drivers, limitations.
- causal_chains: array of { "text": string, "news_ids": string[] }
- conflicts: array of { "description": string, "how_to_read_it": string }
- key_drivers: string array, max 5 bullets.
- limitations: when data is thin or MF look-through is approximate.`;

export type LlmBundle = { briefing: Briefing; model: string; usage?: { total_tokens?: number } };

export async function generateBriefingWithLlm(context: unknown): Promise<LlmBundle> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    response_format: { type: "json_object" },
    temperature: 0.35,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          "Context JSON follows. Read it and produce the briefing JSON.\n\n" +
          JSON.stringify(context, null, 2).slice(0, 100_000),
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Empty LLM response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    logger.error({ text: text.slice(0, 500) }, "LLM did not return valid JSON");
    throw e;
  }
  const briefing = BriefingSchema.parse(parsed);
  return {
    briefing,
    model: config.openaiModel,
    usage: completion.usage ? { total_tokens: completion.usage.total_tokens } : undefined,
  };
}
