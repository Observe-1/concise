import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const summary = {
  assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, currency: 'USD',
  assetsByCategory: [{ category: 'cash', totalMinor: 50_000_00, count: 1 }], liabilitiesByCategory: [],
};

const history = {
  range: '6M',
  points: [
    { date: '2026-06-01', assetsMinor: 50_000_00, liabilitiesMinor: 20_000_00, netWorthMinor: 30_000_00, trendMinor: 30_000_00 },
  ],
};

const combinedSummary = {
  assetsMinor: 80_000_00, liabilitiesMinor: 25_000_00, netWorthMinor: 55_000_00, currency: 'USD',
};

const combinedHistory = {
  range: '6M', trendWindow: 0,
  points: [
    { date: '2026-06-01', assetsMinor: 80_000_00, liabilitiesMinor: 25_000_00, netWorthMinor: 55_000_00, trendMinor: 55_000_00 },
  ],
};

describe('household settings section', () => {
  it('sends an invite through the form', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/household\/status/, { state: 'none', linkId: null, partnerUsername: null }],
    ]);
    renderWithProviders(<App />, { route: '/settings/household' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'partner');
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/household\/invite$/.test(c.url));
      expect(post!.body).toMatchObject({ username: 'partner' });
    });
  });

  it('shows accept/decline for a received invite', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/household\/status/, { state: 'pending-received', linkId: 5, partnerUsername: 'partner' }],
    ]);
    renderWithProviders(<App />, { route: '/settings/household' });

    expect(await screen.findByText(/partner wants to link/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('shows an unlink button once accepted', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/household\/status/, { state: 'accepted', linkId: 5, partnerUsername: 'partner' }],
    ]);
    renderWithProviders(<App />, { route: '/settings/household' });

    expect(await screen.findByText(/linked with partner/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
  });
});

describe('household combined view on the dashboard', () => {
  it('shows no scope toggle when there is no accepted link', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, []],
      [/\/api\/household\/status/, { state: 'none', linkId: null, partnerUsername: null }],
    ]);
    renderWithProviders(<App />, { route: '/' });

    await screen.findByText(/net worth/i);
    expect(screen.queryByRole('group', { name: /net worth scope/i })).not.toBeInTheDocument();
  });

  it('switches to the combined totals and hides the breakdown when toggled', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, []],
      [/\/api\/household\/status/, { state: 'accepted', linkId: 5, partnerUsername: 'partner' }],
      [/\/api\/household\/combined\/summary/, combinedSummary],
      [/\/api\/household\/combined\/history/, combinedHistory],
    ]);
    renderWithProviders(<App />, { route: '/' });

    const user = userEvent.setup();
    const group = await screen.findByRole('group', { name: /net worth scope/i });
    await user.click(within(group).getByRole('button', { name: /combined/i }));

    expect(await screen.findByText('US$55,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/^cash/i)).not.toBeInTheDocument();
  });
});
