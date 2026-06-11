import { ASSET_CATEGORIES, LIABILITY_CATEGORIES } from '../../types/api.js';

/**
 * Assets and liabilities share the same structure (entry + append-only
 * valuations). This config parametrises one implementation for both. Table
 * and column names are compile-time constants — never user input.
 */
export interface HoldingKind {
  kind: 'asset' | 'liability';
  table: 'assets' | 'liabilities';
  valuationTable: 'asset_valuations' | 'liability_valuations';
  fk: 'asset_id' | 'liability_id';
  categories: readonly string[];
  /** Only assets support market-linked valuation. */
  supportsMarket: boolean;
}

export const ASSET_KIND: HoldingKind = {
  kind: 'asset',
  table: 'assets',
  valuationTable: 'asset_valuations',
  fk: 'asset_id',
  categories: ASSET_CATEGORIES,
  supportsMarket: true,
};

export const LIABILITY_KIND: HoldingKind = {
  kind: 'liability',
  table: 'liabilities',
  valuationTable: 'liability_valuations',
  fk: 'liability_id',
  categories: LIABILITY_CATEGORIES,
  supportsMarket: false,
};
