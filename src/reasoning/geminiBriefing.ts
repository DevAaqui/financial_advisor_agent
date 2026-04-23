import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import { BriefingSchema, type Briefing } from "../schemas/briefing.js";
import { logger } from "../observability/logger.js";
import { flushLangfuse, getLangfuseClient } from "../observability/langfuseClient.js";

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
  /** Present when Langfuse keys are configured (Phase 4). */
  langfuseTraceId?: string;
  langfuseTraceUrl?: string;
};

export async function generateBriefingWithGemini(
  context: unknown,
  options: { portfolioId: string }
): Promise<GeminiBriefingBundle> {
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

  const userText =
    "Context JSON follows. Read it and produce the briefing JSON.\n\n" +
    JSON.stringify(context, null, 2).slice(0, 100_000);

  const lf = getLangfuseClient();
  const trace = lf
    ? lf.trace({
        name: "phase3-gemini-briefing",
        userId: options.portfolioId,
        metadata: { portfolioId: options.portfolioId },
        tags: ["phase3", "gemini"],
      })
    : null;

  const generation = trace
    ? trace.generation({
        name: "gemini-generate-briefing",
        model: config.geminiModel,
        modelParameters: { temperature: 0.35, responseMimeType: "application/json" },
        input: { system: SYSTEM, user: userText },
      })
    : null;

  try {
    const result = await model.generateContent(userText);
    const text = result.response.text();
    if (!text) {
      throw new Error("Empty LLM response");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      logger.error({ text: text.slice(0, 500) }, "LLM did not return valid JSON");
      if (generation) {
        generation.end({ output: { error: "invalid_json", sample: text.slice(0, 2000) } });
      }
      throw e;
    }
    const briefing = BriefingSchema.parse(parsed);
    const u = result.response.usageMetadata;
    const usage = u ? { total_tokens: u.totalTokenCount } : undefined;

    if (generation) {
      const usageDetails: Record<string, number> = {};
      if (u) {
        usageDetails.input = u.promptTokenCount;
        usageDetails.output = u.candidatesTokenCount;
        usageDetails.total = u.totalTokenCount;
      }
      generation.end({
        output: briefing,
        usageDetails: Object.keys(usageDetails).length > 0 ? usageDetails : undefined,
      });
    }

    return {
      briefing,
      model: config.geminiModel,
      usage,
      langfuseTraceId: trace?.id,
      langfuseTraceUrl: trace?.getTraceUrl(),
    };
  } catch (e) {
    if (generation) {
      generation.end({
        output: { error: e instanceof Error ? e.message : String(e) },
      });
    }
    throw e;
  } finally {
    if (lf && trace) {
      await flushLangfuse();
    }
  }
}
