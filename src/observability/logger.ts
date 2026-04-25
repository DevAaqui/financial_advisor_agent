import pino from "pino";
import { config } from "../config.js";

/**
 * Application logger: level from `LOG_LEVEL`; in non-production, pretty-prints to stdout.
 */
export const logger = pino({
  level: config.logLevel,
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
        },
});
