import type { SymbolLookupDto } from '../../types/api.js';
import { hashString, mulberry32 } from '../../lib/rng.js';

/**
 * Price source abstraction. The default implementation is a deterministic
 * simulation (no API keys, stable in tests). Swap in a real provider (e.g.
 * Yahoo Finance, CoinGecko) by implementing this interface and wiring it in
 * the app factory.
 */
export interface PriceProvider {
  /** Price of one unit of `symbol` in minor units on the given date. */
  getPriceMinor(symbol: string, dateISO: string): number;
  /** Resolve a symbol to its instrument name, or null when unknown. */
  lookupSymbol(symbol: string): SymbolLookupDto | null;
}

// Instruments the simulated provider knows by name. Symbol verification at
// asset creation resolves against this list; unknown symbols are rejected so
// typos can't silently create unpriceable holdings.
const INSTRUMENTS: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  VWRL: 'Vanguard FTSE All-World UCITS ETF',
  VUSA: 'Vanguard S&P 500 UCITS ETF',
  VOO: 'Vanguard S&P 500 ETF',
  SPY: 'SPDR S&P 500 ETF Trust',
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOG: 'Alphabet Inc. Class C',
  AMZN: 'Amazon.com, Inc.',
  TSLA: 'Tesla, Inc.',
  XAU: 'Gold (troy ounce)',
  XAG: 'Silver (troy ounce)',
  XPT: 'Platinum (troy ounce)',
  XPD: 'Palladium (troy ounce)',
};

// Plausible base prices for well-known symbols; anything else gets a
// hash-derived base so unknown symbols still work.
const BASE_PRICES_MINOR: Record<string, number> = {
  BTC: 6_500_000,
  ETH: 350_000,
  VWRL: 11_000,
  VUSA: 9_000,
  VOO: 55_000,
  SPY: 60_000,
  AAPL: 23_000,
  MSFT: 42_000,
  GOOG: 17_000,
  AMZN: 18_000,
  TSLA: 25_000,
  XAU: 230_000,
  XAG: 2_800,
  XPT: 95_000,
  XPD: 100_000,
};

const ORIGIN = Date.UTC(2020, 0, 1);

export class SimulatedPriceProvider implements PriceProvider {
  getPriceMinor(symbol: string, dateISO: string): number {
    const sym = symbol.toUpperCase();
    const base = BASE_PRICES_MINOR[sym] ?? 1_000 + (hashString(sym) % 100_000);
    const t = Math.max(0, Math.floor((Date.parse(dateISO) - ORIGIN) / 86_400_000));
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
    const name = INSTRUMENTS[sym];
    return name ? { symbol: sym, name } : null;
  }
}

/** Value of a holding in minor units. */
export function holdingValueMinor(priceMinor: number, quantity: number): number {
  return Math.round(priceMinor * quantity);
}
