import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import type { PriceProvider } from './modules/market/provider.js';

/**
 * Everything the app needs from the outside world, injected so tests can
 * supply an in-memory database, a fixed clock, and a deterministic price
 * provider.
 */
export interface AppContext {
  db: DatabaseSync;
  config: Config;
  now: () => Date;
  prices: PriceProvider;
}
