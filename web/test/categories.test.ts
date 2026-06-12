import { describe, expect, it } from 'vitest';
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES } from '@api';
import {
  ASSET_CATEGORY_META, LIABILITY_CATEGORY_META, categoryDisplay, categoryLabel,
} from '../src/lib/categories.js';

describe('category metadata', () => {
  it('covers every asset and liability category', () => {
    for (const c of ASSET_CATEGORIES) expect(ASSET_CATEGORY_META[c], c).toBeDefined();
    for (const c of LIABILITY_CATEGORIES) expect(LIABILITY_CATEGORY_META[c], c).toBeDefined();
  });

  it('assigns every type exactly one emoji, never repeated', () => {
    const emojis = [
      ...Object.values(ASSET_CATEGORY_META).map((m) => m.emoji),
      ...Object.values(LIABILITY_CATEGORY_META).map((m) => m.emoji),
    ];
    expect(emojis.every((e) => e.length > 0)).toBe(true);
    expect(new Set(emojis).size).toBe(emojis.length); // no duplicates
  });

  it('prefixes display names with the emoji but keeps labels plain', () => {
    expect(categoryDisplay('asset', 'cash')).toBe('💵 Cash');
    expect(categoryLabel('asset', 'cash')).toBe('Cash');
    expect(categoryDisplay('liability', 'credit_card')).toBe('💳 Credit cards');
  });
});
