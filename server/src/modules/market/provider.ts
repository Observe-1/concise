import type { SymbolLookupDto } from '../../types/api.js';
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
const INSTRUMENTS: Record<string, Instrument> = {
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

/** Value of a holding in minor units. */
export function holdingValueMinor(priceMinor: number, quantity: number): number {
  return Math.round(priceMinor * quantity);
}
