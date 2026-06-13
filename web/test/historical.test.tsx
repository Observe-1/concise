import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const summary = {
  assetsMinor: 50_000_00,
  liabilitiesMinor: 20_000_00,
  netWorthMinor: 30_000_00,
  currency: 'USD',
  assetsByCategory: [{ category: 'cash', totalMinor: 50_000_00, count: 1 }],
  liabilitiesByCategory: [],
};

const history = {
  range: '6M',
  trendWindow: 91,
  points: [
    { date: '2026-05-01', assetsMinor: 48_000_00, liabilitiesMinor: 21_000_00, netWorthMinor: 27_000_00, trendMinor: 27_500_00 },
    { date: '2026-06-01', assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, trendMinor: 28_500_00 },
  ],
};

const STORAGE_KEY = 'concise.historicalAsOf';

describe('view-as mode', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('enters the mode from the graph X-axis scrubber and requests as-of data', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/changes/, { range: '6M', assetsChangePct: null, liabilitiesChangePct: null, netWorthChangePct: null }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
    ]);
    renderWithProviders(<App />, { route: '/' });

    const scrubber = await screen.findByRole('slider', { name: /view as date/i });
    fireEvent.change(scrubber, { target: { value: '0' } });

    // floating reset button + red accent appear, summary refetches as-of
    expect(await screen.findByRole('button', { name: /exit view as/i }))
      .toHaveTextContent('2026-05-01');
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/dashboard/summary?asOf=2026-05-01'))).toBe(true);
    });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('2026-05-01');
  });

  it('persists across page changes and the holdings page becomes read-only', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/changes/, { range: '6M', assetsChangePct: null, liabilitiesChangePct: null, netWorthChangePct: null }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/assets/, []],
    ]);
    renderWithProviders(<App />, { route: '/' });

    const scrubber = await screen.findByRole('slider', { name: /view as date/i });
    fireEvent.change(scrubber, { target: { value: '0' } });
    await screen.findByRole('button', { name: /exit view as/i });

    // navigate to the assets page through the app nav — the mode survives
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('link', { name: /assets/i })[0]!);

    expect(await screen.findByText(/viewing as of 2026-05-01/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit view as/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add asset/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/api/assets?asOf=2026-05-01'))).toBe(true);
    });
  });

  it('the floating reset button restores the live view from any page', async () => {
    sessionStorage.setItem(STORAGE_KEY, '2026-05-01');
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const reset = await screen.findByRole('button', { name: /exit view as/i });
    const user = userEvent.setup();
    await user.click(reset);

    expect(screen.queryByRole('button', { name: /exit view as/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /add asset/i })).toBeInTheDocument();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'GET' && /\/api\/assets$/.test(c.url))).toBe(true);
    });
  });
});
