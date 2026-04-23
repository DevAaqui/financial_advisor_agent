import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATA_DIR: z.string().default("../"),
  /** Required for LLM-generated briefings (Phase 3) via Google Gemini. If unset, a deterministic template is used. */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  /** Phase 4 — Langfuse (optional; LLM traces are only sent when set) */
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),
});

const parsed = EnvSchema.parse(process.env);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve DATA_DIR relative to the project root (one level above src/).
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.isAbsolute(parsed.DATA_DIR)
  ? parsed.DATA_DIR
  : path.resolve(projectRoot, parsed.DATA_DIR);

const langfusePublicKey = parsed.LANGFUSE_PUBLIC_KEY;
const langfuseSecretKey = parsed.LANGFUSE_SECRET_KEY;

export const config = {
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  dataDir,
  projectRoot,
  geminiApiKey: parsed.GEMINI_API_KEY,
  geminiModel: parsed.GEMINI_MODEL,
  langfusePublicKey,
  langfuseSecretKey,
  langfuseBaseUrl: parsed.LANGFUSE_BASE_URL,
  langfuseEnabled: Boolean(langfusePublicKey && langfuseSecretKey),
} as const;
