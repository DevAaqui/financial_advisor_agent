import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function parseEnvBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATA_DIR: z.string().default("../"),
  /** Required for LLM-generated briefings (Phase 3) via Google Gemini. If unset, a deterministic template is used. */
  GEMINI_API_KEY: z.string().optional(),
  /** Default avoids gemini-2.0-flash (unavailable to new API keys). Override if your project uses another ID. */
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  /** Phase 4 — Langfuse (optional; LLM traces are only sent when set) */
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),
  /** CLI `advise` — apply Redis-backed rate limit (default: off so Redis is not required) */
  RATE_LIMIT_CLI_ENABLED: z
    .string()
    .optional()
    .transform((s) => parseEnvBool(s, false)),
  RATE_LIMIT_REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  RATE_LIMIT_CLI_POINTS: z.preprocess(
    (v) => (v == null || v === "" ? "30" : v),
    z.coerce.number().int().positive()
  ),
  RATE_LIMIT_CLI_DURATION_SEC: z.preprocess(
    (v) => (v == null || v === "" ? "3600" : v),
    z.coerce.number().int().positive()
  ),
  /** Bucket key; defaults to OS username. Use one value per real user if you share a machine. */
  RATE_LIMIT_CLI_USER_KEY: z.string().optional(),
  /**
   * Comma/semicolon-separated allowlist (case-insensitive). Empty = no restriction.
   * When non-empty: the `advise` **CLI** must pass `--as <email>` on that list; Gemini in `runPhase3` is also limited to the same list.
   */
  ADVISE_LLM_ALLOWLIST: z
    .string()
    .optional()
    .transform((s) => {
      if (!s?.trim()) return [] as string[];
      return [
        ...new Set(
          s
            .split(/[,;\n]+/)
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
    }),
  /**
   * Default identity for `advise` when `ADVISE_LLM_ALLOWLIST` is **empty** (CLI: same as `--as`; API: fallback if no header/query). When the allowlist is set, use `--as` on the CLI instead.
   */
  ADVISE_USER_EMAIL: z.string().optional(),
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
  rateLimitCliEnabled: parsed.RATE_LIMIT_CLI_ENABLED,
  rateLimitRedisUrl: parsed.RATE_LIMIT_REDIS_URL,
  rateLimitCliPoints: parsed.RATE_LIMIT_CLI_POINTS,
  rateLimitCliDurationSec: parsed.RATE_LIMIT_CLI_DURATION_SEC,
  rateLimitCliUserKey: parsed.RATE_LIMIT_CLI_USER_KEY,
  adviseLlmAllowlist: parsed.ADVISE_LLM_ALLOWLIST,
  adviseUserEmail: parsed.ADVISE_USER_EMAIL,
} as const;
