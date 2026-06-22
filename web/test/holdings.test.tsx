import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByText(/BTC × 0\.15 @ /)).toBeInTheDocument(); // market badge with price
    expect(screen.getByRole('button', { name: /refresh prices/i })).toBeInTheDocument();
    // precious metals class with metal sub-label
    expect(screen.getByRole('region', { name: 'Precious metals' })).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
  });

  it('shows a total figure at the top, summing every entry', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, assets],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    // 4,250.00 + 20,990.97 + 9,200.00 = 34,440.97, shown next to the heading.
    expect(await screen.findByLabelText(/total assets/i)).toHaveTextContent(/34,?440\.97/);
  });

  it('shows a recurring indicator badge with the schedule detail', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/recurring/, [
        {
          id: 5, name: 'Monthly savings', targetType: 'asset', targetId: 1,
          amountType: 'fixed', amountMinor: 50_000, percent: null, cadence: 'monthly',
          nextRunOn: '2026-07-01', lastRunOn: null, active: true,
        },
      ]],
      [/\/api\/assets$/, assets],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    await screen.findByText('Checking');
    // Checking (id 1) has a +500.00/mo schedule → a recurring badge with detail.
    const badge = await screen.findByText(/\+.*500\.00\/mo/);
    expect(badge.getAttribute('title')).toContain('Monthly savings');
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
      [/\/api\/market\/instruments/, [
        { symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF', currency: 'GBP', exchange: 'London Stock Exchange' },
      ]],
      [/\/api\/market\/lookup\?symbol=VWRL/, {
        symbol: 'VWRL', name: 'Vanguard FTSE All-World UCITS ETF', currency: 'GBP',
        exchange: 'London Stock Exchange', priceMinor: 110_00,
      }],
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

    // verify resolves and shows the instrument name, exchange and currency
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/VWRL — Vanguard FTSE All-World UCITS ETF/);
    expect(screen.getByText(/London Stock Exchange · priced in GBP/)).toBeInTheDocument();
    expect(screen.getByText(/current price/i)).toHaveTextContent(/110\.00/);

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

  it('reveals a present-day value field once a backdate is set and sends it', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets$/, []],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add asset/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Painting');
    await user.type(screen.getByLabelText(/^value$/i), '5000');

    // The present-day field is hidden until a backdate is chosen.
    expect(screen.queryByLabelText(/present-day value/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/backdate/i), { target: { value: '2020-01-01' } });
    await user.type(await screen.findByLabelText(/present-day value/i), '12000');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/assets$/.test(c.url));
      expect(post!.body).toMatchObject({
        name: 'Painting', valueMinor: 500_000, asOf: '2020-01-01', presentValueMinor: 1_200_000,
      });
    });
  });

  it('opens a detail popup with a line graph, composition pie and mode toggles', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets\/1\/history/, {
        range: '1Y', trendWindow: 91, points: [
          { date: '2026-05-01', assetsMinor: 4_000_00, liabilitiesMinor: 0, netWorthMinor: 4_000_00, trendMinor: 4_000_00 },
          { date: '2026-06-01', assetsMinor: 4_250_00, liabilitiesMinor: 0, netWorthMinor: 4_250_00, trendMinor: 4_200_00 },
        ],
      }],
      [/\/api\/assets\/1\/prediction/, {
        range: '1Y', today: '2026-06-01', points: [
          { date: '2026-06-01', assetsMinor: 4_250_00, liabilitiesMinor: 0, netWorthMinor: 4_250_00, trendMinor: 4_250_00 },
          { date: '2026-12-01', assetsMinor: 5_000_00, liabilitiesMinor: 0, netWorthMinor: 5_000_00, trendMinor: 5_000_00 },
        ],
      }],
      [/\/api\/assets\/1\/composition/, {
        side: 'asset', selectedMinor: 4_250_00, otherAssetsMinor: 20_000_00, otherLiabilitiesMinor: 8_000_00,
      }],
      [/\/api\/assets$/, [assets[0]]],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByText('Checking'));

    // The wide edit popup shows both chart sections, the pie key and the modes.
    const dialog = await screen.findByRole('dialog', { name: /edit checking/i });
    expect(within(dialog).getByText(/share of net worth/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/value over time/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Other assets')).toBeInTheDocument();
    expect(within(dialog).getByText('Other liabilities')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /prediction/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /view as/i })).toBeInTheDocument();

    // The history and composition were fetched on open.
    await waitFor(() => {
      expect(calls.some((c) => /\/api\/assets\/1\/history/.test(c.url))).toBe(true);
      expect(calls.some((c) => /\/api\/assets\/1\/composition/.test(c.url))).toBe(true);
    });

    // Max is offered until prediction mode, which then fetches the projection.
    const ranges = within(dialog).getByRole('group', { name: /history range/i });
    expect(within(ranges).getByRole('button', { name: 'Max' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /prediction/i }));
    await waitFor(() => {
      expect(calls.some((c) => /\/api\/assets\/1\/prediction\?range=/.test(c.url))).toBe(true);
    });
    expect(within(ranges).queryByRole('button', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('never requests a prediction for the unbounded Max range', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/assets\/1\/history/, { range: 'ALL', trendWindow: 91, points: [
        { date: '2026-05-01', assetsMinor: 4_000_00, liabilitiesMinor: 0, netWorthMinor: 4_000_00, trendMinor: 4_000_00 },
        { date: '2026-06-01', assetsMinor: 4_250_00, liabilitiesMinor: 0, netWorthMinor: 4_250_00, trendMinor: 4_200_00 },
      ] }],
      [/\/api\/assets\/1\/prediction/, { range: '1Y', today: '2026-06-01', points: [] }],
      [/\/api\/assets\/1\/composition/, {
        side: 'asset', selectedMinor: 4_250_00, otherAssetsMinor: 20_000_00, otherLiabilitiesMinor: 8_000_00,
      }],
      [/\/api\/assets$/, [assets[0]]],
    ]);
    renderWithProviders(<App />, { route: '/assets' });

    const user = userEvent.setup();
    await user.click(await screen.findByText('Checking'));
    const dialog = await screen.findByRole('dialog', { name: /edit checking/i });

    // Select Max, then enter prediction: the ALL range must never be requested.
    await user.click(within(dialog).getByRole('button', { name: 'Max' }));
    await user.click(within(dialog).getByRole('button', { name: /prediction/i }));

    await waitFor(() => {
      expect(calls.some((c) => /\/api\/assets\/1\/prediction\?range=/.test(c.url))).toBe(true);
    });
    expect(calls.some((c) => /\/api\/assets\/1\/prediction\?range=ALL/.test(c.url))).toBe(false);
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
    // Total figure next to the heading (its value coincides with the lone entry).
    expect(screen.getByLabelText(/total liabilities/i)).toHaveTextContent(/248,?000\.00/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /add liability/i }));
    const dialog = await screen.findByRole('dialog', { name: /add liability/i });
    expect(dialog).toBeInTheDocument();
    // liability categories offered (emoji-prefixed), asset categories absent
    expect(screen.getByRole('option', { name: '🏦 Mortgage' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Crypto/ })).not.toBeInTheDocument();
  });

  it('sends an interest rate when adding a liability', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/liabilities\/changes/, []],
      [/\/api\/liabilities$/, []],
    ]);
    renderWithProviders(<App />, { route: '/liabilities' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add liability/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Car loan');
    await user.type(screen.getByLabelText(/^value$/i), '10000');
    await user.type(screen.getByLabelText(/interest rate/i), '5.5');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/liabilities$/.test(c.url));
      expect(post!.body).toMatchObject({ name: 'Car loan', valueMinor: 1_000_000, interestRatePct: 5.5 });
    });
  });

  it('marks a zero-balance liability as paid off', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/liabilities\/changes/, [{ id: 9, changePct: -100 }]],
      [/\/api\/liabilities$/, [{
        id: 9, category: 'loan', name: 'Car loan', notes: null, metal: null,
        valuationMode: 'manual', marketSymbol: null, quantity: null, currentValueMinor: 0,
        lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
      }]],
    ]);
    renderWithProviders(<App />, { route: '/liabilities' });

    expect(await screen.findByText('Car loan')).toBeInTheDocument();
    expect(screen.getByText(/paid off/i)).toBeInTheDocument();
  });
});
