import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const assets = [
  {
    id: 1, category: 'cash', name: 'Checking', notes: null, metal: null, valuationMode: 'manual',
    marketSymbol: null, quantity: null, currentValueMinor: 4_250_00,
    lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
  },
  {
    id: 2, category: 'crypto', name: 'Bitcoin', notes: null, metal: null, valuationMode: 'market',
    marketSymbol: 'BTC', quantity: 0.15, currentValueMinor: 2_099_097,
    lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
  },
  {
    id: 3, category: 'precious_metals', name: 'Gold coins', notes: null, metal: 'gold',
    valuationMode: 'manual', marketSymbol: null, quantity: null, currentValueMinor: 920_000,
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
    // precious metals class with metal sub-label
    expect(screen.getByRole('region', { name: 'Precious metals' })).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
  });

  it('shows a per-holding percent change for the selected range', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets\/changes\?range=1Y/, [
        { id: 1, changePct: 12.5 },
        { id: 2, changePct: -4.2 },
        { id: 3, changePct: null },
      ]],
      [/\/api\/assets\/changes\?range=1M/, [
        { id: 1, changePct: 0.3 },
        { id: 2, changePct: -1 },
        { id: 3, changePct: null },
      ]],
      [/\/api\/assets$/, assets],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    // Default range 1Y: growth, decline and N/A all render.
    expect(await screen.findByText('+12.5%')).toBeInTheDocument();
    expect(screen.getByText('-4.2%')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();

    // Switching the range refetches and shows the new figures.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText('+0.3%')).toBeInTheDocument();
    expect(calls.some((c) => /\/api\/assets\/changes\?range=1M/.test(c.url))).toBe(true);
  });

  it('offers a metal sub-selection for precious metals and sends it on create', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'precious_metals');

    const metalSelect = await screen.findByLabelText(/^metal$/i);
    await user.selectOptions(metalSelect, 'silver');
    await user.type(screen.getByLabelText(/^name$/i), 'Silver bars');
    await user.type(screen.getByLabelText(/^value$/i), '3000');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post!.body).toMatchObject({ category: 'precious_metals', metal: 'silver' });
    });
  });

  it('labels entries whose historical prices could not be found, with hover text', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, [{
        ...assets[1]!, historicalPriceMissing: true,
      }]],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    expect(await screen.findByText('Bitcoin')).toBeInTheDocument();
    const label = screen.getByText(/incomplete history/i);
    expect(label).toHaveAttribute(
      'title',
      'Accurate historical price information could not be found about this asset.',
    );
  });

  it('offers no valuation method for cash — manual input only', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));

    // Default category is cash: no valuation selector, just the value input.
    expect(screen.queryByLabelText(/valuation/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^value$/i)).toBeInTheDocument();

    // Market-capable categories get the selector back…
    await user.selectOptions(screen.getByLabelText(/category/i), 'investments');
    expect(await screen.findByLabelText(/valuation/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/valuation/i), 'market');
    expect(await screen.findByLabelText(/symbol/i)).toBeInTheDocument();

    // …and switching back to cash drops the method and the market fields.
    await user.selectOptions(screen.getByLabelText(/category/i), 'cash');
    expect(screen.queryByLabelText(/valuation/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/symbol/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^value$/i)).toBeInTheDocument();
  });

  it('offers the property index method with a country selector', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/market\/property-countries/, [
        { code: 'GB', name: 'United Kingdom', annualRatePct: 3.7 },
        { code: 'US', name: 'United States', annualRatePct: 4.6 },
      ]],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'property');
    // property is never market-priced — only manual and the index method
    expect(screen.queryByRole('option', { name: /market price/i })).not.toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText(/valuation/i), 'property_index');

    const countrySelect = await screen.findByLabelText(/country/i);
    expect(screen.getByRole('option', { name: /united kingdom \(\+3\.7%\/yr\)/i })).toBeInTheDocument();
    await user.selectOptions(countrySelect, 'GB');
    await user.type(screen.getByLabelText(/^name$/i), 'Home');
    await user.type(screen.getByLabelText(/^value$/i), '300000');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post!.body).toMatchObject({
        category: 'property', valuationMode: 'property_index', country: 'GB', valueMinor: 30_000_000,
      });
    });
  });

  it('offers automatic depreciation for vehicles with a manufacture date field', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/market\/property-countries/, []],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'vehicles');
    // vehicles are never market-priced — only manual and depreciation
    expect(screen.queryByRole('option', { name: /market price/i })).not.toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText(/valuation/i), 'depreciation');

    // the manufacture date field appears only when the method is ticked
    const manufacture = await screen.findByLabelText(/manufacture date/i);
    await user.type(screen.getByLabelText(/^name$/i), 'Car');
    await user.type(screen.getByLabelText(/^value$/i), '20000');
    fireEvent.change(manufacture, { target: { value: '2023-06-11' } });
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post!.body).toMatchObject({
        category: 'vehicles', valuationMode: 'depreciation',
        manufactureDate: '2023-06-11', valueMinor: 2_000_000,
      });
    });
  });

  it('requires symbol verification before saving a market asset', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/market\/lookup\?symbol=VWRL/, { symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF' }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'investments');
    await user.type(screen.getByLabelText(/^name$/i), 'World ETF');
    await user.selectOptions(screen.getByLabelText(/valuation/i), 'market');
    await user.type(await screen.findByLabelText(/symbol/i), 'vwrl');
    await user.type(screen.getByLabelText(/quantity/i), '10');

    // saving without verification is blocked
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/verify the symbol/i);
    expect(calls.some((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url))).toBe(false);

    // verify resolves and shows the instrument name with a confirmation
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/VWRL — Vanguard FTSE All-World UCITS ETF/);

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post!.body).toMatchObject({ valuationMode: 'market', marketSymbol: 'VWRL', quantity: 10 });
    });
  });

  it('rejects unknown symbols at the verification step', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/market\/lookup/, { error: 'Unknown symbol: ZZZZ' }, 404],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.selectOptions(screen.getByLabelText(/category/i), 'crypto');
    await user.selectOptions(screen.getByLabelText(/valuation/i), 'market');
    await user.type(await screen.findByLabelText(/symbol/i), 'zzzz');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not recognised/i);
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

  it('lets you update a property-index value, re-anchoring via a revaluation', async () => {
    const property = {
      id: 3, category: 'property', name: 'Home', notes: null, metal: null,
      valuationMode: 'property_index', marketSymbol: null, quantity: null,
      country: 'GB', manufactureDate: null, historicalPriceMissing: false,
      currentValueMinor: 30_000_000,
      lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
    };
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/market\/property-countries/, [{ code: 'GB', name: 'United Kingdom', annualRatePct: 3.7 }]],
      [/\/api\/assets\/3\/valuations/, { ...property, currentValueMinor: 35_000_000 }],
      [/\/api\/assets\/3$/, property],
      [/\/api\/assets$/, [property]],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /home/i }));

    // The value field is offered when editing a model asset (so it can be re-anchored).
    const valueInput = await screen.findByLabelText(/current value/i);
    await user.clear(valueInput);
    await user.type(valueInput, '350000');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    // Metadata PATCH keeps the model method, then a revaluation re-anchors the value.
    await waitFor(() => {
      const revalue = calls.find((c) => c.method === 'POST' && /\/api\/assets\/3\/valuations/.test(c.url));
      expect(revalue!.body).toEqual({ valueMinor: 35_000_000 });
    });
    const patch = calls.find((c) => c.method === 'PATCH' && /\/api\/assets\/3$/.test(c.url));
    expect(patch!.body).toMatchObject({ valuationMode: 'property_index', country: 'GB' });
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
        id: 9, category: 'mortgage', name: 'Home mortgage', notes: null, metal: null,
        valuationMode: 'manual', marketSymbol: null, quantity: null, currentValueMinor: 248_000_00,
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
    // liability categories offered (emoji-prefixed), asset categories absent
    expect(screen.getByRole('option', { name: '🏦 Mortgage' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Crypto/ })).not.toBeInTheDocument();
  });
});
