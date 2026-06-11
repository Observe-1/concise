import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD' };

const assets = [
  {
    id: 1, category: 'cash', name: 'Checking', notes: null, valuationMode: 'manual',
    marketSymbol: null, quantity: null, currentValueMinor: 4_250_00,
    lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
  },
  {
    id: 2, category: 'crypto', name: 'Bitcoin', notes: null, valuationMode: 'market',
    marketSymbol: 'BTC', quantity: 0.15, currentValueMinor: 2_099_097,
    lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
  },
];

describe('assets page', () => {
  it('groups entries by category and shows only categories with data', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, assets],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    expect(await screen.findByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Crypto' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Property' })).not.toBeInTheDocument();
    expect(screen.getByText('BTC × 0.15')).toBeInTheDocument(); // market badge
    expect(screen.getByRole('button', { name: /refresh prices/i })).toBeInTheDocument();
  });

  it('shows an empty state when there is no data', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });
    expect(await screen.findByText(/no assets yet/i)).toBeInTheDocument();
  });

  it('creates an asset through the add dialog', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));

    const dialog = await screen.findByRole('dialog', { name: /add asset/i });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText(/name/i), 'Emergency fund');
    await user.type(screen.getByLabelText(/^value$/i), '12,500.00');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post).toBeDefined();
      expect(post!.body).toMatchObject({
        category: 'cash',
        name: 'Emergency fund',
        valueMinor: 1_250_000,
      });
    });
  });

  it('rejects invalid amounts before hitting the API', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.type(screen.getByLabelText(/name/i), 'X');
    await user.type(screen.getByLabelText(/^value$/i), 'not-a-number');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid amount/i);
  });
});

describe('liabilities page', () => {
  it('mirrors the asset structure with liability categories', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/liabilities$/, [{
        id: 9, category: 'mortgage', name: 'Home mortgage', notes: null, valuationMode: 'manual',
        marketSymbol: null, quantity: null, currentValueMinor: 248_000_00,
        lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
      }]],
    ]);
    renderWithProviders(<App />, { route: '/liabilities' });

    expect(await screen.findByText('Home mortgage')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Mortgage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add liability/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh prices/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /add liability/i }));
    const dialog = await screen.findByRole('dialog', { name: /add liability/i });
    expect(dialog).toBeInTheDocument();
    // liability categories offered, asset categories absent
    expect(screen.getByRole('option', { name: 'Mortgage' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Crypto' })).not.toBeInTheDocument();
  });
});
