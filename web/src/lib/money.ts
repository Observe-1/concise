/** Format integer minor units (cents) as a currency string. */
export function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/** Compact form for chart axes and small cards: $1.2M, -£3.4K. */
export function formatMinorCompact(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(minor / 100);
}

/**
 * Parse a user-entered amount ("1,234.56", "£1234", " 99 ") into minor units.
 * Returns null when not a valid non-negative amount with ≤2 decimals.
 */
export function parseToMinor(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '').replace(/^[^\d.-]+/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

/** Minor units → editable decimal string ("123456" → "1234.56"). */
export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}
