import path from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  dbPath: string;
  sessionTtlHours: number;
  /** Set Secure flag on session cookies (required in production over HTTPS). */
  cookieSecure: boolean;
  /**
   * Origins trusted by the CSRF check beyond same-origin (comma-separated
   * TRUSTED_ORIGINS, e.g. "https://app.example.com"). Loopback origins are
   * always trusted outside production for the Vite dev proxy.
   */
  trustedOrigins: string[];
  /**
   * Express trust-proxy setting. Behind a reverse proxy set TRUST_PROXY=1 so
   * req.ip (rate limiting, audit log) reflects the real client address.
   */
  trustProxy: number;
  /** Directory of built frontend to serve statically, if present. */
  webDistDir: string;
  /**
   * Directory database backups are written to. Defaults to a `backups/` folder
   * next to the database file so it lives on the same persistent volume. See
   * BACKUP.md.
   */
  backupDir: string;
  /** Background job tick interval (ms). Short in e2e, 60s in production. */
  jobTickMs: number;
  /** Max login attempts per IP per 15 minutes. */
  loginRateLimit: number;
  /** Max API requests per IP per minute. */
  apiRateLimit: number;
  /** Run the seed script at startup (resets the demo account). */
  seedOnStart: boolean;
  /**
   * Price source: 'real' fetches live quotes from Yahoo Finance (no API key);
   * 'simulated' uses the deterministic offline simulation. Defaults to 'real'
   * so symbol prices match the market; set PRICE_PROVIDER=simulated to opt out
   * (e.g. for an air-gapped deployment).
   */
  priceProvider: 'real' | 'simulated';
  /**
   * Logging verbosity (pino level): fatal | error | warn | info | debug | trace
   * | silent. Defaults to `info`; an unrecognised LOG_LEVEL falls back to it.
   */
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production'
    : env.NODE_ENV === 'test' ? 'test'
    : 'development';
  const dbPath = env.DB_PATH ?? path.resolve(process.cwd(), '../data/concise.db');
  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    dbPath,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production',
    trustedOrigins: (env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: Number(env.TRUST_PROXY ?? 0),
    webDistDir: env.WEB_DIST_DIR ?? path.resolve(process.cwd(), '../web/dist'),
    backupDir: env.BACKUP_DIR
      ?? (dbPath === ':memory:'
        ? path.resolve(process.cwd(), '../data/backups')
        : path.join(path.dirname(dbPath), 'backups')),
    jobTickMs: Number(env.JOB_TICK_MS ?? 60_000),
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 10),
    apiRateLimit: Number(env.API_RATE_LIMIT ?? 300),
    seedOnStart: env.SEED_ON_START === '1',
    priceProvider: env.PRICE_PROVIDER === 'simulated' ? 'simulated' : 'real',
    logLevel: (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL ?? '')
      ? (env.LOG_LEVEL as LogLevel)
      : 'info',
  };
}
