import type { Response } from 'express';
import type { AppContext } from '../../context.js';

export interface ValuationRow {
  holdingName: string;
  kind: 'asset' | 'liability';
  category: string;
  date: string;
  valueMinor: number;
}

/** Every valuation across both kinds, for the personal-data CSV export. */
export function listValuations(ctx: AppContext, userId: number): ValuationRow[] {
  const assetRows = ctx.db
    .prepare(
      `SELECT a.name AS holding_name, a.category, v.recorded_at, v.value_minor
       FROM asset_valuations v JOIN assets a ON a.id = v.asset_id
       WHERE a.user_id = ? ORDER BY v.recorded_at, v.id`,
    )
    .all(userId) as unknown as { holding_name: string; category: string; recorded_at: string; value_minor: number }[];
  const liabilityRows = ctx.db
    .prepare(
      `SELECT l.name AS holding_name, l.category, v.recorded_at, v.value_minor
       FROM liability_valuations v JOIN liabilities l ON l.id = v.liability_id
       WHERE l.user_id = ? ORDER BY v.recorded_at, v.id`,
    )
    .all(userId) as unknown as { holding_name: string; category: string; recorded_at: string; value_minor: number }[];

  const toRow = (kind: 'asset' | 'liability') =>
    (r: { holding_name: string; category: string; recorded_at: string; value_minor: number }): ValuationRow => ({
      holdingName: r.holding_name,
      kind,
      category: r.category,
      date: r.recorded_at.slice(0, 10),
      valueMinor: r.value_minor,
    });
  return [...assetRows.map(toRow('asset')), ...liabilityRows.map(toRow('liability'))];
}

/**
 * Quote a CSV field RFC4180-style, and defuse spreadsheet formula injection
 * (Excel/Sheets execute a leading =, +, -, or @ as a formula) by prefixing a
 * leading apostrophe — holding names and the currency code are free text the
 * user controls.
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const HEADER = ['Holding', 'Kind', 'Category', 'Date', 'Value', 'Currency'];

/** Stream the user's full valuation history as CSV directly onto the response. */
export function writeValuationsCsv(ctx: AppContext, userId: number, currency: string, res: Response): void {
  res.write(`${HEADER.join(',')}\n`);
  for (const row of listValuations(ctx, userId)) {
    const cells = [
      row.holdingName, row.kind, row.category, row.date, (row.valueMinor / 100).toFixed(2), currency,
    ];
    res.write(`${cells.map(csvField).join(',')}\n`);
  }
}
