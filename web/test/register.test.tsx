import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const newUser = { id: 2, username: 'newbie', displayName: 'newbie', currency: 'USD', birthYear: null };

describe('create account', () => {
  it('is reachable from the login page', async () => {
    mockFetch([[/\/api\/auth\/me/, { error: 'Not authenticated' }, 401]]);
    renderWithProviders(<App />, { route: '/login' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: /create account/i }));
    expect(await screen.findByText(/create your account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('submits the registration and posts to the register endpoint', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/me/, { error: 'Not authenticated' }, 401],
      [/\/api\/auth\/register/, { user: newUser }],
      [/\/api\/dashboard\/summary/, {
        assetsMinor: 0, liabilitiesMinor: 0, netWorthMinor: 0, currency: 'USD',
        assetsByCategory: [], liabilitiesByCategory: [],
      }],
      [/\/api\/dashboard\/history/, { range: '6M', points: [] }],
    ]);
    renderWithProviders(<App />, { route: '/register' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'newbie');
    await user.type(screen.getByLabelText(/^password$/i), 'longenough1');
    await user.type(screen.getByLabelText(/confirm password/i), 'longenough1');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.includes('/api/auth/register'));
      expect(post).toBeDefined();
      expect(post!.body).toEqual({ username: 'newbie', password: 'longenough1' });
    });
  });

  it('blocks mismatched passwords client-side', async () => {
    const calls = mockFetch([[/\/api\/auth\/me/, { error: 'Not authenticated' }, 401]]);
    renderWithProviders(<App />, { route: '/register' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'newbie');
    await user.type(screen.getByLabelText(/^password$/i), 'longenough1');
    await user.type(screen.getByLabelText(/confirm password/i), 'different1');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(calls.some((c) => c.url.includes('/register'))).toBe(false);
  });

  it('surfaces server-side errors (username taken)', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { error: 'Not authenticated' }, 401],
      [/\/api\/auth\/register/, { error: 'That username is already taken' }, 409],
    ]);
    renderWithProviders(<App />, { route: '/register' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'demo');
    await user.type(screen.getByLabelText(/^password$/i), 'longenough1');
    await user.type(screen.getByLabelText(/confirm password/i), 'longenough1');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken/i);
  });
});
