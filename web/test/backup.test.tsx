import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.js';
import { mockFetch, renderWithProviders } from './helpers.js';

const demoUser = { id: 1, username: 'demo', displayName: 'Demo User', currency: 'USD', birthYear: null };

const settings = { namePrefix: 'concise-backup', keepCount: 10, autoEnabled: true, intervalHours: 24 };

const existing = {
  name: 'concise-backup-2026-06-15T12-00-00-000Z.db',
  sizeBytes: 24_576,
  createdAt: '2026-06-15T12:00:00.000Z',
};

const overview = { settings, location: '/data/backups', backups: [existing] };

const runResult = {
  backup: { name: 'concise-backup-2026-06-15T13-00-00-000Z.db', sizeBytes: 24_576, createdAt: '2026-06-15T13:00:00.000Z' },
  backups: [
    { name: 'concise-backup-2026-06-15T13-00-00-000Z.db', sizeBytes: 24_576, createdAt: '2026-06-15T13:00:00.000Z' },
    existing,
  ],
};

function mountBackup() {
  // Order matters: the more specific /run and /settings routes must precede the
  // generic /api/backup overview route.
  return mockFetch([
    [/\/api\/auth\/me/, { user: demoUser }],
    [/\/api\/backup\/run/, runResult, 201],
    [/\/api\/backup\/settings/, { ...settings, keepCount: 5 }],
    [/\/api\/backup/, overview],
  ]);
}

describe('backup settings sub page', () => {
  it('explains backups and lists existing ones', async () => {
    mountBackup();
    renderWithProviders(<App />, { route: '/settings/backup' });

    expect(await screen.findByText(/how backups work/i)).toBeInTheDocument();
    // The existing backup is listed with its name and size (await the query).
    expect(await screen.findByText(existing.name)).toBeInTheDocument();
    expect(screen.getByText('24 KB')).toBeInTheDocument();
    // The location is surfaced.
    expect(screen.getByText('/data/backups')).toBeInTheDocument();
  });

  it('runs a manual backup and shows a green success note', async () => {
    const calls = mountBackup();
    renderWithProviders(<App />, { route: '/settings/backup' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /back up now/i }));

    // POST went out, and the validated success is confirmed in a status note.
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/backup/run'))).toBe(true);
    });
    const note = await screen.findByText(/backup created and verified/i);
    expect(note).toHaveTextContent(runResult.backup.name);
    expect(note).toHaveAttribute('role', 'status');
  });

  it('shows the retention note covering manual and automatic backups', async () => {
    mountBackup();
    renderWithProviders(<App />, { route: '/settings/backup' });

    expect(await screen.findByText(/includes both manual and automatic/i)).toBeInTheDocument();
  });

  it('saves changed settings', async () => {
    const calls = mountBackup();
    renderWithProviders(<App />, { route: '/settings/backup' });

    const user = userEvent.setup();
    const keep = await screen.findByLabelText(/backups to keep/i);
    await user.clear(keep);
    await user.type(keep, '5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/api/backup/settings'));
      expect(patch).toBeTruthy();
      expect((patch!.body as { keepCount: number }).keepCount).toBe(5);
    });
    expect(await screen.findByText(/backup settings saved/i)).toBeInTheDocument();
  });
});
