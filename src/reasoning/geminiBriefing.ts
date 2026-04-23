import { GoogleGenerativeAI } from "@google/generative-ai";
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

export type GeminiBriefingBundle = {
  briefing: Briefing;
  model: string;
  usage?: { total_tokens?: number };
};

export async function generateBriefingWithGemini(context: unknown): Promise<GeminiBriefingBundle> {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: SYSTEM,
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
    },
  });

  console.log("model EXECUTING>>>>>>>>>>>>>>>>>>>>>>>>>");

  const userText =
    "Context JSON follows. Read it and produce the briefing JSON.\n\n" +
    JSON.stringify(context, null, 2).slice(0, 100_000);

  const result = await model.generateContent(userText);
  const text = result.response.text();
  console.log("TEXT>>>>>>>>>>>>>>>>>>>>>>>>>", text);
  if (!text) {
    console.log("EMPTY LLM RESPONSE>>>>>>>>>>>>>>>>>>>>>>>>>");
    throw new Error("Empty LLM response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.log("ERROR PARSING JSON>>>>>>>>>>>>>>>>>>>>>>>>>", e);
    logger.error({ text: text.slice(0, 500) }, "LLM did not return valid JSON");
    throw e;
  }
  const briefing = BriefingSchema.parse(parsed);
  const u = result.response.usageMetadata;
  return {
    briefing,
    model: config.geminiModel,
    usage: u ? { total_tokens: u.totalTokenCount } : undefined,
  };
}
