import path from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  dbPath: string;
  sessionTtlHours: number;
  /** Set Secure flag on session cookies (required in production over HTTPS). */
  cookieSecure: boolean;
  /**
   * Express trust-proxy setting. Behind a reverse proxy set TRUST_PROXY=1 so
   * req.ip (rate limiting, audit log) reflects the real client address.
   */
  trustProxy: number;
  /** Directory of built frontend to serve statically, if present. */
  webDistDir: string;
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
    trustProxy: Number(env.TRUST_PROXY ?? 0),
    webDistDir: env.WEB_DIST_DIR ?? path.resolve(process.cwd(), '../web/dist'),
  };
}
