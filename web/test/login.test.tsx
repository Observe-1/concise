import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD' };

describe('login flow', () => {
  it('shows the login form with accessible labels for anonymous visitors', async () => {
    mockFetch([[/\/api\/auth\/me/, { error: 'Not authenticated' }, 401]]);
    renderWithProviders(<App />, { route: '/login' });

    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/demo \/ demo/i)).toBeInTheDocument();
  });

  it('submits credentials and posts to the login endpoint', async () => {
    const calls = mockFetch([
      [/\/api\/auth\/login/, { user: demoUser }],
      [/\/api\/auth\/me/, { error: 'Not authenticated' }, 401],
      [/\/api\/dashboard\/summary/, {
        assetsMinor: 0, liabilitiesMinor: 0, netWorthMinor: 0, currency: 'USD',
        assetsByCategory: [], liabilitiesByCategory: [],
      }],
      [/\/api\/dashboard\/history/, { range: '6M', points: [] }],
    ]);
    renderWithProviders(<App />, { route: '/login' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'demo');
    await user.type(screen.getByLabelText(/password/i), 'demo');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      const login = calls.find((c) => c.url.includes('/api/auth/login'));
      expect(login).toBeDefined();
      expect(login!.body).toEqual({ username: 'demo', password: 'demo' });
    });
  });

  it('surfaces authentication errors', async () => {
    mockFetch([
      [/\/api\/auth\/me/, { error: 'Not authenticated' }, 401],
      [/\/api\/auth\/login/, { error: 'Invalid username or password' }, 401],
    ]);
    renderWithProviders(<App />, { route: '/login' });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/username/i), 'demo');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid username or password/i);
  });

  it('redirects anonymous users from protected routes to login', async () => {
    mockFetch([[/\/api\/auth\/me/, { error: 'Not authenticated' }, 401]]);
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
