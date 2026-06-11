import { createHash, randomBytes } from 'node:crypto';
import type { AppContext } from '../../context.js';
import type { SessionUser } from '../../types/api.js';
import { verifyPassword } from '../../lib/passwords.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface LoginResult {
  user: SessionUser;
  token: string;
  expiresAt: string;
}

export function login(ctx: AppContext, username: string, password: string): LoginResult | null {
  const row = ctx.db
    .prepare(
      `SELECT u.id, u.username, u.password_hash, u.display_name, COALESCE(s.currency, 'USD') AS currency
       FROM users u LEFT JOIN settings s ON s.user_id = u.id
       WHERE u.username = ?`,
    )
    .get(username.toLowerCase()) as
    | { id: number; username: string; password_hash: string; display_name: string; currency: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(ctx.now().getTime() + ctx.config.sessionTtlHours * 3_600_000).toISOString();
  ctx.db
    .prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(row.id, hashToken(token), expiresAt);
  return {
    token,
    expiresAt,
    user: { id: row.id, username: row.username, displayName: row.display_name, currency: row.currency },
  };
}

export function logout(ctx: AppContext, token: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Resolve a session token to its user; slides expiry when past halfway. */
export function resolveSession(ctx: AppContext, token: string): SessionUser | null {
  const nowIso = ctx.now().toISOString();
  const row = ctx.db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.display_name,
              COALESCE(st.currency, 'USD') AS currency
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN settings st ON st.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), nowIso) as
    | { session_id: number; expires_at: string; id: number; username: string; display_name: string; currency: string }
    | undefined;
  if (!row) return null;

  const ttlMs = ctx.config.sessionTtlHours * 3_600_000;
  const remaining = Date.parse(row.expires_at) - ctx.now().getTime();
  if (remaining < ttlMs / 2) {
    ctx.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run(new Date(ctx.now().getTime() + ttlMs).toISOString(), row.session_id);
  }
  return { id: row.id, username: row.username, displayName: row.display_name, currency: row.currency };
}

export function purgeExpiredSessions(ctx: AppContext): void {
  ctx.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(ctx.now().toISOString());
}
