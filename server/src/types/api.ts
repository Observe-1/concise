// API data-transfer types. The web app imports these type-only — keep this
// file free of runtime imports so it stays a pure type module.

export const ASSET_CATEGORIES = ['cash', 'investments', 'property', 'vehicles', 'crypto', 'precious_metals', 'other'] as const;
export const LIABILITY_CATEGORIES = ['mortgage', 'loan', 'credit_card', 'student_loan', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

/** Sub-selection for the precious_metals asset class. */
export const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type Metal = (typeof METALS)[number];

export type ValuationMode = 'manual' | 'market';

/**
 * Valuation methods available per asset category. Cash is a number you type
 * in — it never has a valuation method. Liabilities are always manual.
 */
export const ASSET_VALUATION_MODES: Record<AssetCategory, readonly ValuationMode[]> = {
  cash: ['manual'],
  investments: ['manual', 'market'],
  property: ['manual', 'market'],
  vehicles: ['manual', 'market'],
  crypto: ['manual', 'market'],
  precious_metals: ['manual', 'market'],
  other: ['manual', 'market'],
};

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type HistoryRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | '10Y' | '20Y' | 'ALL';
export type ValuationSource = 'manual' | 'recurring' | 'market' | 'seed';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  currency: string;
  birthYear: number | null;
}

export interface HoldingDto {
  id: number;
  category: string;
  name: string;
  notes: string | null;
  /** Set only for precious_metals assets. */
  metal: Metal | null;
  valuationMode: 'manual' | 'market';
  marketSymbol: string | null;
  quantity: number | null;
  currentValueMinor: number;
  lastValuedAt: string;
  createdAt: string;
}

/** Result of resolving a market symbol to its instrument. */
export interface SymbolLookupDto {
  symbol: string;
  name: string;
}

export interface ValuationDto {
  id: number;
  valueMinor: number;
  source: ValuationSource;
  recordedAt: string;
}

export interface HoldingDetailDto extends HoldingDto {
  valuations: ValuationDto[];
}

export interface RecurringDto {
  id: number;
  name: string;
  targetType: 'asset' | 'liability';
  targetId: number;
  targetName: string;
  amountMinor: number;
  cadence: Cadence;
  nextRunOn: string;
  lastRunOn: string | null;
  active: boolean;
}

export interface CategoryTotalDto {
  category: string;
  totalMinor: number;
  count: number;
}

export interface DashboardSummaryDto {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  currency: string;
  assetsByCategory: CategoryTotalDto[];
  liabilitiesByCategory: CategoryTotalDto[];
}

export interface HistoryPointDto {
  date: string;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  /**
   * Smoothed net-worth trend: a centred moving average over the user's FULL
   * history (window set by the `trendWindow` request param, default 91 days)
   * so it is identical for a given date regardless of the requested range —
   * the trend never re-fits to the visible window.
   */
  trendMinor: number;
}

export interface HistoryDto {
  range: HistoryRange;
  /** Rolling-average window (days) the trend was computed with. */
  trendWindow: number;
  points: HistoryPointDto[];
}

/** User-entered "on this date my net worth was X" point. */
export interface LegacySnapshotDto {
  date: string;
  netWorthMinor: number;
}

/** A single historic valuation entry across any holding (history editor). */
export interface HistoryEntryDto {
  id: number;
  side: 'asset' | 'liability';
  holdingId: number;
  holdingName: string;
  category: string;
  valueMinor: number;
  source: ValuationSource;
  recordedAt: string;
}

export interface SettingsDto {
  username: string;
  displayName: string;
  currency: string;
  /** Used for the age overlay on long-range charts; null disables it. */
  birthYear: number | null;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
