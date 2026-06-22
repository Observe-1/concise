import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };
const settings = { username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const entries = [
  {
    id: 11, side: 'asset', holdingId: 1, holdingName: 'Savings', category: 'cash',
    valueMinor: 150_00, source: 'manual', recordedAt: '2026-06-10T12:00:00.000Z',
  },
  {
    id: 7, side: 'liability', holdingId: 2, holdingName: 'Loan', category: 'loan',
    valueMinor: 50_00, source: 'recurring', recordedAt: '2026-06-01T00:00:00.000Z',
  },
];

function mountSettings() {
  return mockFetch([
    [/\/api\/auth\/me/, { user: demoUser }],
    [/\/api\/settings/, settings],
    [/\/api\/history\/legacy/, [{ date: '2015-03-01', netWorthMinor: 1_000_00 }]],
    [/\/api\/history\/entries\/asset\/11/, { ...entries[0], valueMinor: 175_00 }],
    [/\/api\/history\/entries/, entries],
    [/\/api\/assets$/, []],
    [/\/api\/liabilities$/, []],
  ]);
}

describe('settings sub pages', () => {
  it('switches sub pages with the buttons at the top', async () => {
    mountSettings();
    renderWithProviders(<App />, { route: '/settings' });

    // User account is the default: profile + sign out, no history widgets
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByText(/legacy wealth/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^history$/i }));
    expect(await screen.findByText(/legacy wealth/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /calculation/i }));
    expect(await screen.findByLabelText(/currency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/birth year/i)).toBeInTheDocument();
    expect(screen.queryByText(/legacy wealth/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^legal$/i }));
    expect(await screen.findByRole('heading', { name: /not financial advice/i })).toBeInTheDocument();
    expect(screen.getByText(/not financial, investment, tax or legal advice/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
  });
});

describe('delete all data', () => {
  it('requires the tickbox and the exact phrase before deleting', async () => {
    const calls = mountSettings();
    renderWithProviders(<App />, { route: '/settings' });

    const user = userEvent.setup();
    const deleteBtn = await screen.findByRole('button', { name: /delete all data/i });

    // Nothing ticked/typed → error, no request.
    await user.click(deleteBtn);
    expect(await screen.findByRole('alert')).toHaveTextContent(/100% sure/i);

    // Ticked but wrong phrase → error, no request.
    await user.click(screen.getByRole('checkbox', { name: /100% sure/i }));
    await user.type(screen.getByLabelText(/type "delete all"/i), 'delete');
    await user.click(deleteBtn);
    expect(await screen.findByRole('alert')).toHaveTextContent(/type "delete all" exactly/i);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/settings/delete-all'))).toBe(false);

    // Correct phrase → the wipe request is sent.
    const phrase = screen.getByLabelText(/type "delete all"/i);
    await user.clear(phrase);
    await user.type(phrase, 'delete all');
    await user.click(deleteBtn);
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/settings/delete-all'));
      expect(post!.body).toEqual({ confirm: 'delete all' });
    });
  });
});

describe('settings history features', () => {
  it('shows legacy wealth entries and posts new points', async () => {
    const calls = mountSettings();
    renderWithProviders(<App />, { route: '/settings/history' });

    expect(await screen.findByText('2015-03-01')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^date$/i), '2018-07-01');
    await user.type(screen.getByLabelText(/net worth/i), '-2500');
    await user.click(screen.getByRole('button', { name: /add point/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.includes('/api/history/legacy'));
      expect(post!.body).toEqual({ date: '2018-07-01', netWorthMinor: -250000 });
    });
  });

  it('lists historic entries and edits one', async () => {
    const calls = mountSettings();
    renderWithProviders(<App />, { route: '/settings/history' });

    expect(await screen.findByText('Savings')).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /edit savings entry/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit entry — savings/i });
    expect(dialog).toBeInTheDocument();

    const valueInput = screen.getByLabelText(/^value$/i);
    await user.clear(valueInput);
    await user.type(valueInput, '175.00');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/api/history/entries/asset/11'));
      expect(patch!.body).toEqual({ valueMinor: 17500 });
    });
  });

  it('marks automatic entries and hides them on toggle', async () => {
    mountSettings();
    renderWithProviders(<App />, { route: '/settings/history' });

    // Both the manual (Savings) and the recurring (Loan) entry are listed,
    // and the automatic one carries an "Auto" badge.
    expect(await screen.findByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Loan')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /hide automatic entries/i }));

    // The recurring entry disappears; the manual one stays.
    await waitFor(() => expect(screen.queryByText('Loan')).not.toBeInTheDocument());
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('deletes an entry after confirmation', async () => {
    const calls = mountSettings();
    renderWithProviders(<App />, { route: '/settings/history' });
    await screen.findByText('Savings');

    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: /delete savings entry/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/history/entries/asset/11'))).toBe(true);
    });
  });
});
