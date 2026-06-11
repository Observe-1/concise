import type { Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/passwords.js';
import { SimulatedPriceProvider } from '../src/modules/market/provider.js';

export const TEST_HOST = 'concise.test';
export const FIXED_NOW = '2026-06-11T12:00:00.000Z';

export interface TestWorld {
  app: Express;
  ctx: AppContext;
  /** Move the test clock forward by whole days. */
  advanceDays: (days: number) => void;
  setNow: (iso: string) => void;
}

export function makeTestWorld(opts: { env?: 'test' | 'development' | 'production' } = {}): TestWorld {
  let current = new Date(FIXED_NOW);
  const db = openDatabase(':memory:');
  migrate(db);
  const ctx: AppContext = {
    db,
    config: {
      ...loadConfig({}),
      env: opts.env ?? 'test',
      cookieSecure: false,
      dbPath: ':memory:',
      webDistDir: '/nonexistent',
      // 'development' worlds exercise real limits (rate-limit tests)
      loginRateLimit: opts.env === 'development' ? 10 : 1000,
    },
    now: () => current,
    prices: new SimulatedPriceProvider(),
  };
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
