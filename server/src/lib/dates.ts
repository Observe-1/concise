// All date logic uses UTC calendar days. A "date" is a YYYY-MM-DD string.

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';

export function toDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now: () => Date): string {
  return toDateISO(now());
}

export function parseDateISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function addDays(iso: string, days: number): string {
  const d = parseDateISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateISO(d);
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addMonthsClamped(iso: string, months: number): string {
  const d = parseDateISO(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  target.setUTCDate(Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return toDateISO(target);
}

/**
 * Advance a schedule cursor by one cadence step. Monthly/yearly clamp to the
 * end of shorter months (Jan 31 → Feb 28); the clamped day then carries
 * forward (no anchor-day memory) — simple, predictable semantics.
 */
export function advanceCadence(iso: string, cadence: Cadence): string {
  switch (cadence) {
    case 'daily': return addDays(iso, 1);
    case 'weekly': return addDays(iso, 7);
    case 'monthly': return addMonthsClamped(iso, 1);
    case 'yearly': return addMonthsClamped(iso, 12);
  }
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseDateISO(toISO).getTime() - parseDateISO(fromISO).getTime()) / 86_400_000);
}

export type HistoryRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL';

/** Inclusive start date for a dashboard history range, or null for ALL. */
export function rangeStart(range: HistoryRange, todayIso: string): string | null {
  const d = parseDateISO(todayIso);
  switch (range) {
    case '1M': return addMonthsClamped(todayIso, -1);
    case '3M': return addMonthsClamped(todayIso, -3);
    case '6M': return addMonthsClamped(todayIso, -6);
    case 'YTD': return `${d.getUTCFullYear()}-01-01`;
    case '1Y': return addMonthsClamped(todayIso, -12);
    case '5Y': return addMonthsClamped(todayIso, -60);
    case 'ALL': return null;
  }
}
