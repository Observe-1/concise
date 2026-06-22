import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import type { Logger } from './lib/logger.js';
import type { PriceProvider } from './modules/market/provider.js';

/**
 * Everything the app needs from the outside world, injected so tests can
 * supply an in-memory database, a fixed clock, a deterministic price provider,
 * and a silent (or capturing) logger.
 */
export interface AppContext {
  db: DatabaseSync;
  config: Config;
  now: () => Date;
  prices: PriceProvider;
  /** Structured application logger (pino). Per-request child loggers carrying a
   *  request id hang off `req.log`; see middleware/requestLogger.ts. */
  log: Logger;
}
