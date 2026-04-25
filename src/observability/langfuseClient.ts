import { Langfuse } from "langfuse";
import { config } from "../config.js";

let client: Langfuse | null = null;

/**
 * Singleton Langfuse SDK client, or `null` if `LANGFUSE_*` keys are not both set.
 * Safe to call repeatedly; instantiates once on first use when enabled.
 */
export function getLangfuseClient(): Langfuse | null {
  if (client) return client;
  if (!config.langfuseEnabled) {
    return null;
  }
  client = new Langfuse({
    publicKey: config.langfusePublicKey,
    secretKey: config.langfuseSecretKey,
    baseUrl: config.langfuseBaseUrl,
  });
  return client;
}

/** Await delivery of buffered traces/scores to Langfuse (no-op if client is disabled). */
export async function flushLangfuse(): Promise<void> {
  const c = getLangfuseClient();
  if (c) {
    await c.flushAsync();
  }
}
