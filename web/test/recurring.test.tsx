import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    await user.selectOptions(within(dialog).getByLabelText(/amount type/i), 'percent');
    await user.type(within(dialog).getByLabelText(/percent/i), '0.5');
    await user.click(within(dialog).getByRole('button', { name: /add schedule/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/recurring$/.test(c.url));
      expect(post!.body).toMatchObject({ targetId: 4, percent: 0.5 });
      expect((post!.body as { amountMinor?: number }).amountMinor).toBeUndefined();
    });
  });
});
