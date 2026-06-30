import { Card } from './ui.js';

/** Settings card: download a CSV of every recorded valuation — a portable
 *  personal-data export, distinct from the whole-database backups under
 *  Settings → Backup. A plain same-origin link; no client-side fetch/blob
 *  needed since the session cookie rides along with the navigation. */
export function ExportSection() {
  return (
    <Card className="p-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">Export</h2>
      <p className="mb-4 text-sm text-ink-400">
        Download every recorded value across your assets and liabilities as a
        CSV — useful for a spreadsheet, your own records, or taxes.
      </p>
      <a
        href="/api/export/valuations.csv"
        className="inline-block rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-gold-400 min-h-11"
      >
        Download CSV
      </a>
    </Card>
  );
}
