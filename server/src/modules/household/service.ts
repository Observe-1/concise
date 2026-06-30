import type { AppContext } from '../../context.js';
import type {
  CombinedSummaryDto, HistoryDto, HistoryPointDto, HistoryRange, HouseholdStatusDto,
} from '../../types/api.js';
import { rangeStart, todayISO } from '../../lib/dates.js';
import { convertMinor } from '../../lib/fx.js';
import { badRequest, notFound } from '../../lib/http.js';
import { downsample, MAX_GRAPH_POINTS } from '../../lib/series.js';
import { userCurrency } from '../holdings/service.js';
import { totalsAsOf } from '../snapshots/service.js';

interface LinkRow {
  id: number;
  requester_id: number;
  recipient_id: number;
  status: 'pending' | 'accepted';
}

/** A user has at most one active (pending or accepted) link at a time — this
 *  is the actual enforcement point; the migration's unique index only stops a
 *  duplicate of the same pair, not a second link to a different partner. */
function findActiveLink(ctx: AppContext, userId: number): LinkRow | undefined {
  return ctx.db
    .prepare('SELECT * FROM household_links WHERE requester_id = ? OR recipient_id = ?')
    .get(userId, userId) as LinkRow | undefined;
}

function getLinkOrThrow(ctx: AppContext, id: number): LinkRow {
  const row = ctx.db.prepare('SELECT * FROM household_links WHERE id = ?').get(id) as LinkRow | undefined;
  if (!row) throw notFound('Household link not found');
  return row;
}

function usernameOf(ctx: AppContext, userId: number): string {
  const row = ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    | { username: string }
    | undefined;
  return row?.username ?? '';
}

export function getLinkStatus(ctx: AppContext, userId: number): HouseholdStatusDto {
  const link = findActiveLink(ctx, userId);
  if (!link) return { state: 'none', linkId: null, partnerUsername: null };
  const partnerId = link.requester_id === userId ? link.recipient_id : link.requester_id;
  const partnerUsername = usernameOf(ctx, partnerId);
  if (link.status === 'accepted') return { state: 'accepted', linkId: link.id, partnerUsername };
  const state = link.requester_id === userId ? 'pending-sent' : 'pending-received';
  return { state, linkId: link.id, partnerUsername };
}

export function inviteByUsername(ctx: AppContext, requesterId: number, username: string): HouseholdStatusDto {
  const target = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: number }
    | undefined;
  if (!target) throw badRequest('No user with that username');
  if (target.id === requesterId) throw badRequest('You cannot link with yourself');
  if (findActiveLink(ctx, requesterId)) throw badRequest('You already have an active or pending household link');
  if (findActiveLink(ctx, target.id)) throw badRequest('That user already has an active or pending household link');
  ctx.db.prepare('INSERT INTO household_links (requester_id, recipient_id) VALUES (?, ?)').run(requesterId, target.id);
  return getLinkStatus(ctx, requesterId);
}

export function acceptLink(ctx: AppContext, userId: number, id: number): HouseholdStatusDto {
  const link = getLinkOrThrow(ctx, id);
  if (link.recipient_id !== userId) throw notFound('Household link not found');
  ctx.db
    .prepare("UPDATE household_links SET status = 'accepted', responded_at = ? WHERE id = ?")
    .run(ctx.now().toISOString(), id);
  return getLinkStatus(ctx, userId);
}

export function declineLink(ctx: AppContext, userId: number, id: number): void {
  const link = getLinkOrThrow(ctx, id);
  if (link.recipient_id !== userId) throw notFound('Household link not found');
  ctx.db.prepare('DELETE FROM household_links WHERE id = ?').run(id);
}

export function unlink(ctx: AppContext, userId: number, id: number): void {
  const link = getLinkOrThrow(ctx, id);
  if (link.requester_id !== userId && link.recipient_id !== userId) throw notFound('Household link not found');
  ctx.db.prepare('DELETE FROM household_links WHERE id = ?').run(id);
}

/** The viewer's accepted partner, or a 400 if there isn't one. */
function partnerIdOf(ctx: AppContext, viewerId: number): number {
  const link = findActiveLink(ctx, viewerId);
  if (!link || link.status !== 'accepted') throw badRequest('No accepted household link');
  return link.requester_id === viewerId ? link.recipient_id : link.requester_id;
}

/**
 * Combined totals across both members of an accepted link, in the viewer's
 * currency. Only ever reads the partner's aggregate totals (totalsAsOf) —
 * never their individual holding rows — so nothing holding-level can leak
 * into the response.
 */
export async function combinedTotals(ctx: AppContext, viewerId: number): Promise<CombinedSummaryDto> {
  const partnerId = partnerIdOf(ctx, viewerId);
  const currency = userCurrency(ctx, viewerId);
  const partnerCurrency = userCurrency(ctx, partnerId);
  await ctx.prices.primeFxRates([currency, partnerCurrency]);
  const liveRate = (c: string) => ctx.prices.fxRateLive(c);
  const today = todayISO(ctx.now);
  const mine = totalsAsOf(ctx.db, viewerId, today);
  const theirs = totalsAsOf(ctx.db, partnerId, today);
  const assetsMinor = mine.assetsMinor + convertMinor(theirs.assetsMinor, partnerCurrency, currency, liveRate);
  const liabilitiesMinor =
    mine.liabilitiesMinor + convertMinor(theirs.liabilitiesMinor, partnerCurrency, currency, liveRate);
  return { assetsMinor, liabilitiesMinor, netWorthMinor: assetsMinor - liabilitiesMinor, currency };
}

interface SnapRow {
  date: string;
  assets_minor: number;
  liabilities_minor: number;
}

/**
 * Combined daily history, summed from both members' `snapshots` rows (never
 * their holdings). `trendMinor` mirrors `netWorthMinor` — no separate
 * smoothing is computed for the combined series — the dashboard renders this
 * with `showTrend={false}`.
 */
export async function combinedHistory(ctx: AppContext, viewerId: number, range: HistoryRange): Promise<HistoryDto> {
  const partnerId = partnerIdOf(ctx, viewerId);
  const currency = userCurrency(ctx, viewerId);
  const partnerCurrency = userCurrency(ctx, partnerId);
  await ctx.prices.primeFxRates([currency, partnerCurrency]);
  const liveRate = (c: string) => ctx.prices.fxRateLive(c);
  const today = todayISO(ctx.now);
  const start = rangeStart(range, today);

  const mineRows = ctx.db
    .prepare('SELECT snapshot_date AS date, assets_minor, liabilities_minor FROM snapshots WHERE user_id = ? ORDER BY snapshot_date')
    .all(viewerId) as unknown as SnapRow[];
  const theirRows = ctx.db
    .prepare('SELECT snapshot_date AS date, assets_minor, liabilities_minor FROM snapshots WHERE user_id = ? ORDER BY snapshot_date')
    .all(partnerId) as unknown as SnapRow[];
  const theirByDate = new Map(theirRows.map((r) => [r.date, r]));

  const points: HistoryPointDto[] = [];
  for (const mine of mineRows) {
    if (start && mine.date < start) continue;
    const their = theirByDate.get(mine.date);
    const assetsMinor =
      mine.assets_minor + (their ? convertMinor(their.assets_minor, partnerCurrency, currency, liveRate) : 0);
    const liabilitiesMinor =
      mine.liabilities_minor + (their ? convertMinor(their.liabilities_minor, partnerCurrency, currency, liveRate) : 0);
    const netWorthMinor = assetsMinor - liabilitiesMinor;
    points.push({ date: mine.date, assetsMinor, liabilitiesMinor, netWorthMinor, trendMinor: netWorthMinor });
  }
  return { range, trendWindow: 0, points: downsample(points, MAX_GRAPH_POINTS) };
}
