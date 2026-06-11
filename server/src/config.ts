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
  /** Background job tick interval (ms). Short in e2e, 60s in production. */
  jobTickMs: number;
  /** Max login attempts per IP per 15 minutes. */
  loginRateLimit: number;
  /** Run the seed script at startup (resets the demo account). */
  seedOnStart: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV === 'production' ? 'production'
    : env.NODE_ENV === 'test' ? 'test'
    : 'development';
  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? path.resolve(process.cwd(), '../data/concise.db'),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 24 * 14),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production',
    trustedOrigins: (env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: Number(env.TRUST_PROXY ?? 0),
    webDistDir: env.WEB_DIST_DIR ?? path.resolve(process.cwd(), '../web/dist'),
    jobTickMs: Number(env.JOB_TICK_MS ?? 60_000),
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT ?? 10),
    seedOnStart: env.SEED_ON_START === '1',
  };
}
