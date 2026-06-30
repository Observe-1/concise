import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const savings = {
  id: 4, category: 'cash', name: 'Savings', notes: null, metal: null, valuationMode: 'manual',
  marketSymbol: null, quantity: null, country: null, manufactureDate: null,
  historicalPriceMissing: false, currentValueMinor: 1_000_00,
  lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
};

const btc = {
  id: 5, category: 'crypto', name: 'BTC stash', notes: null, metal: null, valuationMode: 'market',
  marketSymbol: 'BTC', quantity: 0.5, country: null, manufactureDate: null,
  historicalPriceMissing: false, currentValueMinor: 32_500_00,
  lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
};

describe('recurring page', () => {
  it('shows percentage schedules with a percent label', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/recurring$/, [{
        id: 1, name: 'Savings interest', targetType: 'asset', targetId: 4, targetName: 'Savings',
        amountType: 'percent', amountMinor: null, percent: 0.5,
        cadence: 'monthly', nextRunOn: '2026-07-01', lastRunOn: null, active: true,
      }]],
    ]);
    renderWithProviders(<App />, { route: '/recurring' });

    expect(await screen.findByText('Savings interest')).toBeInTheDocument();
    expect(screen.getByText('+0.5%')).toBeInTheDocument();
  });

  it('creates a percentage schedule through the form', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/recurring$/, []],
      [/\/api\/assets$/, [savings]],
      [/\/api\/liabilities$/, []],
    ]);
    renderWithProviders(<App />, { route: '/recurring' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add schedule/i }));
    const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Interest');
    await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '4');
    // all cadences offered, including quarterly
    expect(within(dialog).getByRole('option', { name: 'Quarterly' })).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/amount type/i), 'percent');
    await user.type(within(dialog).getByLabelText(/percent/i), '0.5');
    await user.click(within(dialog).getByRole('button', { name: /add schedule/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/recurring$/.test(c.url));
      expect(post!.body).toMatchObject({ targetId: 4, percent: 0.5 });
      expect((post!.body as { amountMinor?: number }).amountMinor).toBeUndefined();
    });
  });

  describe('market-mode targets', () => {
    it('explains buying/selling shares for a fixed amount on a market-mode asset', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, []],
        [/\/api\/assets$/, [savings, btc]],
        [/\/api\/liabilities$/, []],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /add schedule/i }));
      const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
      await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '5'); // BTC stash

      expect(within(dialog).getByText(/buys or sells that much of the holding/i)).toBeInTheDocument();
    });

    it('explains growing/shrinking the share count for a percentage on a market-mode asset', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, []],
        [/\/api\/assets$/, [savings, btc]],
        [/\/api\/liabilities$/, []],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /add schedule/i }));
      const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
      await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '5'); // BTC stash
      await user.selectOptions(within(dialog).getByLabelText(/amount type/i), 'percent');

      expect(within(dialog).getByText(/grows or shrinks the share count directly/i)).toBeInTheDocument();
    });

    it('shows the ordinary hints for a manually-valued target', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, []],
        [/\/api\/assets$/, [savings, btc]],
        [/\/api\/liabilities$/, []],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /add schedule/i }));
      const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
      await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '4'); // Savings (manual)
      await user.selectOptions(within(dialog).getByLabelText(/amount type/i), 'percent');

      expect(within(dialog).getByText(/applied to the target's value/i)).toBeInTheDocument();
      expect(within(dialog).queryByText(/buys or sells/i)).not.toBeInTheDocument();
    });
  });

  describe('end date', () => {
    const withEndDate = {
      id: 1, name: 'Promo interest', targetType: 'asset', targetId: 4, targetName: 'Savings',
      amountType: 'percent', amountMinor: null, percent: 0.5,
      cadence: 'monthly', nextRunOn: '2026-07-01', lastRunOn: null, endDate: '2026-12-01', active: true,
    };

    it('shows the end date on the list row when set', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, [withEndDate]],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      expect(await screen.findByText(/next 2026-07-01 · ends 2026-12-01/)).toBeInTheDocument();
    });

    it('omits the ends-date text when there is none', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, [{ ...withEndDate, endDate: null }]],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      await screen.findByText('Promo interest');
      expect(screen.queryByText(/ends/i)).not.toBeInTheDocument();
    });

    it('creates a schedule with an end date through the form', async () => {
      const calls = mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, []],
        [/\/api\/assets$/, [savings]],
        [/\/api\/liabilities$/, []],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /add schedule/i }));
      const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
      await user.type(within(dialog).getByLabelText(/^name$/i), 'Promo interest');
      await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '4');
      await user.selectOptions(within(dialog).getByLabelText(/amount type/i), 'percent');
      await user.type(within(dialog).getByLabelText(/percent/i), '0.5');
      fireEvent.change(within(dialog).getByLabelText(/end date/i), { target: { value: '2026-12-01' } });
      await user.click(within(dialog).getByRole('button', { name: /add schedule/i }));

      await waitFor(() => {
        const post = calls.find((c) => c.method === 'POST' && /\/api\/recurring$/.test(c.url));
        expect(post!.body).toMatchObject({ endDate: '2026-12-01' });
      });
    });

    it('rejects an end date before the next run date client-side', async () => {
      mockFetch([
        [/\/api\/auth\/me/, { user: demoUser }],
        [/\/api\/recurring$/, []],
        [/\/api\/assets$/, [savings]],
        [/\/api\/liabilities$/, []],
      ]);
      renderWithProviders(<App />, { route: '/recurring' });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /add schedule/i }));
      const dialog = await screen.findByRole('dialog', { name: /add schedule/i });
      await user.type(within(dialog).getByLabelText(/^name$/i), 'X');
      await user.selectOptions(await within(dialog).findByLabelText(/^asset$/i), '4');
      await user.type(within(dialog).getByLabelText(/^amount$/i), '10');
      fireEvent.change(within(dialog).getByLabelText(/next run/i), { target: { value: '2026-12-01' } });
      fireEvent.change(within(dialog).getByLabelText(/end date/i), { target: { value: '2026-06-01' } });
      await user.click(within(dialog).getByRole('button', { name: /add schedule/i }));

      expect(await screen.findByText(/end date cannot be before/i)).toBeInTheDocument();
    });
  });
});
