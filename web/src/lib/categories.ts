// Single source of truth for category presentation. Every asset and
// liability type has exactly one emoji; no emoji is ever reused across types
// (enforced by test/categories.test.ts). Accessible names stay plain text —
// emojis are visual prefixes only.

export type HoldingSide = 'asset' | 'liability';

interface CategoryMeta {
  label: string;
  emoji: string;
}

export const ASSET_CATEGORY_META: Record<string, CategoryMeta> = {
  cash: { label: 'Cash', emoji: '💵' },
  investments: { label: 'Investments', emoji: '📈' },
  property: { label: 'Property', emoji: '🏠' },
  vehicles: { label: 'Vehicles', emoji: '🚗' },
  crypto: { label: 'Crypto', emoji: '🪙' },
  precious_metals: { label: 'Precious metals', emoji: '🥇' },
  other: { label: 'Other assets', emoji: '📦' },
};

export const LIABILITY_CATEGORY_META: Record<string, CategoryMeta> = {
  mortgage: { label: 'Mortgage', emoji: '🏦' },
  loan: { label: 'Loans', emoji: '💸' },
  credit_card: { label: 'Credit cards', emoji: '💳' },
  student_loan: { label: 'Student loans', emoji: '🎓' },
  other: { label: 'Other liabilities', emoji: '⚖️' },
};

function meta(side: HoldingSide, category: string): CategoryMeta {
  const m = (side === 'asset' ? ASSET_CATEGORY_META : LIABILITY_CATEGORY_META)[category];
  return m ?? { label: category, emoji: '❔' };
}

/** Plain-text name — use for aria-labels and anywhere emojis would be noise. */
export function categoryLabel(side: HoldingSide, category: string): string {
  return meta(side, category).label;
}

/** Emoji-prefixed display name for visible UI text. */
export function categoryDisplay(side: HoldingSide, category: string): string {
  const m = meta(side, category);
  return `${m.emoji} ${m.label}`;
}
