import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const todayISO = () => new Date().toISOString().slice(0, 10);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill('demo');
  await page.getByLabel(/password/i).fill('demo');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
}

test('rejects invalid credentials with a friendly error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill('demo');
  await page.getByLabel(/password/i).fill('wrong-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid username or password/i);
});

test('registers a new account from the login page', async ({ page }, testInfo) => {
  const username = `e2e-${testInfo.project.name === 'mobile-chromium' ? 'm' : 'd'}-${Date.now() % 100000}`;
  await page.goto('/login');
  await page.getByRole('link', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/register/);

  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/display name/i).fill('E2E Person');
  await page.getByLabel(/^password$/i).fill('longenough1');
  await page.getByLabel(/confirm password/i).fill('longenough1');
  await page.getByRole('button', { name: /create account/i }).click();

  // lands signed-in on an empty dashboard
  await expect(page.getByText(/welcome back, e2e person/i)).toBeVisible();
  await expect(page.getByText(/no history yet/i)).toBeVisible();

  // duplicate registration is rejected
  await page.goto('/settings');
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/^password$/i).fill('longenough1');
  await page.getByLabel(/confirm password/i).fill('longenough1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('alert')).toContainText(/already taken/i);
});

test('logs in and renders the dashboard with an interactive graph', async ({ page }) => {
  await login(page);

  // Summary cards (scoped to main — nav items share these labels)
  const main = page.locator('main');
  await expect(main.getByText('Net worth', { exact: false }).first()).toBeVisible();
  await expect(main.getByText('Assets', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Liabilities', { exact: true }).first()).toBeVisible();

  // Graph renders an SVG area path from seeded history
  const chart = page.getByRole('img', { name: /net worth history chart/i });
  await expect(chart).toBeVisible();
  await expect(chart.locator('svg path').first()).toBeVisible();

  // Range presets, including the extended 10Y/20Y options
  const rangeGroup = page.getByRole('group', { name: /history range/i });
  for (const label of ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y', '20Y', 'All']) {
    await expect(rangeGroup.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await rangeGroup.getByRole('button', { name: '1Y', exact: true }).click();
  await expect(rangeGroup.getByRole('button', { name: '1Y', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('svg path').first()).toBeVisible();

  // Full-screen graph mode
  await page.getByRole('button', { name: /view graph full screen/i }).click();
  await expect(page.getByRole('button', { name: /exit full screen/i })).toBeVisible();
  await expect(page.getByText(/welcome back/i)).not.toBeVisible();
  await page.getByRole('button', { name: /exit full screen/i }).click();
  await expect(page.getByText(/welcome back/i)).toBeVisible();
});

test('creates an asset and shows it grouped by class', async ({ page }, testInfo) => {
  const name = `E2E Fund ${testInfo.project.name}`;
  await login(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: /add asset/i }).click();

  const dialog = page.getByRole('dialog', { name: /add asset/i });
  await dialog.getByLabel(/category/i).selectOption('investments');
  await dialog.getByLabel(/^name$/i).fill(name);
  await dialog.getByLabel(/^value$/i).fill('1234.56');
  await dialog.getByRole('button', { name: /^add$/i }).click();

  const row = page.getByRole('button', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/1,234\.56/);
  await expect(page.getByRole('region', { name: 'Stock investments' })).toBeVisible();
});

test('creates a liability mirroring the asset flow', async ({ page }, testInfo) => {
  const name = `E2E Loan ${testInfo.project.name}`;
  await login(page);
  await page.goto('/liabilities');
  await page.getByRole('button', { name: /add liability/i }).click();

  const dialog = page.getByRole('dialog', { name: /add liability/i });
  await dialog.getByLabel(/category/i).selectOption('loan');
  await dialog.getByLabel(/^name$/i).fill(name);
  await dialog.getByLabel(/^value$/i).fill('500.00');
  await dialog.getByRole('button', { name: /^add$/i }).click();

  const row = page.getByRole('button', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/500\.00/);
});

test('executes a recurring transaction automatically', async ({ page }, testInfo) => {
  const assetName = `E2E Recurring Target ${testInfo.project.name}`;
  await login(page);

  // Target asset at 100.00
  await page.goto('/assets');
  await page.getByRole('button', { name: /add asset/i }).click();
  const assetDialog = page.getByRole('dialog', { name: /add asset/i });
  await assetDialog.getByLabel(/^name$/i).fill(assetName);
  await assetDialog.getByLabel(/^value$/i).fill('100.00');
  await assetDialog.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('button', { name: new RegExp(assetName) })).toBeVisible();

  // Schedule +50.00 daily, due today → the 1s job tick applies it
  await page.goto('/recurring');
  await page.getByRole('button', { name: /add schedule/i }).click();
  const dialog = page.getByRole('dialog', { name: /add schedule/i });
  await dialog.getByLabel(/^name$/i).fill(`E2E Deposit ${testInfo.project.name}`);
  await dialog.getByLabel(/applies to/i).selectOption('asset');
  await dialog.getByLabel(/^asset$/i).selectOption({ label: assetName });
  await dialog.getByLabel(/amount/i).fill('50.00');
  await dialog.getByLabel(/cadence/i).selectOption('daily');
  await dialog.getByLabel(/next run/i).fill(todayISO());
  await dialog.getByRole('button', { name: /add schedule/i }).click();

  await expect(page.getByText(`E2E Deposit ${testInfo.project.name}`)).toBeVisible();

  // Engine applies the occurrence; asset becomes 150.00
  await page.goto('/assets');
  const row = page.getByRole('button', { name: new RegExp(assetName) });
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(assetName) })).toContainText(/150\.00/);
  }).toPass({ timeout: 20_000 });
  await expect(row).toContainText(/150\.00/);
});

test('verifies a market symbol before saving the asset', async ({ page }, testInfo) => {
  const name = `E2E Verified ETF ${testInfo.project.name}`;
  await login(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: /add asset/i }).click();

  const dialog = page.getByRole('dialog', { name: /add asset/i });
  await dialog.getByLabel(/category/i).selectOption('investments');
  await dialog.getByLabel(/^name$/i).fill(name);
  await dialog.getByLabel(/valuation/i).selectOption('market');
  await dialog.getByLabel(/symbol/i).fill('vwrl');
  await dialog.getByLabel(/quantity/i).fill('5');

  // Saving before verification is blocked with a clear message
  await dialog.getByRole('button', { name: /^add$/i }).click();
  await expect(dialog.getByRole('alert')).toContainText(/verify the symbol/i);

  // Verify resolves the ticker to the instrument name
  await dialog.getByRole('button', { name: /^verify$/i }).click();
  await expect(dialog.getByRole('status')).toContainText('VWRL — Vanguard FTSE All-World UCITS ETF');

  await dialog.getByRole('button', { name: /^add$/i }).click();
  const row = page.getByRole('button', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('VWRL × 5');
});

test('creates a precious metals asset with a metal sub-selection', async ({ page }, testInfo) => {
  const name = `E2E Bullion ${testInfo.project.name}`;
  await login(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: /add asset/i }).click();

  const dialog = page.getByRole('dialog', { name: /add asset/i });
  await dialog.getByLabel(/category/i).selectOption('precious_metals');
  await dialog.getByLabel(/^metal$/i).selectOption('platinum');
  await dialog.getByLabel(/^name$/i).fill(name);
  await dialog.getByLabel(/^value$/i).fill('4200.00');
  await dialog.getByRole('button', { name: /^add$/i }).click();

  const row = page.getByRole('button', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Platinum');
  await expect(page.getByRole('region', { name: 'Precious metals' })).toBeVisible();
});

test('shows the age overlay on long ranges once a birth year is set', async ({ page }) => {
  await login(page);

  await page.goto('/settings');
  await page.getByRole('button', { name: /calculation/i }).click();
  await page.getByLabel(/birth year/i).fill('1990');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('status')).toContainText(/saved/i);

  await page.goto('/');
  const rangeGroup = page.getByRole('group', { name: /history range/i });

  // 5Y → every age (seeded history spans 6 years: ages 32..36 visible)
  await rangeGroup.getByRole('button', { name: '5Y', exact: true }).click();
  await expect(page.getByText('Age 33')).toBeVisible();
  await expect(page.getByText('Age 36')).toBeVisible();
  await expect(page.getByText(/^Age \d+$/)).toHaveCount(5);

  // 10Y → every 2nd age (even ages only)
  await rangeGroup.getByRole('button', { name: '10Y', exact: true }).click();
  await expect(page.getByText('Age 36')).toBeVisible();
  await expect(page.getByText('Age 33')).not.toBeVisible();

  // All → every 5th age (35 qualifies, 36 does not)
  await rangeGroup.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText('Age 35')).toBeVisible();
  await expect(page.getByText('Age 36')).not.toBeVisible();

  // short ranges → no age markers
  await rangeGroup.getByRole('button', { name: '1M', exact: true }).click();
  await expect(page.getByText(/^Age \d+$/)).toHaveCount(0);
});

test('edits a historic entry from settings and the holding updates', async ({ page }, testInfo) => {
  const name = `E2E Editable ${testInfo.project.name}`;
  await login(page);

  // Create an asset whose entry we will edit
  await page.goto('/assets');
  await page.getByRole('button', { name: /add asset/i }).click();
  const dialog = page.getByRole('dialog', { name: /add asset/i });
  await dialog.getByLabel(/^name$/i).fill(name);
  await dialog.getByLabel(/^value$/i).fill('1000.00');
  await dialog.getByRole('button', { name: /^add$/i }).click();
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();

  // Settings → History sub page → Historic entries, filtered to that holding
  await page.goto('/settings');
  await page.getByRole('button', { name: /^history$/i }).click();
  await page.getByLabel(/^show$/i).selectOption({ label: `💵 Cash — ${name}` });
  await page.getByRole('button', { name: new RegExp(`edit ${name} entry`, 'i') }).click();

  const editDialog = page.getByRole('dialog', { name: new RegExp(`edit entry — ${name}`, 'i') });
  await editDialog.getByLabel(/^value$/i).fill('2222.22');
  await editDialog.getByRole('button', { name: /save changes/i }).click();
  await expect(editDialog).not.toBeVisible();
  await expect(page.getByText(/2,222\.22/)).toBeVisible();

  // The holding reflects the edited value
  await page.goto('/assets');
  await expect(page.getByRole('button', { name: new RegExp(name) })).toContainText(/2,222\.22/);
});

test('records legacy wealth and sees it on the All graph', async ({ page }) => {
  await login(page);
  await page.goto('/settings/history');
  await page.getByLabel(/^date$/i).fill('2015-03-01');
  await page.getByLabel(/net worth/i).fill('12345');
  await page.getByRole('button', { name: /add point/i }).click();
  await expect(page.getByText('2015-03-01')).toBeVisible();

  // The All range now reaches back to the legacy point
  const history = await page.evaluate(async () => {
    const res = await (await fetch('/api/dashboard/history?range=ALL')).json();
    return res.points[0] as { date: string; netWorthMinor: number };
  });
  expect(history.date).toBe('2015-03-01');
  expect(history.netWorthMinor).toBe(1_234_500);

  // clean up so reruns of the seeded demo stay tidy
  await page.goto('/settings/history');
  await page.getByRole('button', { name: /delete legacy entry 2015-03-01/i }).click();
  await expect(page.getByText('2015-03-01')).not.toBeVisible();
});

test('net worth equals assets minus liabilities', async ({ page }) => {
  await login(page);
  const summary = await page.evaluate(async () => {
    const res = await fetch('/api/dashboard/summary');
    return res.json() as Promise<{ assetsMinor: number; liabilitiesMinor: number; netWorthMinor: number }>;
  });
  expect(summary.netWorthMinor).toBe(summary.assetsMinor - summary.liabilitiesMinor);
  expect(summary.assetsMinor).toBeGreaterThan(0);
});

test('changes currency in settings and signs out', async ({ page }) => {
  await login(page);
  await page.goto('/settings/calculation');
  await page.getByLabel(/currency/i).selectOption('EUR');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('status')).toContainText(/saved/i);

  await page.goto('/');
  await expect(page.getByText('€', { exact: false }).first()).toBeVisible();

  // restore and sign out (sign out lives on the User account sub page)
  await page.goto('/settings/calculation');
  await page.getByLabel(/currency/i).selectOption('USD');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByRole('status')).toContainText(/saved/i);

  await page.getByRole('button', { name: /user account/i }).click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  // session is gone server-side
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('dashboard renders within a sane performance budget', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill('demo');
  await page.getByLabel(/password/i).fill('demo');
  const start = Date.now();
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('img', { name: /net worth history chart/i })).toBeVisible();
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(5_000);

  const t2 = Date.now();
  await page.getByRole('group', { name: /history range/i })
    .getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByRole('img', { name: /net worth history chart/i })).toBeVisible();
  expect(Date.now() - t2).toBeLessThan(2_000);
});
