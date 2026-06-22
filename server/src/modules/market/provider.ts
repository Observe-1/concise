import type { SymbolLookupDto } from '../../types/api.js';
import { addDays } from '../../lib/dates.js';
import type { Logger } from '../../lib/logger.js';
import { hashString, mulberry32 } from '../../lib/rng.js';

/**
 * Price source abstraction. The default implementation is a deterministic
 * simulation (no API keys, stable in tests). Swap in a real provider (e.g.
 * Yahoo Finance, CoinGecko) by implementing this interface and wiring it in
 * the app factory.
 */
export interface PriceProvider {
  /**
   * Price of one unit of `symbol` in minor units on the given date, in the
   * instrument's own quote currency (see {@link instrumentCurrency}), or null
   * when no price is known for that symbol/date (e.g. before the provider's
   * data begins) — callers must handle gaps in historical coverage.
   */
  getPriceMinor(symbol: string, dateISO: string): number | null;
  /**
   * Ensure prices for `symbols` over `[fromISO, toISO]` are available to
   * subsequent synchronous {@link getPriceMinor} calls — e.g. a network-backed
   * provider fetches and caches the range here. Callers `await` this once,
   * outside any database transaction, then read prices synchronously. Must
   * never reject: a provider that cannot reach its source falls back instead
   * (so a failed fetch can never break a request). A no-op for providers that
   * compute prices on the fly.
   */
  prime(symbols: string[], fromISO: string, toISO: string): Promise<void>;
  /** Resolve a symbol to its instrument (name, currency, exchange), or null. */
  lookupSymbol(symbol: string): SymbolLookupDto | null;
  /** ISO 4217 currency a symbol's prices are quoted in (USD when unknown). */
  instrumentCurrency(symbol: string): string;
  /** Every instrument the provider knows, for discovery/autocomplete. */
  listInstruments(): SymbolLookupDto[];
}

interface Instrument {
  name: string;
  /** ISO 4217 currency the instrument trades in. */
  currency: string;
  /** Human-readable listing venue. */
  exchange: string;
}

// Instruments the simulated provider knows, across several exchanges and
// currencies. Symbol verification at asset creation resolves against this list;
// unknown symbols are rejected so typos can't silently create unpriceable
// holdings. A deliberately small but varied table (no API keys, stable in
// tests) — enough to track real-world portfolios across London, US and EU
// listings, crypto and spot metals.
export const INSTRUMENTS: Record<string, Instrument> = {
  // Crypto — quoted in USD
  BTC: { name: 'Bitcoin', currency: 'USD', exchange: 'Crypto' },
  ETH: { name: 'Ethereum', currency: 'USD', exchange: 'Crypto' },
  SOL: { name: 'Solana', currency: 'USD', exchange: 'Crypto' },
  ADA: { name: 'Cardano', currency: 'USD', exchange: 'Crypto' },
  XRP: { name: 'XRP', currency: 'USD', exchange: 'Crypto' },
  DOGE: { name: 'Dogecoin', currency: 'USD', exchange: 'Crypto' },

  // London Stock Exchange — quoted in GBP
  VUAG: { name: 'Vanguard S&P 500 UCITS ETF (Acc)', currency: 'GBP', exchange: 'London Stock Exchange' },
  VUSA: { name: 'Vanguard S&P 500 UCITS ETF (Dist)', currency: 'GBP', exchange: 'London Stock Exchange' },
  VWRL: { name: 'Vanguard FTSE All-World UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  VWRP: { name: 'Vanguard FTSE All-World UCITS ETF (Acc)', currency: 'GBP', exchange: 'London Stock Exchange' },
  VHYL: { name: 'Vanguard FTSE All-World High Dividend Yield UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  VUKE: { name: 'Vanguard FTSE 100 UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  VMID: { name: 'Vanguard FTSE 250 UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  VFEM: { name: 'Vanguard FTSE Emerging Markets UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  ISF: { name: 'iShares Core FTSE 100 UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  EQQQ: { name: 'Invesco EQQQ Nasdaq-100 UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
  SGLN: { name: 'iShares Physical Gold ETC', currency: 'GBP', exchange: 'London Stock Exchange' },
  HSBA: { name: 'HSBC Holdings plc', currency: 'GBP', exchange: 'London Stock Exchange' },
  SHEL: { name: 'Shell plc', currency: 'GBP', exchange: 'London Stock Exchange' },
  BP: { name: 'BP p.l.c.', currency: 'GBP', exchange: 'London Stock Exchange' },
  AZN: { name: 'AstraZeneca PLC', currency: 'GBP', exchange: 'London Stock Exchange' },
  ULVR: { name: 'Unilever PLC', currency: 'GBP', exchange: 'London Stock Exchange' },
  LLOY: { name: 'Lloyds Banking Group plc', currency: 'GBP', exchange: 'London Stock Exchange' },

  // US — NASDAQ / NYSE / NYSE Arca, quoted in USD
  VOO: { name: 'Vanguard S&P 500 ETF', currency: 'USD', exchange: 'NYSE Arca' },
  SPY: { name: 'SPDR S&P 500 ETF Trust', currency: 'USD', exchange: 'NYSE Arca' },
  VTI: { name: 'Vanguard Total Stock Market ETF', currency: 'USD', exchange: 'NYSE Arca' },
  QQQ: { name: 'Invesco QQQ Trust', currency: 'USD', exchange: 'NASDAQ' },
  AAPL: { name: 'Apple Inc.', currency: 'USD', exchange: 'NASDAQ' },
  MSFT: { name: 'Microsoft Corporation', currency: 'USD', exchange: 'NASDAQ' },
  GOOG: { name: 'Alphabet Inc. Class C', currency: 'USD', exchange: 'NASDAQ' },
  AMZN: { name: 'Amazon.com, Inc.', currency: 'USD', exchange: 'NASDAQ' },
  TSLA: { name: 'Tesla, Inc.', currency: 'USD', exchange: 'NASDAQ' },
  NVDA: { name: 'NVIDIA Corporation', currency: 'USD', exchange: 'NASDAQ' },
  META: { name: 'Meta Platforms, Inc.', currency: 'USD', exchange: 'NASDAQ' },
  BRKB: { name: 'Berkshire Hathaway Inc. Class B', currency: 'USD', exchange: 'NYSE' },

  // Europe — Xetra / Euronext, quoted in EUR
  EUNL: { name: 'iShares Core MSCI World UCITS ETF', currency: 'EUR', exchange: 'Xetra' },
  SXR8: { name: 'iShares Core S&P 500 UCITS ETF', currency: 'EUR', exchange: 'Xetra' },
  SAP: { name: 'SAP SE', currency: 'EUR', exchange: 'Xetra' },
  ASML: { name: 'ASML Holding N.V.', currency: 'EUR', exchange: 'Euronext Amsterdam' },
  MC: { name: 'LVMH Moët Hennessy Louis Vuitton', currency: 'EUR', exchange: 'Euronext Paris' },
  AIR: { name: 'Airbus SE', currency: 'EUR', exchange: 'Euronext Paris' },

  // Spot precious metals — per troy ounce, quoted in USD
  XAU: { name: 'Gold (troy ounce)', currency: 'USD', exchange: 'Spot metal' },
  XAG: { name: 'Silver (troy ounce)', currency: 'USD', exchange: 'Spot metal' },
  XPT: { name: 'Platinum (troy ounce)', currency: 'USD', exchange: 'Spot metal' },
  XPD: { name: 'Palladium (troy ounce)', currency: 'USD', exchange: 'Spot metal' },
};

// Plausible base prices (in the instrument's own currency, minor units) for
// well-known symbols; anything else gets a hash-derived base so unknown
// symbols still produce a stable price.
const BASE_PRICES_MINOR: Record<string, number> = {
  BTC: 6_500_000, ETH: 350_000, SOL: 25_000, ADA: 80, XRP: 200, DOGE: 30,
  VUAG: 9_500, VUSA: 9_000, VWRL: 11_000, VWRP: 11_500, VHYL: 6_000,
  VUKE: 3_400, VMID: 2_000, VFEM: 5_500, ISF: 800, EQQQ: 40_000, SGLN: 4_500,
  HSBA: 700, SHEL: 2_800, BP: 480, AZN: 12_000, ULVR: 4_700, LLOY: 55,
  VOO: 55_000, SPY: 60_000, VTI: 28_000, QQQ: 50_000,
  AAPL: 23_000, MSFT: 42_000, GOOG: 17_000, AMZN: 18_000, TSLA: 25_000,
  NVDA: 12_000, META: 60_000, BRKB: 45_000,
  EUNL: 9_500, SXR8: 60_000, SAP: 20_000, ASML: 90_000, MC: 70_000, AIR: 18_000,
  XAU: 230_000, XAG: 2_800, XPT: 95_000, XPD: 100_000,
};

// The simulation's data begins here; earlier dates have no price — mirroring
// a real provider whose historical coverage does not stretch back forever.
const ORIGIN = Date.UTC(2020, 0, 1);

export class SimulatedPriceProvider implements PriceProvider {
  getPriceMinor(symbol: string, dateISO: string): number | null {
    const sym = symbol.toUpperCase();
    const base = BASE_PRICES_MINOR[sym] ?? 1_000 + (hashString(sym) % 100_000);
    const t = Math.floor((Date.parse(dateISO) - ORIGIN) / 86_400_000);
    if (Number.isNaN(t) || t < 0) return null;
    const h = hashString(sym);
    // Long-term drift + layered waves + small per-day deterministic noise.
    const trend = 1 + 0.00045 * t;
    const wave =
      0.10 * Math.sin(t / 53 + (h % 7)) +
      0.06 * Math.sin(t / 17 + (h % 13)) +
      0.03 * Math.sin(t / 5 + (h % 23));
    const noise = (mulberry32(hashString(sym + dateISO))() - 0.5) * 0.02;
    return Math.max(1, Math.round(base * trend * (1 + wave + noise)));
  }

  /** Prices are computed on the fly, so nothing to prefetch. */
  async prime(): Promise<void> {}

  lookupSymbol(symbol: string): SymbolLookupDto | null {
    const sym = symbol.trim().toUpperCase();
    const inst = INSTRUMENTS[sym];
    return inst ? { symbol: sym, name: inst.name, currency: inst.currency, exchange: inst.exchange } : null;
  }

  instrumentCurrency(symbol: string): string {
    return INSTRUMENTS[symbol.trim().toUpperCase()]?.currency ?? 'USD';
  }

  listInstruments(): SymbolLookupDto[] {
    return Object.entries(INSTRUMENTS)
      .map(([symbol, inst]) => ({ symbol, name: inst.name, currency: inst.currency, exchange: inst.exchange }))
      .sort((a, b) => a.exchange.localeCompare(b.exchange) || a.symbol.localeCompare(b.symbol));
  }
}

// ---------------------------------------------------------------------------
// Real price provider (Yahoo Finance)
// ---------------------------------------------------------------------------

// Our instrument symbol -> the symbol Yahoo Finance's chart API expects.
// London listings take a `.L` suffix, Xetra `.DE`, Euronext `.AS`/`.PA`, crypto
// `-USD`, and spot metals map to the COMEX/NYMEX continuous futures (per troy
// ounce, USD). Verified to resolve against the live endpoint. A symbol missing
// here is simply not fetched — getPriceMinor then falls back to the simulation.
const YAHOO_SYMBOLS: Record<string, string> = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', ADA: 'ADA-USD', XRP: 'XRP-USD', DOGE: 'DOGE-USD',
  VUAG: 'VUAG.L', VUSA: 'VUSA.L', VWRL: 'VWRL.L', VWRP: 'VWRP.L', VHYL: 'VHYL.L', VUKE: 'VUKE.L',
  VMID: 'VMID.L', VFEM: 'VFEM.L', ISF: 'ISF.L', EQQQ: 'EQQQ.L', SGLN: 'SGLN.L', HSBA: 'HSBA.L',
  SHEL: 'SHEL.L', BP: 'BP.L', AZN: 'AZN.L', ULVR: 'ULVR.L', LLOY: 'LLOY.L',
  VOO: 'VOO', SPY: 'SPY', VTI: 'VTI', QQQ: 'QQQ', AAPL: 'AAPL', MSFT: 'MSFT', GOOG: 'GOOG',
  AMZN: 'AMZN', TSLA: 'TSLA', NVDA: 'NVDA', META: 'META', BRKB: 'BRK-B',
  EUNL: 'EUNL.DE', SXR8: 'SXR8.DE', SAP: 'SAP.DE', ASML: 'ASML.AS', MC: 'MC.PA', AIR: 'AIR.PA',
  XAU: 'GC=F', XAG: 'SI=F', XPT: 'PL=F', XPD: 'PA=F',
};

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
/** Extra days fetched before the requested start so the most recent trading
 *  day on or before a weekend/holiday is always captured (carry-forward). */
const FETCH_BUFFER_DAYS = 7;

/** A single day's price for an instrument, in the instrument's minor units. */
export interface DailyPrice {
  dateISO: string;
  priceMinor: number;
}

/** Minimal shape of a Yahoo chart response (only the fields we read). */
interface YahooChart {
  chart?: {
    result?: {
      meta?: { currency?: string; regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

function isoDateFromUnixSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Convert a Yahoo Finance v8 chart payload into daily prices in the
 * instrument's minor units (1/100 of a major unit). Yahoo quotes most markets
 * in major units (USD/EUR/GBP) but London equities in `GBp` — pence, which are
 * already GBP minor units, so they must not be scaled by 100. Days with a null
 * close (non-trading days, gaps) are dropped; the live `regularMarketPrice` is
 * overlaid onto its day as the freshest value. Returns prices sorted by date.
 */
export function parseYahooChart(json: unknown): DailyPrice[] {
  const result = (json as YahooChart)?.chart?.result?.[0];
  if (!result) return [];
  const currency = result.meta?.currency ?? 'USD';
  // 'GBp' (and other lowercase-subunit codes) are already in minor units.
  const toMinor = (v: number): number => Math.round(currency === 'GBp' ? v : v * 100);

  const byDate = new Map<string, number>();
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c === null || c === undefined || !Number.isFinite(c)) continue;
    byDate.set(isoDateFromUnixSeconds(timestamps[i]!), toMinor(c));
  }
  const live = result.meta?.regularMarketPrice;
  const liveTime = result.meta?.regularMarketTime;
  if (typeof live === 'number' && Number.isFinite(live) && typeof liveTime === 'number') {
    byDate.set(isoDateFromUnixSeconds(liveTime), toMinor(live));
  }
  return [...byDate.entries()]
    .map(([dateISO, priceMinor]) => ({ dateISO, priceMinor }))
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));
}

/** Minimal fetch surface, injectable so tests run without the network. */
export type QuoteFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface CachedSeries {
  /** Dates present in `priceByDate`, sorted ascending (for carry-forward). */
  dates: string[];
  priceByDate: Map<string, number>;
  /** The date range we have *requested* (data may start later than this). */
  coveredFrom: string;
  coveredTo: string;
  fetchedAtMs: number;
}

/**
 * Live price provider backed by Yahoo Finance's public chart endpoint (no API
 * key). {@link prime} fetches and caches a date range per symbol; the
 * synchronous {@link getPriceMinor} then reads from that cache, carrying the
 * last trading day's price forward over weekends/holidays. Anything not (yet)
 * primed — an unknown symbol, a failed fetch, or a date before the instrument's
 * history — falls back to the deterministic {@link SimulatedPriceProvider}, so
 * the app keeps working offline and instrument lookup/listing is unchanged.
 */
export class RealPriceProvider implements PriceProvider {
  private readonly sim = new SimulatedPriceProvider();
  private readonly cache = new Map<string, CachedSeries>();
  private readonly fetchFn: QuoteFetch;
  private readonly nowMs: () => number;
  private readonly ttlMs: number;
  private readonly log?: Logger;

  constructor(opts: { fetchFn?: QuoteFetch; nowMs?: () => number; ttlMs?: number; logger?: Logger } = {}) {
    this.fetchFn = opts.fetchFn ?? ((url) => fetch(url));
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.ttlMs = opts.ttlMs ?? 15 * 60_000; // re-fetch the live end at most every 15 min
    this.log = opts.logger;
  }

  // Instrument metadata is static — reuse the simulated provider's table.
  lookupSymbol(symbol: string): SymbolLookupDto | null {
    return this.sim.lookupSymbol(symbol);
  }

  instrumentCurrency(symbol: string): string {
    return this.sim.instrumentCurrency(symbol);
  }

  listInstruments(): SymbolLookupDto[] {
    return this.sim.listInstruments();
  }

  getPriceMinor(symbol: string, dateISO: string): number | null {
    const sym = symbol.toUpperCase();
    const series = this.cache.get(sym);
    if (!series) return this.sim.getPriceMinor(symbol, dateISO); // not primed → fall back
    const exact = series.priceByDate.get(dateISO);
    if (exact !== undefined) return exact;
    // Carry the most recent trading day on or before `dateISO` forward.
    const floor = floorPrice(series, dateISO);
    // Within coverage but before the instrument's first real datum → unknown
    // to the live source (e.g. before listing); null lets callers flag/skip it.
    return floor;
  }

  async prime(symbols: string[], fromISO: string, toISO: string): Promise<void> {
    const fetchFrom = addDays(fromISO, -FETCH_BUFFER_DAYS);
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    await Promise.all(unique.map((sym) => this.primeSymbol(sym, fetchFrom, toISO)));
  }

  private async primeSymbol(sym: string, fetchFrom: string, toISO: string): Promise<void> {
    const yahoo = YAHOO_SYMBOLS[sym];
    if (!yahoo) return; // not a known live instrument → getPriceMinor falls back
    const cached = this.cache.get(sym);
    const covers = cached && cached.coveredFrom <= fetchFrom && cached.coveredTo >= toISO;
    const fresh = cached && this.nowMs() - cached.fetchedAtMs < this.ttlMs;
    if (covers && fresh) return; // already have this range, recently enough
    const wantFrom = cached && cached.coveredFrom < fetchFrom ? cached.coveredFrom : fetchFrom;
    try {
      const quotes = await this.fetchSeries(yahoo, wantFrom, toISO);
      if (quotes.length === 0) return; // keep any prior cache; otherwise stay on fallback
      const priceByDate = new Map(cached?.priceByDate ?? []);
      for (const q of quotes) priceByDate.set(q.dateISO, q.priceMinor);
      const dates = [...priceByDate.keys()].sort();
      this.cache.set(sym, {
        dates,
        priceByDate,
        coveredFrom: wantFrom,
        coveredTo: cached && cached.coveredTo > toISO ? cached.coveredTo : toISO,
        fetchedAtMs: this.nowMs(),
      });
    } catch (err) {
      // Never throw from prime: a transient failure must not break the request.
      // The symbol stays unprimed, so getPriceMinor uses the simulated fallback.
      this.log?.warn(
        { symbol: sym, yahoo, reason: (err as Error).message },
        'price fetch failed; falling back to simulation',
      );
    }
  }

  private async fetchSeries(yahooSymbol: string, fromISO: string, toISO: string): Promise<DailyPrice[]> {
    const period1 = Math.floor(Date.parse(`${fromISO}T00:00:00Z`) / 1000);
    const period2 = Math.floor(Date.parse(`${toISO}T23:59:59Z`) / 1000);
    const url = `${YAHOO_CHART_BASE}${encodeURIComponent(yahooSymbol)}`
      + `?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseYahooChart(await res.json());
  }
}

/** Largest cached price on or before `dateISO` (carry-forward), or null when
 *  the series has no datum that early. */
function floorPrice(series: CachedSeries, dateISO: string): number | null {
  const { dates } = series;
  let lo = 0;
  let hi = dates.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= dateISO) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx === -1 ? null : series.priceByDate.get(dates[idx]!)!;
}

/** Value of a holding in minor units. */
export function holdingValueMinor(priceMinor: number, quantity: number): number {
  return Math.round(priceMinor * quantity);
}
