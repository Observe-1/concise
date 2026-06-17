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
 * in — it never has a valuation method. Property and vehicles are never
 * market-priced (they are not exchange-traded): property may auto-apply a
 * country's yearly average price change, vehicles may auto-apply average
 * age-based depreciation. Liabilities are always manual.
 */
export const ASSET_VALUATION_MODES: Record<AssetCategory, readonly ValuationMode[]> = {
  cash: ['manual'],
  investments: ['manual', 'market'],
  property: ['manual', 'property_index'],
  vehicles: ['manual', 'depreciation'],
  crypto: ['manual', 'market'],
  precious_metals: ['manual', 'market'],
  other: ['manual', 'market'],
};

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
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
  /** ISO 4217 currency the instrument's prices are quoted in. */
  currency: string;
  /** Human-readable listing venue, e.g. "London Stock Exchange". */
  exchange: string;
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

/** Percent change of a holding's value over a requested range. */
export interface HoldingChangeDto {
  id: number;
  /**
   * Percent change over the range (e.g. 12.5 = +12.5%), or null when it
   * can't be computed: the holding had no valuation on or before the period
   * start (it didn't exist yet), or the base value was zero.
   */
  changePct: number | null;
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

/**
 * Percent change of the portfolio totals over a range (dashboard summary
 * cards). Each field is null when it can't be computed: no snapshot on or
 * before the period start, or a non-positive base (net worth can be ≤ 0).
 */
export interface DashboardChangesDto {
  range: HistoryRange;
  assetsChangePct: number | null;
  liabilitiesChangePct: number | null;
  netWorthChangePct: number | null;
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

/**
 * Prediction mode series: a small slice of real history (≈ range/10) followed
 * by on-the-fly projected future values out to the range's forward horizon.
 * `today` is the boundary date (the graph draws a dotted "now" line there).
 */
export interface PredictionDto {
  range: HistoryRange;
  today: string;
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

// ---------- database backups (see BACKUP.md) ----------

/** Configurable backup behaviour (a single global row — backups cover the whole
 *  database, not one user's data). */
export interface BackupSettingsDto {
  /** Filename prefix for new backups, e.g. "concise-backup". */
  namePrefix: string;
  /** How many backups to retain — manual AND automatic combined. */
  keepCount: number;
  /** Whether the scheduler takes backups automatically. On by default. */
  autoEnabled: boolean;
  /** How often automatic backups run, and the startup staleness threshold. */
  intervalHours: number;
}

/** One backup file on disk. */
export interface BackupFileDto {
  name: string;
  sizeBytes: number;
  /** ISO timestamp the backup was taken (parsed from the filename). */
  createdAt: string;
}

/** Everything the Settings → Backup page needs in one request. */
export interface BackupOverviewDto {
  settings: BackupSettingsDto;
  /** Absolute path of the backup directory. */
  location: string;
  /** Existing backups, newest first. */
  backups: BackupFileDto[];
}

/** Result of taking a backup on demand. */
export interface BackupRunResultDto {
  /** The backup just created (already validated to exist on disk). */
  backup: BackupFileDto;
  /** The refreshed list of existing backups, newest first. */
  backups: BackupFileDto[];
}

/**
 * Liveness probe response (GET /api/health). Deliberately minimal — "UP or
 * NOT". Reports no financial or account data. See HEALTHCHECK.md.
 */
export interface HealthDto {
  ok: true;
}

/** Rolled-up health of the whole service. */
export type HealthStatus = 'ok' | 'degraded' | 'down';
/** Health of a single component. `skipped` = not applicable here (e.g. the UI
 *  is served by the dev server, not this process). */
export type ComponentStatus = 'up' | 'down' | 'skipped';

export interface HealthCheck {
  status: ComponentStatus;
  /** Short, non-sensitive human note (never an internal error string). */
  detail: string;
  /** Round-trip time of the probe in milliseconds (database check only). */
  latencyMs?: number;
}

/** Diagnostic runtime facts (no up/down semantics) — versions, host and
 *  resource usage. All non-sensitive and non-financial. */
export interface HealthRuntime {
  /** Node.js version, e.g. "v24.16.0". */
  node: string;
  /** Bundled SQLite library version, e.g. "3.53.0". */
  sqlite: string;
  /** OS platform, e.g. "linux". */
  platform: string;
  /** CPU architecture, e.g. "x64" / "arm64". */
  arch: string;
  /** Which config profile is running. */
  environment: 'development' | 'production' | 'test';
  /** Process id (handy when reading container logs). */
  pid: number;
  /** Resident set size (whole process memory) in MB. */
  memoryRssMb: number;
  /** V8 heap actually in use in MB. */
  memoryHeapUsedMb: number;
}

/**
 * How one component is reached over the network. `port` is null when the
 * component uses no network port of its own — an embedded database (SQLite is
 * a local file) or a UI served by a separate process (the Vite dev server).
 * `detail` explains which case applies.
 */
export interface HealthEndpoint {
  port: number | null;
  detail: string;
}

/**
 * Ports each component is using. The UI, server and database can sit on
 * different ports (or none): the server has the HTTP port; the UI shares it
 * when served in-process but has its own when served by the dev server; the
 * embedded SQLite database has no port at all.
 */
export interface HealthNetwork {
  server: HealthEndpoint;
  ui: HealthEndpoint;
  database: HealthEndpoint;
}

/**
 * Non-pass/fail snapshot of the database-backup state, for monitors that want
 * to alert when backups go stale. Carries only operational facts about the
 * backup files — never any financial or account data. See BACKUP.md.
 */
export interface HealthBackup {
  /** ISO timestamp of the most recent backup, or null when none exist yet. */
  lastBackupAt: string | null;
  /** Filename of the most recent backup, or null when none exist yet. */
  lastBackupName: string | null;
  /** Backup directory path. */
  location: string;
  /** How many backups currently exist on disk. */
  count: number;
}

/**
 * Detailed readiness response (GET /api/health/detailed). Reports only the
 * operational status of the UI, server and database plus non-sensitive runtime
 * diagnostics — never any financial, account or secret data. `status` is `down`
 * (HTTP 503) only when the database is unreachable; a missing UI bundle is
 * `degraded` (still HTTP 200). See HEALTHCHECK.md.
 */
export interface DetailedHealthDto {
  status: HealthStatus;
  /** Application (server) version. */
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  runtime: HealthRuntime;
  network: HealthNetwork;
  /** Non-sensitive database-backup state (see BACKUP.md). */
  backup: HealthBackup;
  checks: {
    server: HealthCheck;
    database: HealthCheck;
    ui: HealthCheck;
  };
}
