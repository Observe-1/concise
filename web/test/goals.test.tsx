import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

const goal = {
  id: 1, name: 'Emergency fund', targetMinor: 50_000_00, targetDate: null, notes: null,
  currentMinor: 30_000_00, progressPct: 60, etaISO: '2027-01-01', suggestedMonthlyMinor: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('goals on the dashboard', () => {
  it('shows nothing when there are no goals', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, []],
    ]);
    renderWithProviders(<App />, { route: '/' });

    await screen.findByText(/net worth/i);
    expect(screen.queryByText('Goals')).not.toBeInTheDocument();
  });

  it('shows progress and ETA when a goal exists', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, [goal]],
    ]);
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText(/on track for 2027-01-01/i)).toBeInTheDocument();
  });
});

describe('goals settings', () => {
  it('creates a goal through the form', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, []],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add goal/i }));
    const dialog = await screen.findByRole('dialog', { name: /add goal/i });
    await user.type(within(dialog).getByLabelText(/^name$/i), 'House deposit');
    await user.type(within(dialog).getByLabelText(/target net worth/i), '20000');
    await user.click(within(dialog).getByRole('button', { name: /save goal/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/goals$/.test(c.url));
      expect(post!.body).toMatchObject({ name: 'House deposit', targetMinor: 2_000_000 });
    });
  });

  it('shows an empty state with no goals', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, []],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    expect(await screen.findByText(/no goals yet/i)).toBeInTheDocument();
  });

  it('creates a liability-payoff goal through the form', async () => {
    const loan = {
      id: 7, category: 'loan', name: 'Car loan', notes: null,
      currentValueMinor: 10_000_00, lastValuedAt: '2026-06-11T12:00:00.000Z', createdAt: '2024-06-11T12:00:00.000Z',
    };
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, []],
      [/\/api\/liabilities$/, [loan]],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add goal/i }));
    const dialog = await screen.findByRole('dialog', { name: /add goal/i });
    await user.type(within(dialog).getByLabelText(/^name$/i), 'Pay off car loan');
    await user.selectOptions(within(dialog).getByLabelText(/goal type/i), 'liability_payoff');
    await user.selectOptions(await within(dialog).findByLabelText(/^liability$/i), '7');
    await user.click(within(dialog).getByRole('button', { name: /save goal/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/goals$/.test(c.url));
      expect(post!.body).toMatchObject({ name: 'Pay off car loan', goalType: 'liability_payoff', liabilityId: 7 });
      expect((post!.body as { targetMinor?: number }).targetMinor).toBeUndefined();
    });
  });
});

describe('liability payoff goal display', () => {
  const payoffGoal = {
    id: 2, name: 'Pay off car loan', goalType: 'liability_payoff', targetMinor: 0,
    liabilityId: 7, liabilityName: 'Car loan', baselineMinor: 10_000_00,
    targetDate: null, notes: null, currentMinor: 6_000_00, progressPct: 40,
    etaISO: '2027-06-01', suggestedMonthlyMinor: null, createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('shows remaining-of-baseline framing on the dashboard card', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, [payoffGoal]],
    ]);
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText('Pay off car loan')).toBeInTheDocument();
    expect(screen.getByText(/US\$6,000\.00 left of US\$10,000\.00/)).toBeInTheDocument();
  });
});

describe('goal funding suggestion', () => {
  const netWorthGoalWithSuggestion = {
    ...goal, targetDate: '2027-01-01', suggestedMonthlyMinor: 1_500_00,
  };
  const payoffGoalWithSuggestion = {
    id: 2, name: 'Pay off car loan', goalType: 'liability_payoff', targetMinor: 0,
    liabilityId: 7, liabilityName: 'Car loan', baselineMinor: 10_000_00,
    targetDate: '2027-06-01', notes: null, currentMinor: 6_000_00, progressPct: 40,
    etaISO: '2027-06-01', suggestedMonthlyMinor: 500_00, createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('shows an informational line for a net-worth goal with no automate button', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, [netWorthGoalWithSuggestion]],
    ]);
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText(/save US\$1,500\.00\/mo to reach this by 2027-01-01/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /automate this payment/i })).not.toBeInTheDocument();
  });

  it('shows the informational line and an automate button for a payoff goal in Settings', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, [payoffGoalWithSuggestion]],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    expect(await screen.findByText(/pay an extra US\$500\.00\/mo to clear this by 2027-06-01/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /automate this payment/i })).toBeInTheDocument();
  });

  it('shows the informational line but no button for a payoff goal on the dashboard', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/dashboard\/summary/, summary],
      [/\/api\/dashboard\/history/, history],
      [/\/api\/goals/, [payoffGoalWithSuggestion]],
    ]);
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText(/pay an extra US\$500\.00\/mo to clear this by 2027-06-01/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /automate this payment/i })).not.toBeInTheDocument();
  });

  it('shows neither the line nor a button when there is no suggestion', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, [{ ...payoffGoalWithSuggestion, suggestedMonthlyMinor: null }]],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    await screen.findByText('Pay off car loan');
    expect(screen.queryByText(/pay an extra/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /automate this payment/i })).not.toBeInTheDocument();
  });

  it('automates the payoff payment with a one-click recurring schedule', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, [payoffGoalWithSuggestion]],
      [/\/api\/recurring$/, { id: 9 }, 201],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /automate this payment/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && /\/api\/recurring$/.test(c.url));
      expect(post!.body).toMatchObject({
        targetType: 'liability', targetId: 7, amountMinor: -500_00, cadence: 'monthly',
      });
      expect((post!.body as { nextRunOn: string }).nextRunOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(await screen.findByText(/automatic payment scheduled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /automate this payment/i })).not.toBeInTheDocument();
  });

  it('shows an error and keeps the button clickable when scheduling fails', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { user: demoUser }],
      [/\/api\/goals$/, [payoffGoalWithSuggestion]],
      [/\/api\/recurring$/, { error: 'Target liability not found' }, 400],
    ]);
    renderWithProviders(<App />, { route: '/settings/goals' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /automate this payment/i }));

    expect(await screen.findByText(/target liability not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /automate this payment/i })).toBeEnabled();
  });
});
