import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection.js';
import { hashPassword } from '../lib/passwords.js';
import { addDays, toDateISO } from '../lib/dates.js';
import { convertMinor } from '../lib/fx.js';
import { hashString, mulberry32 } from '../lib/rng.js';
import { SimulatedPriceProvider, holdingValueMinor } from '../modules/market/provider.js';

// The demo is one person's whole financial life: a 55-year-old who has tracked
// his net worth since his 10th birthday. Forty-five years of weekly history so
// every range (up to 20Y/All) and the age overlay have a rich story to show.
const AGE_NOW = 55;
const AGE_START = 10;
const YEAR_DAYS = 365.25;
const HISTORY_DAYS = Math.round((AGE_NOW - AGE_START) * YEAR_DAYS);
const POINT_EVERY_DAYS = 7;

/** £ → minor units (pence). */
const P = (pounds: number): number => Math.round(pounds * 100);

interface SeriesPoint { date: string; valueMinor: number }
/** A value the holding had at a given age; series interpolate between these. */
interface KeyFrame { age: number; valueMinor: number }
const kf = (age: number, pounds: number): KeyFrame => ({ age, valueMinor: P(pounds) });

/** ISO date the demo user turned `age` (age `AGE_NOW` == today). */
function atAge(todayIso: string, age: number): string {
  return addDays(todayIso, -Math.round((AGE_NOW - age) * YEAR_DAYS));
}

/**
 * A holding's weekly value series from age-keyed keyframes, with deterministic
 * noise. Emits points only within the holding period: zero before the first
 * keyframe (not yet owned), interpolated between keyframes, and — when the last
 * keyframe is zero — ending at that disposal date (sold / paid off, so it
 * contributes nothing thereafter). Still-held holdings run to today, where the
 * value is pinned exactly to the final keyframe so seeded totals are exact.
 */
function keyframeSeries(
  key: string, frames: KeyFrame[], todayIso: string, volatility: number,
): SeriesPoint[] {
  const rand = mulberry32(hashString(key));
  const kfs = frames
    .map((f) => ({ t: Date.parse(atAge(todayIso, f.age)), value: f.valueMinor }))
    .sort((a, b) => a.t - b.t);
  const firstT = kfs[0]!.t;
  const lastKf = kfs[kfs.length - 1]!;
  const held = lastKf.value > 0; // a nonzero final value means still owned today
  const endT = held ? Date.parse(todayIso) : lastKf.t;
  const valueAt = (t: number): number => {
    if (t <= firstT) return kfs[0]!.value;
    if (t >= lastKf.t) return lastKf.value;
    let j = 0;
    while (j < kfs.length - 1 && kfs[j + 1]!.t <= t) j++;
    const a = kfs[j]!;
    const b = kfs[j + 1]!;
    return a.value + (b.value - a.value) * ((t - a.t) / (b.t - a.t));
  };

  const points: SeriesPoint[] = [];
  const steps = Math.floor(HISTORY_DAYS / POINT_EVERY_DAYS);
  for (let i = 0; i <= steps; i++) {
    const date = addDays(todayIso, -(steps - i) * POINT_EVERY_DAYS);
    const t = Date.parse(date);
    if (t < firstT || t > endT) continue;
    const base = valueAt(t);
    const noise = base === 0 ? 0 : (rand() - 0.5) * 2 * volatility;
    points.push({ date, valueMinor: Math.max(0, Math.round(base * (1 + noise))) });
  }
  // Pin an exact terminal value (a clean disposal to 0, or today's real value).
  const endDate = toDateISO(new Date(endT));
  const terminal = { date: endDate, valueMinor: Math.max(0, lastKf.value) };
  if (points.length === 0 || points[points.length - 1]!.date !== endDate) points.push(terminal);
  else points[points.length - 1] = terminal;
  return points;
}

// Market holdings are valued from the simulated price provider (data begins
// 2020), converted into the account currency — mirroring the live path.
function marketSeries(symbol: string, quantity: number, todayIso: string, currency: string): SeriesPoint[] {
  const prices = new SimulatedPriceProvider();
  const ccy = prices.instrumentCurrency(symbol);
  const points: SeriesPoint[] = [];
  const steps = Math.floor(HISTORY_DAYS / POINT_EVERY_DAYS);
  for (let i = 0; i <= steps; i++) {
    const date = addDays(todayIso, -(steps - i) * POINT_EVERY_DAYS);
    const price = prices.getPriceMinor(symbol, date);
    if (price === null) continue; // before the provider's data begins
    points.push({ date, valueMinor: convertMinor(holdingValueMinor(price, quantity), ccy, currency) });
  }
  return points;
}

interface SeedEntry {
  table: 'assets' | 'liabilities';
  category: string;
  name: string;
  notes?: string;
  metal?: string;
  /** Property-index country (valuation_mode 'property_index'). */
  country?: string;
  /** Vehicle manufacture date for depreciation (valuation_mode 'depreciation'). */
  manufactureDate?: string;
  /** Auto-projected modes need an anchor; pin one at today so prediction starts
   *  from the real current value rather than an old seeded point. */
  anchorToday?: boolean;
  series: SeriesPoint[];
  market?: { symbol: string; quantity: number };
}

function nextDayOfMonth(todayIso: string, day: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  let date = new Date(Date.UTC(y!, m! - 1, day));
  if (d! >= day) date = new Date(Date.UTC(y!, m!, day));
  return toDateISO(date);
}

const CURRENCY = 'GBP';

/**
 * Create (or reset) the demo account: a 55-year-old's lifelong portfolio with
 * 45 years of backdated history, a diversified mix of active and disposed
 * holdings, goals and recurring transactions. Deterministic for a given `now`.
 */
export function seed(db: DatabaseSync, now: () => Date = () => new Date()): void {
  const todayIso = toDateISO(now());
  const birthYear = Number(todayIso.slice(0, 4)) - AGE_NOW;
  const km = (symbol: string, qty: number) => marketSeries(symbol, qty, todayIso, CURRENCY);
  const ks = (key: string, frames: KeyFrame[], vol: number) => keyframeSeries(key, frames, todayIso, vol);

  const entries: SeedEntry[] = [
    // --- legacy / childhood wealth (ages 10–18), later drawn down or rolled over ---
    { table: 'assets', category: 'investments', name: 'Family trust fund',
      notes: 'Inheritance held in trust; drawn down through university',
      series: ks('demo:trust', [kf(10, 9_000), kf(14, 15_000), kf(18, 24_000), kf(21, 19_000), kf(25, 0)], 0.05) },
    { table: 'assets', category: 'cash', name: 'Junior savings account',
      notes: 'Childhood savings, rolled into adult accounts at 19',
      series: ks('demo:junior', [kf(10, 1_500), kf(16, 4_500), kf(18, 6_200), kf(19, 0)], 0.06) },

    // --- everyday cash ---
    { table: 'assets', category: 'cash', name: 'Current account',
      series: ks('demo:current', [
        kf(21, 800), kf(24, 2_600), kf(28, 1_400), kf(31, 900), kf(35, 6_500),
        kf(45, 18_000), kf(52, 34_000), kf(55, 48_000),
      ], 0.22) },
    { table: 'assets', category: 'cash', name: 'Cash ISA & savings',
      notes: 'Emergency fund and short-term savings',
      series: ks('demo:savings', [
        kf(23, 2_000), kf(28, 500), kf(31, 900), kf(37, 46_000), kf(46, 30_000),
        kf(50, 185_000), kf(53, 250_000), kf(55, 320_000),
      ], 0.05) },
    { table: 'assets', category: 'other', name: 'Premium Bonds',
      series: ks('demo:bonds', [kf(24, 1_000), kf(35, 12_000), kf(45, 30_000), kf(55, 55_000)], 0.02) },

    // --- long-term investing: pension + ISA (dot-com, GFC and Covid drawdowns) ---
    { table: 'assets', category: 'investments', name: 'Workplace pension & SIPP',
      notes: 'Employer scheme plus a self-invested personal pension',
      series: ks('demo:pension', [
        kf(22, 0), kf(24, 6_000), kf(29, 42_000), kf(31, 36_000), kf(37, 260_000),
        kf(39, 205_000), kf(45, 820_000), kf(49, 1_520_000), kf(51, 1_360_000),
        kf(53, 2_250_000), kf(55, 3_300_000),
      ], 0.05) },
    { table: 'assets', category: 'investments', name: 'Stocks & Shares ISA',
      series: ks('demo:isa', [
        kf(25, 3_000), kf(29, 19_000), kf(31, 13_500), kf(35, 72_000), kf(39, 54_000),
        kf(45, 265_000), kf(49, 540_000), kf(51, 430_000), kf(53, 690_000), kf(55, 850_000),
      ], 0.07) },

    // --- market-priced diversification (provider data from 2020) ---
    { table: 'assets', category: 'investments', name: 'Global index fund',
      notes: 'Vanguard FTSE All-World', market: { symbol: 'VWRL', quantity: 300 },
      series: km('VWRL', 300) },
    { table: 'assets', category: 'investments', name: 'UK equity — Shell',
      market: { symbol: 'SHEL', quantity: 2_500 }, series: km('SHEL', 2_500) },
    { table: 'assets', category: 'crypto', name: 'Bitcoin',
      market: { symbol: 'BTC', quantity: 1.2 }, series: km('BTC', 1.2) },
    { table: 'assets', category: 'precious_metals', name: 'Gold bullion', metal: 'gold',
      market: { symbol: 'XAU', quantity: 30 }, series: km('XAU', 30) },

    // --- property: a first flat (sold to trade up), the home, and a rental ---
    { table: 'assets', category: 'property', name: 'First flat',
      notes: 'Sold at 46 to fund the family home',
      series: ks('demo:flat', [kf(31, 185_000), kf(38, 240_000), kf(45, 315_000), kf(46, 0)], 0.015) },
    { table: 'assets', category: 'property', name: 'Family home', notes: 'Primary residence',
      country: 'GB', anchorToday: true,
      series: ks('demo:home', [
        kf(46, 820_000), kf(49, 980_000), kf(51, 930_000), kf(53, 1_500_000), kf(55, 1_800_000),
      ], 0.01) },
    { table: 'assets', category: 'property', name: 'Buy-to-let flat', notes: 'Rental income',
      country: 'GB', anchorToday: true,
      series: ks('demo:btl', [kf(50, 480_000), kf(53, 590_000), kf(55, 650_000)], 0.012) },

    // --- vehicles: two long since sold, one current (depreciating) ---
    { table: 'assets', category: 'vehicles', name: 'First car (VW Golf)',
      series: ks('demo:golf', [kf(24, 8_000), kf(30, 3_000), kf(31, 0)], 0.03) },
    { table: 'assets', category: 'vehicles', name: 'Motorbike',
      series: ks('demo:moto', [kf(26, 6_000), kf(34, 2_600), kf(36, 0)], 0.03) },
    { table: 'assets', category: 'vehicles', name: 'Family car (Range Rover)',
      manufactureDate: atAge(todayIso, 52), anchorToday: true,
      series: ks('demo:car', [kf(52, 85_000), kf(55, 62_000)], 0.02) },

    // --- liabilities: several cleared over the years, three still running ---
    { table: 'liabilities', category: 'student_loan', name: 'Student loan',
      notes: 'Cleared at 35',
      series: ks('demo:student', [kf(18, 3_000), kf(21, 15_000), kf(28, 9_000), kf(35, 0)], 0.01) },
    { table: 'liabilities', category: 'loan', name: 'Graduate car loan',
      series: ks('demo:carloan', [kf(24, 7_000), kf(28, 0)], 0.01) },
    { table: 'liabilities', category: 'loan', name: 'Wedding loan',
      notes: 'Borrowed for the wedding at 28, cleared by 31',
      series: ks('demo:wedding', [kf(28, 18_000), kf(31, 0)], 0.01) },
    { table: 'liabilities', category: 'mortgage', name: 'First flat mortgage',
      notes: 'Redeemed when the flat was sold',
      series: ks('demo:flatmort', [kf(31, 150_000), kf(38, 120_000), kf(45, 92_000), kf(46, 0)], 0.005) },
    { table: 'liabilities', category: 'loan', name: 'Home improvement loan',
      series: ks('demo:improve', [kf(48, 25_000), kf(52, 0)], 0.01) },
    { table: 'liabilities', category: 'mortgage', name: 'Home mortgage',
      series: ks('demo:mortgage', [kf(46, 620_000), kf(50, 585_000), kf(53, 545_000), kf(55, 520_000)], 0.002) },
    { table: 'liabilities', category: 'mortgage', name: 'Buy-to-let mortgage',
      series: ks('demo:btlmort', [kf(50, 360_000), kf(53, 335_000), kf(55, 320_000)], 0.002) },
    { table: 'liabilities', category: 'credit_card', name: 'Credit card',
      series: ks('demo:cc', [kf(22, 2_000), kf(30, 6_000), kf(40, 8_000), kf(48, 5_000), kf(55, 4_500)], 0.4) },
  ];

  withTransaction(db, () => {
    // Reset any previous demo account so seeding is repeatable.
    db.prepare('DELETE FROM users WHERE username = ?').run('demo');

    const userId = db
      .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
      .run('demo', hashPassword('demo'), 'Demo User').lastInsertRowid as number;
    db.prepare('INSERT INTO settings (user_id, currency, birth_year) VALUES (?, ?, ?)')
      .run(userId, CURRENCY, birthYear);

    const insertAsset = db.prepare(
      `INSERT INTO assets
         (user_id, category, name, notes, metal, valuation_mode, market_symbol, quantity, country, manufacture_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertLiability = db.prepare(
      'INSERT INTO liabilities (user_id, category, name, notes) VALUES (?, ?, ?, ?)',
    );
    const insertAssetVal = db.prepare(
      `INSERT INTO asset_valuations (asset_id, value_minor, source, recorded_at) VALUES (?, ?, ?, ?)`,
    );
    const insertLiabilityVal = db.prepare(
      `INSERT INTO liability_valuations (liability_id, value_minor, source, recorded_at)
       VALUES (?, ?, 'seed', ?)`,
    );

    const valuationMode = (e: SeedEntry): string => {
      if (e.market) return 'market';
      if (e.country) return 'property_index';
      if (e.manufactureDate) return 'depreciation';
      return 'manual';
    };

    const ids = new Map<string, number>();
    for (const e of entries) {
      let id: number;
      if (e.table === 'assets') {
        id = insertAsset.run(
          userId, e.category, e.name, e.notes ?? null, e.metal ?? null, valuationMode(e),
          e.market?.symbol ?? null, e.market?.quantity ?? null, e.country ?? null, e.manufactureDate ?? null,
        ).lastInsertRowid as number;
        for (const p of e.series) insertAssetVal.run(id, p.valueMinor, 'seed', `${p.date}T12:00:00.000Z`);
        // Anchor auto-projected modes to today's real value (property/vehicle).
        if (e.anchorToday && e.series.length > 0) {
          insertAssetVal.run(id, e.series[e.series.length - 1]!.valueMinor, 'manual', `${todayIso}T12:00:30.000Z`);
        }
      } else {
        id = insertLiability.run(userId, e.category, e.name, e.notes ?? null).lastInsertRowid as number;
        for (const p of e.series) insertLiabilityVal.run(id, p.valueMinor, `${p.date}T12:00:00.000Z`);
      }
      ids.set(e.name, id);
    }

    // Current balance of a liability (its last seeded value), for payoff goals.
    const currentBalance = (name: string): number => {
      const e = entries.find((x) => x.name === name)!;
      return e.series[e.series.length - 1]!.valueMinor;
    };

    // --- goals: two net-worth targets, two mortgage payoffs (one hidden on the graph) ---
    const insertGoal = db.prepare(
      `INSERT INTO goals
         (user_id, name, goal_type, target_minor, liability_id, baseline_minor, target_date, notes, show_on_prediction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertGoal.run(userId, 'Net worth £7.5M', 'net_worth', P(7_500_000), null, null,
      atAge(todayIso, 58), 'On track for a comfortable retirement', 1);
    insertGoal.run(userId, 'Financial independence £10M', 'net_worth', P(10_000_000), null, null,
      atAge(todayIso, 63), null, 1);
    insertGoal.run(userId, 'Pay off the home', 'liability_payoff', 0, ids.get('Home mortgage')!,
      currentBalance('Home mortgage'), atAge(todayIso, 62), 'Mortgage-free by 62', 1);
    insertGoal.run(userId, 'Clear the buy-to-let', 'liability_payoff', 0, ids.get('Buy-to-let mortgage')!,
      currentBalance('Buy-to-let mortgage'), atAge(todayIso, 60), null, 0);

    // --- recurring inputs: contributions, income, interest and repayments ---
    const insertRecurring = db.prepare(
      `INSERT INTO recurring_transactions
         (user_id, name, asset_id, liability_id, amount_type, amount_minor, percent, cadence, next_run_on, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const recurAsset = (name: string, target: string, amountMinor: number, cadence: string, day: number, endDate: string | null = null) =>
      insertRecurring.run(userId, name, ids.get(target)!, null, 'fixed', amountMinor, null, cadence, nextDayOfMonth(todayIso, day), endDate);
    const recurLiability = (name: string, target: string, amountMinor: number, cadence: string, day: number) =>
      insertRecurring.run(userId, name, null, ids.get(target)!, 'fixed', amountMinor, null, cadence, nextDayOfMonth(todayIso, day), null);

    recurAsset('Pension contributions', 'Workplace pension & SIPP', P(4_000), 'monthly', 1);
    recurAsset('ISA investment', 'Stocks & Shares ISA', P(1_500), 'monthly', 6);
    recurAsset('Salary surplus to savings', 'Cash ISA & savings', P(2_000), 'monthly', 28);
    recurAsset('Rental income', 'Cash ISA & savings', P(1_300), 'monthly', 15);
    recurAsset('Annual bonus', 'Cash ISA & savings', P(25_000), 'yearly', 1);
    recurAsset('Car allowance top-up', 'Current account', P(1_000), 'monthly', 10, atAge(todayIso, 57));
    // Savings interest as a percentage of the balance (≈ 4.2% a year).
    insertRecurring.run(userId, 'Savings interest', ids.get('Cash ISA & savings')!, null,
      'percent', null, 0.35, 'monthly', nextDayOfMonth(todayIso, 1), null);
    recurLiability('Mortgage payment', 'Home mortgage', -P(4_500), 'monthly', 2);
    recurLiability('Buy-to-let mortgage payment', 'Buy-to-let mortgage', -P(2_200), 'monthly', 2);
    recurLiability('Credit card paydown', 'Credit card', -P(600), 'monthly', 20);

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
