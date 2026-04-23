import { Langfuse } from "langfuse";
import { config } from "../config.js";

let client: Langfuse | null = null;

/** Langfuse is optional: enabled only when public + secret keys are set. */
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

export async function flushLangfuse(): Promise<void> {
  const c = getLangfuseClient();
  if (c) {
    await c.flushAsync();
  }
}
