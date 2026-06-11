import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import { hashPassword } from '../lib/passwords.js';
import { addDays, toDateISO } from '../lib/dates.js';
import { hashString, mulberry32 } from '../lib/rng.js';
import { SimulatedPriceProvider, holdingValueMinor } from '../modules/market/provider.js';

const HISTORY_DAYS = 730;
const POINT_EVERY_DAYS = 7;

interface SeriesPoint { date: string; valueMinor: number }

/** Linear ramp from start to end with deterministic noise; last point is exact. */
function genSeries(
  key: string,
  startMinor: number,
  endMinor: number,
  todayIso: string,
  volatility: number,
): SeriesPoint[] {
  const rand = mulberry32(hashString(key));
  const points: SeriesPoint[] = [];
  const steps = Math.floor(HISTORY_DAYS / POINT_EVERY_DAYS);
  for (let i = 0; i <= steps; i++) {
    const date = addDays(todayIso, -(steps - i) * POINT_EVERY_DAYS);
    const progress = i / steps;
    const base = startMinor + (endMinor - startMinor) * progress;
    const noise = i === steps ? 0 : (rand() - 0.5) * 2 * volatility;
    points.push({ date, valueMinor: Math.max(0, Math.round(base * (1 + noise))) });
  }
  return points;
}

function marketSeries(symbol: string, quantity: number, todayIso: string): SeriesPoint[] {
  const prices = new SimulatedPriceProvider();
  const points: SeriesPoint[] = [];
  const steps = Math.floor(HISTORY_DAYS / POINT_EVERY_DAYS);
  for (let i = 0; i <= steps; i++) {
    const date = addDays(todayIso, -(steps - i) * POINT_EVERY_DAYS);
    points.push({ date, valueMinor: holdingValueMinor(prices.getPriceMinor(symbol, date), quantity) });
  }
  return points;
}

interface SeedEntry {
  table: 'assets' | 'liabilities';
  category: string;
  name: string;
  notes?: string;
  series: SeriesPoint[];
  market?: { symbol: string; quantity: number };
}

function nextDayOfMonth(todayIso: string, day: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  let date = new Date(Date.UTC(y!, m! - 1, day));
  if (d! >= day) date = new Date(Date.UTC(y!, m!, day));
  return toDateISO(date);
}

/**
 * Create (or reset) the demo account with a sample portfolio and two years of
 * backdated history. Deterministic for a given `now`.
 */
export function seed(db: DatabaseSync, now: () => Date = () => new Date()): void {
  const todayIso = toDateISO(now());

  const entries: SeedEntry[] = [
    { table: 'assets', category: 'cash', name: 'Checking account',
      series: genSeries('demo:checking', 310_000, 425_000, todayIso, 0.18) },
    { table: 'assets', category: 'cash', name: 'Savings',
      series: genSeries('demo:savings', 600_000, 1_800_000, todayIso, 0.03) },
    { table: 'assets', category: 'investments', name: 'Global index fund',
      market: { symbol: 'VWRL', quantity: 120 },
      series: marketSeries('VWRL', 120, todayIso) },
    { table: 'assets', category: 'investments', name: 'Pension',
      series: genSeries('demo:pension', 2_800_000, 4_200_000, todayIso, 0.04) },
    { table: 'assets', category: 'property', name: 'Home',
      notes: 'Primary residence', series: genSeries('demo:home', 35_000_000, 38_500_000, todayIso, 0.01) },
    { table: 'assets', category: 'vehicles', name: 'Car',
      series: genSeries('demo:car', 1_900_000, 1_250_000, todayIso, 0.02) },
    { table: 'assets', category: 'crypto', name: 'Bitcoin',
      market: { symbol: 'BTC', quantity: 0.15 },
      series: marketSeries('BTC', 0.15, todayIso) },
    { table: 'liabilities', category: 'mortgage', name: 'Home mortgage',
      series: genSeries('demo:mortgage', 27_600_000, 24_800_000, todayIso, 0.001) },
    { table: 'liabilities', category: 'loan', name: 'Car loan',
      series: genSeries('demo:carloan', 1_400_000, 780_000, todayIso, 0.001) },
    { table: 'liabilities', category: 'credit_card', name: 'Credit card',
      series: genSeries('demo:cc', 120_000, 95_000, todayIso, 0.45) },
  ];

  withTransaction(db, () => {
    // Reset any previous demo account so seeding is repeatable.
    db.prepare('DELETE FROM users WHERE username = ?').run('demo');

    const userId = db
      .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
      .run('demo', hashPassword('demo'), 'Demo User').lastInsertRowid as number;
    db.prepare('INSERT INTO settings (user_id, currency) VALUES (?, ?)').run(userId, 'USD');

    const insertAsset = db.prepare(
      `INSERT INTO assets (user_id, category, name, notes, valuation_mode, market_symbol, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertLiability = db.prepare(
      'INSERT INTO liabilities (user_id, category, name, notes) VALUES (?, ?, ?, ?)',
    );
    const insertAssetVal = db.prepare(
      `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'seed', ?)`,
    );
    const insertLiabilityVal = db.prepare(
      `INSERT INTO liability_valuations (liability_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'seed', ?)`,
    );

    const ids = new Map<string, number>();
    for (const e of entries) {
      let id: number;
      if (e.table === 'assets') {
        id = insertAsset.run(
          userId, e.category, e.name, e.notes ?? null,
          e.market ? 'market' : 'manual',
          e.market?.symbol ?? null, e.market?.quantity ?? null,
        ).lastInsertRowid as number;
        for (const p of e.series) insertAssetVal.run(id, p.valueMinor, `${p.date}T12:00:00.000Z`);
      } else {
        id = insertLiability.run(userId, e.category, e.name, e.notes ?? null)
          .lastInsertRowid as number;
        for (const p of e.series) insertLiabilityVal.run(id, p.valueMinor, `${p.date}T12:00:00.000Z`);
      }
      ids.set(e.name, id);
    }

    const insertRecurring = db.prepare(
      `INSERT INTO recurring_transactions
         (user_id, name, asset_id, liability_id, amount_minor, cadence, next_run_on)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertRecurring.run(userId, 'Monthly savings deposit', ids.get('Savings')!, null,
      50_000, 'monthly', nextDayOfMonth(todayIso, 1));
    insertRecurring.run(userId, 'Mortgage payment', null, ids.get('Home mortgage')!,
      -115_000, 'monthly', nextDayOfMonth(todayIso, 1));
    insertRecurring.run(userId, 'Car loan payment', null, ids.get('Car loan')!,
      -26_000, 'monthly', nextDayOfMonth(todayIso, 15));

    // Daily net-worth snapshots derived from the seeded series (latest value
    // on or before each day, per entry).
    const insertSnapshot = db.prepare(
      `INSERT INTO snapshots (user_id, snapshot_date, assets_minor, liabilities_minor, net_worth_minor)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const cursors = entries.map(() => 0);
    const current = entries.map(() => 0);
    for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset--) {
      const date = addDays(todayIso, -dayOffset);
      let assets = 0;
      let liabilities = 0;
      entries.forEach((e, i) => {
        while (cursors[i]! < e.series.length && e.series[cursors[i]!]!.date <= date) {
          current[i] = e.series[cursors[i]!]!.valueMinor;
          cursors[i]!++;
        }
        if (e.table === 'assets') assets += current[i]!;
        else liabilities += current[i]!;
      });
      insertSnapshot.run(userId, date, assets, liabilities, assets - liabilities);
    }
  });
}
