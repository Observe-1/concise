// API data-transfer types. The web app imports these type-only — keep this
// file free of runtime imports so it stays a pure type module.

export const ASSET_CATEGORIES = ['cash', 'investments', 'property', 'vehicles', 'crypto', 'precious_metals', 'other'] as const;
export const LIABILITY_CATEGORIES = ['mortgage', 'loan', 'credit_card', 'student_loan', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

/** Sub-selection for the precious_metals asset class. */
export const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type Metal = (typeof METALS)[number];

export type ValuationMode = 'manual' | 'market' | 'property_index' | 'depreciation';

/**
 * Valuation methods available per asset category. Cash is a number you type
 * in — it never has a valuation method. Property may auto-apply a country's
 * yearly average price change; vehicles may auto-apply average age-based
 * depreciation. Liabilities are always manual.
 */
export const ASSET_VALUATION_MODES: Record<AssetCategory, readonly ValuationMode[]> = {
  cash: ['manual'],
  investments: ['manual', 'market'],
  property: ['manual', 'market', 'property_index'],
  vehicles: ['manual', 'market', 'depreciation'],
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
  valuationMode: ValuationMode;
  marketSymbol: string | null;
  quantity: number | null;
  /** ISO 3166-1 alpha-2 code — set only for the property_index method. */
  country: string | null;
  /** YYYY-MM-DD — set only for the vehicle depreciation method. */
  manufactureDate: string | null;
  /**
   * True when the provider had no price for part of this entry's backdated
   * history — the UI flags the entry as historically incomplete.
   */
  historicalPriceMissing: boolean;
  currentValueMinor: number;
  lastValuedAt: string;
  createdAt: string;
}

/** Result of resolving a market symbol to its instrument. */
export interface SymbolLookupDto {
  symbol: string;
  name: string;
}

/** A country selectable for the property-index valuation method. */
export interface PropertyCountryDto {
  code: string;
  name: string;
  annualRatePct: number;
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
  /** Fixed schedules move by amountMinor; percent schedules by percent of
   *  the target's current value. Exactly one of the two is set. */
  amountType: 'fixed' | 'percent';
  amountMinor: number | null;
  percent: number | null;
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
