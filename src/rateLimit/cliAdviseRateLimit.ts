import { userInfo } from "node:os";
import { Redis } from "ioredis";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { config } from "../config.js";

let redisClient: Redis | null = null;
let limiter: RateLimiterRedis | null = null;

export function getEffectiveRateLimitUserKey(): string {
  const k = config.rateLimitCliUserKey?.trim();
  if (k) return k;
  try {
    return userInfo().username || "user";
  } catch {
    return "user";
  }
}

function getOrCreateLimiter(): RateLimiterRedis {
  if (limiter) return limiter;
  redisClient = new Redis(config.rateLimitRedisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
  });
  limiter = new RateLimiterRedis({
    storeClient: redisClient,
    useRedisPackage: true,
    keyPrefix: "rl:cli:advise",
    points: config.rateLimitCliPoints,
    duration: config.rateLimitCliDurationSec,
  });
  return limiter;
}

/**
 * Enforce Redis rate limit for the `advise` CLI (no-op if disabled in config).
 */
export async function consumeAdviseRateLimitIfEnabled(): Promise<void> {
  if (!config.rateLimitCliEnabled) return;
  const key = getEffectiveRateLimitUserKey();
  const l = getOrCreateLimiter();
  try {
    await l.consume(key, 1);
  } catch (e) {
    if (e instanceof RateLimiterRes) {
      const waitSec = Math.max(1, Math.ceil(e.msBeforeNext / 1000));
      throw new Error(
        `Rate limit exceeded: max ${config.rateLimitCliPoints} \`advise\` runs per ` +
          `${config.rateLimitCliDurationSec}s for RATE_LIMIT_CLI_USER_KEY="${key}". ` +
          `Try again in ~${waitSec}s.`
      );
    }
    throw e;
  }
}

export async function quitCliRateLimitRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    limiter = null;
  }
}
