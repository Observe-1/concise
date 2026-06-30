import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

describe('export settings section', () => {
  it('renders a download link to the CSV endpoint', async () => {
    mockFetch([[/\/api\/auth\/me/, { user: demoUser }]]);
    renderWithProviders(<App />, { route: '/settings/export' });

    const link = await screen.findByRole('link', { name: /download csv/i });
    expect(link).toHaveAttribute('href', '/api/export/valuations.csv');
  });
});
