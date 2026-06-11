// API data-transfer types. The web app imports these type-only — keep this
// file free of runtime imports so it stays a pure type module.

export const ASSET_CATEGORIES = ['cash', 'investments', 'property', 'vehicles', 'crypto', 'other'] as const;
export const LIABILITY_CATEGORIES = ['mortgage', 'loan', 'credit_card', 'student_loan', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type HistoryRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL';
export type ValuationSource = 'manual' | 'recurring' | 'market' | 'seed';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  currency: string;
}

export interface HoldingDto {
  id: number;
  category: string;
  name: string;
  notes: string | null;
  valuationMode: 'manual' | 'market';
  marketSymbol: string | null;
  quantity: number | null;
  currentValueMinor: number;
  lastValuedAt: string;
  createdAt: string;
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
}

export interface HistoryDto {
  range: HistoryRange;
  points: HistoryPointDto[];
}

export interface SettingsDto {
  username: string;
  displayName: string;
  currency: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
