import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const summary = {
  assetsMinor: 50_000_00,
  liabilitiesMinor: 20_000_00,
  netWorthMinor: 30_000_00,
  currency: 'USD',
  assetsByCategory: [
    { category: 'cash', totalMinor: 30_000_00, count: 2 },
    { category: 'crypto', totalMinor: 20_000_00, count: 1 },
  ],
  liabilitiesByCategory: [{ category: 'loan', totalMinor: 20_000_00, count: 1 }],
};

const history = {
  range: '6M',
  points: [
    { date: '2026-05-01', assetsMinor: 48_000_00, liabilitiesMinor: 21_000_00, netWorthMinor: 27_000_00, trendMinor: 27_500_00 },
    { date: '2026-06-01', assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, trendMinor: 28_500_00 },
  ],
};

const changes = {
  range: '6M', assetsChangePct: 4.2, liabilitiesChangePct: -4.8, netWorthChangePct: 11.1,
};

const prediction = {
  range: '6M',
  today: '2026-06-01',
  points: [
    { date: '2026-05-20', assetsMinor: 49_000_00, liabilitiesMinor: 20_500_00, netWorthMinor: 28_500_00, trendMinor: 28_500_00 },
    { date: '2026-06-01', assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, trendMinor: 30_000_00 },
    { date: '2026-12-01', assetsMinor: 56_000_00, liabilitiesMinor: 18_000_00, netWorthMinor: 38_000_00, trendMinor: 38_000_00 },
  ],
};

function mountDashboard() {
  const calls = mockFetch([
    [/\/api\/auth\/me/, { user: demoUser }],
    [/\/api\/dashboard\/changes/, changes],
    [/\/api\/dashboard\/prediction/, prediction],
    [/\/api\/dashboard\/summary/, summary],
    [/\/api\/dashboard\/history/, history],
  ]);
  renderWithProviders(<App />, { route: '/' });
  return calls;
}

describe('dashboard', () => {
  it('shows net worth, assets and liabilities totals', async () => {
    mountDashboard();
    // currency symbol varies by system locale ($ / US$) — match the number;
    // totals also appear in the category breakdown, so allow multiple
    expect((await screen.findAllByText(/30,000\.00/)).length).toBeGreaterThan(0); // net worth
    expect(screen.getAllByText(/50,000\.00/).length).toBeGreaterThan(0); // assets (green)
    expect(screen.getAllByText(/20,000\.00/).length).toBeGreaterThan(0); // liabilities (red)
    expect(screen.getByText(/welcome back, demo user/i)).toBeInTheDocument();
  });

  it('shows a percent change next to each total for the selected range', async () => {
    const calls = mountDashboard();
    // Net worth + assets growth in green, liabilities decline in red.
    expect(await screen.findByText('+11.1%')).toBeInTheDocument();
    expect(screen.getByText('+4.2%')).toBeInTheDocument();
    expect(screen.getByText('-4.8%')).toBeInTheDocument();
    expect(screen.getByText(/vs 6M ago/i)).toBeInTheDocument();

    // The change figures are fetched for the graph's selected range.
    expect(calls.some((c) => /\/api\/dashboard\/changes\?range=6M/.test(c.url))).toBe(true);
  });

  it('offers every range preset (including 10Y/20Y) and requests the chosen one', async () => {
    const calls = mountDashboard();
    const group = await screen.findByRole('group', { name: /history range/i });
    for (const label of ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'All']) {
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
    }

    const user = userEvent.setup();
    await user.click(within(group).getByRole('button', { name: '1Y' }));
    expect(calls.some((c) => c.url.includes('range=1Y'))).toBe(true);

    const pressed = within(group).getByRole('button', { name: '1Y' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('adjusts the trend rolling-average window from the slider', async () => {
    const calls = mountDashboard();
    const slider = await screen.findByRole('slider', { name: /trend rolling average window/i });
    fireEvent.change(slider, { target: { value: '30' } });

    expect(screen.getByText(/trend 30d/i)).toBeInTheDocument();
    // The request is debounced — wait for it to land with the new window.
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('trendWindow=30'))).toBe(true);
    });
  });

  it('enters prediction mode: fetches projections, hides MAX, offers a golden exit', async () => {
    const calls = mountDashboard();
    const user = userEvent.setup();

    // The golden enter button is at the bottom; MAX (All) is offered until then.
    const group = await screen.findByRole('group', { name: /history range/i });
    expect(within(group).getByRole('button', { name: 'All' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /prediction mode/i }));

    // Projections are fetched and MAX disappears from the range picker.
    await waitFor(() => {
      expect(calls.some((c) => /\/api\/dashboard\/prediction\?range=/.test(c.url))).toBe(true);
    });
    expect(within(group).queryByRole('button', { name: 'All' })).not.toBeInTheDocument();

    // A golden exit button replaces the enter button.
    expect(screen.getByRole('button', { name: /exit prediction/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^prediction mode/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /exit prediction/i }));
    expect(await screen.findByRole('button', { name: /prediction mode/i })).toBeInTheDocument();
  });

  it('toggles full-screen graph mode', async () => {
    mountDashboard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /view graph full screen/i }));
    expect(screen.getByRole('button', { name: /exit full screen/i })).toBeInTheDocument();
    // Summary cards are hidden in full-screen mode
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    // The trend window slider stays available in full-screen mode
    expect(screen.getByRole('slider', { name: /trend rolling average window/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /exit full screen/i }));
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
  });

  it('shows category breakdowns with unique emoji prefixes', async () => {
    mountDashboard();
    expect(await screen.findByText('💵 Cash')).toBeInTheDocument();
    expect(screen.getByText('🪙 Crypto')).toBeInTheDocument();
    expect(screen.getByText('💸 Loans')).toBeInTheDocument();
  });

  it('renders the chart (not the empty state) when only one point exists', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, {
        range: '6M',
        trendWindow: 91,
        points: [history.points[0]],
      }],
    ]);
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByRole('img', { name: /net worth history chart/i })).toBeInTheDocument();
    expect(screen.queryByText(/no history yet/i)).not.toBeInTheDocument();
  });

  it('renders the primary navigation', async () => {
    mountDashboard();
    await screen.findAllByText(/30,000\.00/);
    const navs = screen.getAllByRole('navigation', { name: /primary/i });
    expect(navs.length).toBeGreaterThan(0);
    const nav = navs[navs.length - 1]!; // mobile bottom bar
    for (const label of ['Home', 'Assets', 'Debts', 'Recurring', 'Settings']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });
});
