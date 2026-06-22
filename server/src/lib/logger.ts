import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from '../config.js';

export type { Logger } from 'pino';

/**
 * The application logger: structured JSON to stdout, so self-hosters can ship
 * and search it (Docker logs, journald, Loki, …) instead of grepping ad-hoc
 * `console.log` lines. The level is `LOG_LEVEL` (default `info`).
 *
 * Logs carry only operational facts — method, path, status, timing, the
 * authenticated user id, request id — never financial data, passwords or
 * session tokens (cookie/authorization headers are redacted defensively in case
 * a future log line includes request headers). It complements the audit log
 * (security events, persisted) and `/health/detailed` (point-in-time status).
 *
 * In tests the logger is silent unless a capturing `destination` is supplied,
 * keeping test output clean while letting a test assert on emitted lines.
 */
export function createLogger(config: Config, destination?: DestinationStream): Logger {
  const level = config.env === 'test' && !destination ? 'silent' : config.logLevel;
  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    destination,
  );
}
