import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const summary = {
  assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, currency: 'USD',
  assetsByCategory: [], liabilitiesByCategory: [],
};

const history = {
  range: '6M',
  points: [
    { date: '2026-06-01', assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, trendMinor: 30_000_00 },
  ],
};

const compareDto = {
  from: '2025-06-25', to: '2026-06-25', currency: 'USD',
  holdings: [
    {
      id: 1, kind: 'asset', category: 'cash', name: 'Savings',
      fromMinor: 10_000_00, toMinor: 15_000_00, deltaMinor: 5_000_00, deltaPct: 50,
    },
  ],
  netWorth: { fromMinor: 25_000_00, toMinor: 30_000_00, deltaMinor: 5_000_00, deltaPct: 20 },
  assets: { fromMinor: 45_000_00, toMinor: 50_000_00, deltaMinor: 5_000_00, deltaPct: 11.1 },
  liabilities: { fromMinor: 20_000_00, toMinor: 20_000_00, deltaMinor: 0, deltaPct: 0 },
};

describe('dashboard compare mode', () => {
  it('enters compare mode and shows the per-holding table', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, []],
      [/\/api\/dashboard\/compare/, compareDto],
    ]);
    renderWithProviders(<App />, { route: '/' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /compare dates/i }));

    expect(await screen.findByText('Savings')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /exit compare/i })).toBeInTheDocument();
    // The prediction/compare picker buttons are gone while a mode is active.
    expect(screen.queryByRole('button', { name: /prediction mode/i })).not.toBeInTheDocument();
  });
});
