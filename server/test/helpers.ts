import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createLogger, type Logger } from '../src/lib/logger.js';
import { hashPassword } from '../src/lib/passwords.js';
import { SimulatedPriceProvider } from '../src/modules/market/provider.js';
import { hydrateDiscoveredInstruments } from '../src/modules/market/service.js';

export const TEST_HOST = 'concise.test';
export const FIXED_NOW = '2026-06-11T12:00:00.000Z';

export interface TestWorld {
  app: Express;
  ctx: AppContext;
  /** Move the test clock forward by whole days. */
  advanceDays: (days: number) => void;
  setNow: (iso: string) => void;
}

export function makeTestWorld(
  opts: {
    env?: 'test' | 'development' | 'production';
    dbPath?: string;
    backupDir?: string;
    /** Inject a capturing logger to assert on emitted log lines; defaults to a
     *  silent one so normal test runs stay quiet. */
    logger?: Logger;
    /**
     * Override the session TTL used to compute `expires_at` (app-side) and
     * the cookie's `Expires` attribute (HTTP-client-side). Defaults to ~10
     * years: the cookie's `Expires` is calculated from `FIXED_NOW`, a fixed
     * point in the past, but supertest's cookie jar evaluates `Expires`
     * against the REAL wall clock — with the production default (14 days),
     * once enough real calendar time passes since `FIXED_NOW` the jar starts
     * silently dropping "expired" cookies, failing every test that makes a
     * second request with a logged-in agent. A long default sidesteps that;
     * pass a short value (as the "expires after the TTL" test does) to
     * exercise real expiry behaviour deliberately.
     */
    sessionTtlHours?: number;
    /**
     * Forced to false by default: tests run over plain HTTP via supertest, and
     * cookieSecure also gates helmet's HSTS/upgrade-insecure-requests headers
     * (see app.ts) — those assume HTTPS and break asset loading otherwise.
     * Pass true to test the HTTPS-deployment behaviour specifically.
     */
    cookieSecure?: boolean;
  } = {},
): TestWorld {
  let current = new Date(FIXED_NOW);
  const dbPath = opts.dbPath ?? ':memory:';
  const db = openDatabase(dbPath);
  migrate(db);
  const config = {
    ...loadConfig({}),
    env: opts.env ?? 'test',
    cookieSecure: opts.cookieSecure ?? false,
    dbPath,
    backupDir: opts.backupDir
      ?? path.join(dbPath === ':memory:' ? '.' : path.dirname(dbPath), 'backups'),
    webDistDir: '/nonexistent',
    // 'development' worlds exercise real limits (rate-limit tests)
    loginRateLimit: opts.env === 'development' ? 10 : 1000,
    sessionTtlHours: opts.sessionTtlHours ?? 24 * 365 * 10,
  };
  const ctx: AppContext = {
    db,
    config,
    now: () => current,
    prices: new SimulatedPriceProvider(),
    log: opts.logger ?? createLogger(config),
  };
  hydrateDiscoveredInstruments(ctx);
  return {
    app: buildApp(ctx),
    ctx,
    advanceDays: (days) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
    setNow: (iso) => {
      current = new Date(iso);
    },
  };
}

export function createUser(ctx: AppContext, username: string, password: string): number {
  const id = ctx.db
    .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .run(username.toLowerCase(), hashPassword(password), username).lastInsertRowid as number;
  ctx.db.prepare('INSERT INTO settings (user_id, currency) VALUES (?, ?)').run(id, 'USD');
  return id;
}

/** Add same-origin headers so mutating requests pass the CSRF origin check. */
export function csrf<T extends request.Test>(req: T): T {
  return req.set('Host', TEST_HOST).set('Origin', `http://${TEST_HOST}`) as T;
}

/** Logged-in supertest agent (cookie jar holds the session). */
export async function loginAgent(
  app: Express,
  username = 'alice',
  password = 'password123',
): Promise<InstanceType<typeof TestAgent>> {
  const agent = request.agent(app);
  const res = await csrf(agent.post('/api/auth/login')).send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
