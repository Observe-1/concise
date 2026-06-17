import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, csrf, loginAgent, makeTestWorld, type TestWorld } from '../helpers.js';
import { PROPERTY_COUNTRIES, propertyValueMinor, vehicleValueMinor } from '../../src/modules/market/models.js';
import { runDueRecurring } from '../../src/modules/recurring/service.js';

describe('assets & liabilities API', () => {
  let world: TestWorld;
  let agent: Awaited<ReturnType<typeof loginAgent>>;

  beforeEach(async () => {
    world = makeTestWorld();
    createUser(world.ctx, 'alice', 'password123');
    agent = await loginAgent(world.app);
  });

  it('requires authentication', async () => {
    const fresh = makeTestWorld();
    await fresh.app; // silence unused
    const res = await csrf((await import('supertest')).default(fresh.app).post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: 1 });
    expect(res.status).toBe(401);
  });

  it('creates, lists, updates, revalues and deletes an asset', async () => {
    const created = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Checking', valueMinor: 123_45 });
    expect(created.status).toBe(201);
    expect(created.body.currentValueMinor).toBe(123_45);
    const id = created.body.id;

    const list = await agent.get('/api/assets');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Checking');

    const patched = await csrf(agent.patch(`/api/assets/${id}`)).send({ name: 'Main checking' });
    expect(patched.body.name).toBe('Main checking');

    const revalued = await csrf(agent.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 200_00 });
    expect(revalued.status).toBe(201);
    expect(revalued.body.currentValueMinor).toBe(200_00);

    const detail = await agent.get(`/api/assets/${id}`);
    expect(detail.body.valuations).toHaveLength(2);
    expect(detail.body.valuations[0].valueMinor).toBe(200_00); // newest first

    await csrf(agent.delete(`/api/assets/${id}`)).expect(204);
    const after = await agent.get('/api/assets');
    expect(after.body).toHaveLength(0);
  });

  it('rejects invalid payloads', async () => {
    await csrf(agent.post('/api/assets'))
      .send({ category: 'spaceships', name: 'X', valueMinor: 1 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: '', valueMinor: 1 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: -5 }).expect(400);
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', valueMinor: 10.5 }).expect(400);
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'X' }).expect(400);
  });

  it('creates market-valued assets priced by the provider', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'crypto', name: 'BTC stash', valuationMode: 'market', marketSymbol: 'btc', quantity: 0.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.marketSymbol).toBe('BTC');
    const expected = Math.round(world.ctx.prices.getPriceMinor('BTC', '2026-06-11')! * 0.5);
    expect(res.body.currentValueMinor).toBe(expected);
    expect(res.body.historicalPriceMissing).toBe(false);

    await csrf(agent.post('/api/assets'))
      .send({ category: 'crypto', name: 'X', valuationMode: 'market' }).expect(400);
  });

  it('cash entries are always manual — the market method is rejected', async () => {
    await csrf(agent.post('/api/assets')).send({
      category: 'cash', name: 'X', valuationMode: 'market', marketSymbol: 'BTC', quantity: 1,
    }).expect(400);

    // moving a market-valued asset into cash is rejected
    const market = await csrf(agent.post('/api/assets')).send({
      category: 'crypto', name: 'BTC', valuationMode: 'market', marketSymbol: 'BTC', quantity: 1,
    });
    await csrf(agent.patch(`/api/assets/${market.body.id}`)).send({ category: 'cash' }).expect(400);

    // switching an existing cash asset to market valuation is rejected
    const cash = await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'C', valueMinor: 100 });
    await csrf(agent.patch(`/api/assets/${cash.body.id}`))
      .send({ valuationMode: 'market', marketSymbol: 'BTC', quantity: 1 }).expect(400);
  });

  it('property and vehicle entries cannot use the market method', async () => {
    await csrf(agent.post('/api/assets')).send({
      category: 'property', name: 'Flat', valuationMode: 'market', marketSymbol: 'VWRL', quantity: 1,
    }).expect(400);
    await csrf(agent.post('/api/assets')).send({
      category: 'vehicles', name: 'Car', valuationMode: 'market', marketSymbol: 'VWRL', quantity: 1,
    }).expect(400);

    // switching an existing property entry to market valuation is rejected
    const home = await csrf(agent.post('/api/assets')).send({ category: 'property', name: 'Home', valueMinor: 100 });
    await csrf(agent.patch(`/api/assets/${home.body.id}`))
      .send({ valuationMode: 'market', marketSymbol: 'VWRL', quantity: 1 }).expect(400);

    // moving a market-valued asset into property/vehicles is rejected
    const market = await csrf(agent.post('/api/assets')).send({
      category: 'investments', name: 'Fund', valuationMode: 'market', marketSymbol: 'VWRL', quantity: 1,
    });
    await csrf(agent.patch(`/api/assets/${market.body.id}`)).send({ category: 'vehicles' }).expect(400);
  });

  it('reports per-holding percent change over a range', async () => {
    // Backdated a year ago at 100.00, then updated today to 150.00.
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Savings', valueMinor: 100_00, asOf: '2025-06-11' });
    const list = await agent.get('/api/assets');
    const id = list.body[0].id as number;
    await csrf(agent.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 150_00 });

    // 1M ago the base was still 100.00 → +50%.
    const oneM = await agent.get('/api/assets/changes?range=1M');
    expect(oneM.body).toEqual([{ id, changePct: 50 }]);

    // 5 years ago the asset did not exist yet → N/A.
    const fiveY = await agent.get('/api/assets/changes?range=5Y');
    expect(fiveY.body).toEqual([{ id, changePct: null }]);

    // MAX measures from the first valuation → +50%.
    const max = await agent.get('/api/assets/changes?range=ALL');
    expect(max.body).toEqual([{ id, changePct: 50 }]);

    await agent.get('/api/assets/changes?range=NOPE').expect(400);
  });

  it('creates precious metal assets with a metal sub-selection', async () => {
    const res = await csrf(agent.post('/api/assets')).send({
      category: 'precious_metals', name: 'Krugerrands', metal: 'gold', valueMinor: 950_000,
    });
    expect(res.status).toBe(201);
    expect(res.body.metal).toBe('gold');
    expect(res.body.category).toBe('precious_metals');

    // metal is rejected on other categories
    await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'X', metal: 'gold', valueMinor: 1 }).expect(400);
    // unknown metals rejected
    await csrf(agent.post('/api/assets'))
      .send({ category: 'precious_metals', name: 'X', metal: 'copper', valueMinor: 1 }).expect(400);

    // moving the asset to another category clears the metal
    const moved = await csrf(agent.patch(`/api/assets/${res.body.id}`)).send({ category: 'other' });
    expect(moved.body.metal).toBeNull();
  });

  describe('backdating', () => {
    it('records the first valuation on the chosen past date and rebuilds history', async () => {
      const res = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Old savings', valueMinor: 5_000_00, asOf: '2026-01-15' });
      expect(res.status).toBe(201);

      const detail = await agent.get(`/api/assets/${res.body.id}`);
      expect(detail.body.valuations[0].recordedAt).toBe('2026-01-15T12:00:00.000Z');

      const snaps = world.ctx.db
        .prepare('SELECT snapshot_date, assets_minor FROM snapshots ORDER BY snapshot_date')
        .all() as { snapshot_date: string; assets_minor: number }[];
      expect(snaps[0]).toEqual({ snapshot_date: '2026-01-15', assets_minor: 5_000_00 });
      expect(snaps[snaps.length - 1]!.snapshot_date).toBe('2026-06-11');
      expect(snaps).toHaveLength(148); // daily rows from 15 Jan to 11 Jun
      expect(snaps.every((s) => s.assets_minor === 5_000_00)).toBe(true);
    });

    it('backfills daily prices for backdated market assets (accurate per date)', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'Old BTC', valuationMode: 'market',
        marketSymbol: 'BTC', quantity: 0.5, asOf: '2025-03-01',
      });
      expect(res.status).toBe(201);
      expect(res.body.historicalPriceMissing).toBe(false);

      const detail = await agent.get(`/api/assets/${res.body.id}`);
      const valuations = detail.body.valuations as { valueMinor: number; recordedAt: string }[];
      // one valuation per day from the backdate through today
      expect(valuations).toHaveLength(468); // 2025-03-01 → 2026-06-11 inclusive
      const oldest = valuations[valuations.length - 1]!;
      expect(oldest.recordedAt).toBe('2025-03-01T12:00:00.000Z');
      expect(oldest.valueMinor).toBe(Math.round(world.ctx.prices.getPriceMinor('BTC', '2025-03-01')! * 0.5));
      expect(valuations[0]!.valueMinor).toBe(Math.round(world.ctx.prices.getPriceMinor('BTC', '2026-06-11')! * 0.5));

      // history is priced per date — snapshots differ month to month
      const snap = (date: string) => world.ctx.db
        .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
        .get(date) as { assets_minor: number };
      expect(snap('2025-04-01').assets_minor).toBe(Math.round(world.ctx.prices.getPriceMinor('BTC', '2025-04-01')! * 0.5));
      expect(snap('2025-09-01').assets_minor).toBe(Math.round(world.ctx.prices.getPriceMinor('BTC', '2025-09-01')! * 0.5));
      expect(snap('2025-04-01').assets_minor).not.toBe(snap('2025-09-01').assets_minor);
    });

    it('flags entries whose historical prices cannot be found', async () => {
      // The simulated provider has no data before 2020-01-01.
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'investments', name: 'Ancient holding', valuationMode: 'market',
        marketSymbol: 'VWRL', quantity: 10, asOf: '2019-11-15',
      });
      expect(res.status).toBe(201);
      expect(res.body.historicalPriceMissing).toBe(true);

      // valuations only exist from the provider's data start onwards
      const oldest = world.ctx.db
        .prepare(
          `SELECT MIN(recorded_at) AS first FROM asset_valuations WHERE asset_id = ?`,
        )
        .get(res.body.id) as { first: string };
      expect(oldest.first).toBe('2020-01-01T12:00:00.000Z');

      // assets priced from their data start are not flagged
      const list = await agent.get('/api/assets');
      const flagged = (list.body as { name: string; historicalPriceMissing: boolean }[])
        .find((a) => a.name === 'Ancient holding');
      expect(flagged?.historicalPriceMissing).toBe(true);
    });

    it('works for liabilities and affects net worth from that date', async () => {
      await csrf(agent.post('/api/liabilities'))
        .send({ category: 'loan', name: 'Old loan', valueMinor: 2_000_00, asOf: '2026-03-01' });
      const snap = world.ctx.db
        .prepare("SELECT * FROM snapshots WHERE snapshot_date = '2026-03-01'")
        .get() as { liabilities_minor: number; net_worth_minor: number };
      expect(snap.liabilities_minor).toBe(2_000_00);
      expect(snap.net_worth_minor).toBe(-2_000_00);
    });

    it('records an optional present-day value alongside the historic one', async () => {
      // Backdated to 1 Jun at 100.00, worth 200.00 today (11 Jun).
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'cash', name: 'Painting', valueMinor: 100_00,
        presentValueMinor: 200_00, asOf: '2026-06-01',
      });
      expect(res.status).toBe(201);
      expect(res.body.currentValueMinor).toBe(200_00);

      const detail = await agent.get(`/api/assets/${res.body.id}`);
      expect(detail.body.valuations).toHaveLength(2); // historic + present

      // Two manual entries with a gap ramp on the graph (1 Jun → 11 Jun).
      const snap = (d: string) => (world.ctx.db
        .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
        .get(d) as { assets_minor: number }).assets_minor;
      expect(snap('2026-06-01')).toBe(100_00);
      expect(snap('2026-06-06')).toBe(150_00);
      expect(snap('2026-06-11')).toBe(200_00);
    });

    it('records a present-day value for backdated liabilities too', async () => {
      const res = await csrf(agent.post('/api/liabilities')).send({
        category: 'mortgage', name: 'Mortgage', valueMinor: 200_000_00,
        presentValueMinor: 150_000_00, asOf: '2026-06-01',
      });
      expect(res.status).toBe(201);
      expect(res.body.currentValueMinor).toBe(150_000_00);
      const detail = await agent.get(`/api/liabilities/${res.body.id}`);
      expect(detail.body.valuations).toHaveLength(2);
    });

    it('rejects future or invalid backdates', async () => {
      await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'X', valueMinor: 1, asOf: '2026-06-12' }).expect(400);
      await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'X', valueMinor: 1, asOf: 'last-week' }).expect(400);
    });

    it('does not clobber legacy wealth points inside the recomputed window', async () => {
      await csrf(agent.post('/api/history/legacy'))
        .send({ date: '2026-02-01', netWorthMinor: 42 }).expect(201);
      await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Backdated', valueMinor: 100_00, asOf: '2026-01-01' });
      const legacy = world.ctx.db
        .prepare("SELECT net_worth_minor, source FROM snapshots WHERE snapshot_date = '2026-02-01'")
        .get() as { net_worth_minor: number; source: string };
      expect(legacy).toEqual({ net_worth_minor: 42, source: 'legacy' });
    });
  });

  describe('property index valuation', () => {
    it('lists selectable countries with their yearly rates', async () => {
      const res = await agent.get('/api/market/property-countries');
      expect(res.status).toBe(200);
      const gb = res.body.find((c: { code: string }) => c.code === 'GB');
      expect(gb).toMatchObject({ name: 'United Kingdom' });
      expect(gb.annualRatePct).toBeGreaterThan(0);
    });

    it('creates a property-index asset valued from its base entry', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'Home', valuationMode: 'property_index',
        country: 'gb', valueMinor: 30_000_000,
      });
      expect(res.status).toBe(201);
      expect(res.body.valuationMode).toBe('property_index');
      expect(res.body.country).toBe('GB');
      expect(res.body.currentValueMinor).toBe(30_000_000);
    });

    it('backfills daily index growth for backdated properties', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'Old home', valuationMode: 'property_index',
        country: 'GB', valueMinor: 30_000_000, asOf: '2025-06-11',
      });
      expect(res.status).toBe(201);
      const rate = PROPERTY_COUNTRIES.GB!.annualRatePct;
      expect(res.body.currentValueMinor).toBe(
        propertyValueMinor(30_000_000, '2025-06-11', '2026-06-11', rate),
      );

      // snapshots rise through the backfilled period
      const snap = (d: string) => (world.ctx.db
        .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
        .get(d) as { assets_minor: number }).assets_minor;
      expect(snap('2025-06-11')).toBe(30_000_000);
      expect(snap('2025-12-01')).toBeGreaterThan(snap('2025-06-11'));
      expect(snap('2026-06-01')).toBeGreaterThan(snap('2025-12-01'));
    });

    it('the daily refresh re-prices property-index assets', async () => {
      await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'Home', valuationMode: 'property_index',
        country: 'US', valueMinor: 50_000_000,
      });
      world.advanceDays(10); // stay inside the session TTL
      const refresh = await csrf(agent.post('/api/market/refresh'));
      expect(refresh.body.updated).toBe(1);
      const list = await agent.get('/api/assets');
      expect(list.body[0].currentValueMinor).toBeGreaterThan(50_000_000);
    });

    it('re-anchors index growth on the latest manual update, keeping history', async () => {
      const created = await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'Home', valuationMode: 'property_index',
        country: 'US', valueMinor: 50_000_000,
      });
      const id = created.body.id;

      // The user updates the value to a new figure (e.g. a fresh appraisal).
      await csrf(agent.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 60_000_000 });

      // History is preserved (base entry still there) — value reads the update.
      const detail = await agent.get(`/api/assets/${id}`);
      expect(detail.body.currentValueMinor).toBe(60_000_000);
      expect(detail.body.valuations.some((v: { valueMinor: number }) => v.valueMinor === 50_000_000)).toBe(true);

      // The daily refresh now grows from 60,000,000, not the original base.
      world.advanceDays(10);
      const refresh = await csrf(agent.post('/api/market/refresh'));
      expect(refresh.body.updated).toBe(1);
      const list = await agent.get('/api/assets');
      const rate = PROPERTY_COUNTRIES.US!.annualRatePct;
      const refDate = world.ctx.now().toISOString().slice(0, 10);
      // Grown from the manual update's date (the fixed clock) to refDate.
      expect(list.body[0].currentValueMinor).toBe(
        propertyValueMinor(60_000_000, '2026-06-11', refDate, rate),
      );
      expect(list.body[0].currentValueMinor).toBeGreaterThan(60_000_000);
    });

    it('validates the country and the category', async () => {
      await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'X', valuationMode: 'property_index', valueMinor: 1,
      }).expect(400); // country required
      await csrf(agent.post('/api/assets')).send({
        category: 'property', name: 'X', valuationMode: 'property_index', country: 'XX', valueMinor: 1,
      }).expect(400); // unknown country
      await csrf(agent.post('/api/assets')).send({
        category: 'cash', name: 'X', valuationMode: 'property_index', country: 'GB', valueMinor: 1,
      }).expect(400); // method gated to the property category
    });
  });

  describe('vehicle depreciation valuation', () => {
    it('creates a depreciating vehicle with its manufacture date', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'Car', valuationMode: 'depreciation',
        manufactureDate: '2023-06-11', valueMinor: 2_000_000,
      });
      expect(res.status).toBe(201);
      expect(res.body.valuationMode).toBe('depreciation');
      expect(res.body.manufactureDate).toBe('2023-06-11');
      expect(res.body.currentValueMinor).toBe(2_000_000);
    });

    it('backfills daily depreciation for backdated vehicles', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'Old car', valuationMode: 'depreciation',
        manufactureDate: '2024-06-11', valueMinor: 2_000_000, asOf: '2025-06-11',
      });
      expect(res.status).toBe(201);
      expect(res.body.currentValueMinor).toBe(
        vehicleValueMinor(2_000_000, '2025-06-11', '2024-06-11', '2026-06-11'),
      );

      // snapshots fall through the backfilled period
      const snap = (d: string) => (world.ctx.db
        .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
        .get(d) as { assets_minor: number }).assets_minor;
      expect(snap('2025-06-11')).toBe(2_000_000);
      expect(snap('2025-12-01')).toBeLessThan(snap('2025-06-11'));
      expect(snap('2026-06-01')).toBeLessThan(snap('2025-12-01'));
    });

    it('anchors depreciation on the present-day value, ignoring the historic one', async () => {
      // Backdated a year, with an (absurd) historic value that must be ignored,
      // and a present-day value of 15,000.00 that anchors the curve on today.
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'Old car', valuationMode: 'depreciation',
        manufactureDate: '2024-06-11', valueMinor: 99_999_999,
        presentValueMinor: 1_500_000, asOf: '2025-06-11',
      });
      expect(res.status).toBe(201);
      expect(res.body.currentValueMinor).toBe(1_500_000);

      // The ignored historic value never appears in the history.
      const detail = await agent.get(`/api/assets/${res.body.id}`);
      const values = (detail.body.valuations as { valueMinor: number }[]).map((v) => v.valueMinor);
      expect(values).not.toContain(99_999_999);

      // The past is reconstructed by reversing depreciation from today's value:
      // a year ago the car was worth more than it is now.
      const snap = (d: string) => (world.ctx.db
        .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
        .get(d) as { assets_minor: number }).assets_minor;
      expect(snap('2026-06-11')).toBe(1_500_000);
      expect(snap('2025-06-11')).toBe(
        vehicleValueMinor(1_500_000, '2026-06-11', '2024-06-11', '2025-06-11'),
      );
      expect(snap('2025-06-11')).toBeGreaterThan(snap('2026-06-11'));
    });

    it('depreciates normally from the historic value when no present value is given', async () => {
      const res = await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'Old car', valuationMode: 'depreciation',
        manufactureDate: '2024-06-11', valueMinor: 2_000_000, asOf: '2025-06-11',
      });
      expect(res.body.currentValueMinor).toBe(
        vehicleValueMinor(2_000_000, '2025-06-11', '2024-06-11', '2026-06-11'),
      );
    });

    it('the daily refresh re-prices depreciating vehicles downwards', async () => {
      await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'Car', valuationMode: 'depreciation',
        manufactureDate: '2026-01-01', valueMinor: 3_000_000,
      });
      world.advanceDays(10);
      const refresh = await csrf(agent.post('/api/market/refresh'));
      expect(refresh.body.updated).toBe(1);
      const list = await agent.get('/api/assets');
      expect(list.body[0].currentValueMinor).toBeLessThan(3_000_000);
    });

    it('validates the manufacture date and the category', async () => {
      await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'X', valuationMode: 'depreciation', valueMinor: 1,
      }).expect(400); // manufacture date required
      await csrf(agent.post('/api/assets')).send({
        category: 'vehicles', name: 'X', valuationMode: 'depreciation',
        manufactureDate: '2030-01-01', valueMinor: 1,
      }).expect(400); // future manufacture date
      await csrf(agent.post('/api/assets')).send({
        category: 'crypto', name: 'X', valuationMode: 'depreciation',
        manufactureDate: '2020-01-01', valueMinor: 1,
      }).expect(400); // method gated to the vehicles category
    });
  });

  describe('liability interest rate', () => {
    it('auto-creates a yearly percent schedule from an interest rate', async () => {
      const res = await csrf(agent.post('/api/liabilities')).send({
        category: 'loan', name: 'Car loan', valueMinor: 1_000_00, interestRatePct: 5,
      });
      expect(res.status).toBe(201);

      const recs = (await agent.get('/api/recurring')).body;
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({
        name: 'Car loan interest',
        targetType: 'liability',
        targetId: res.body.id,
        amountType: 'percent',
        percent: 5,
        cadence: 'yearly',
        nextRunOn: '2027-06-11', // one year after creation — no immediate accrual
      });
    });

    it('grows the balance by the interest rate after a year', async () => {
      const res = await csrf(agent.post('/api/liabilities')).send({
        category: 'loan', name: 'Loan', valueMinor: 1_000_00, interestRatePct: 10,
      });
      // No accrual yet on the day it was created.
      expect(runDueRecurring(world.ctx)).toBe(0);

      world.advanceDays(370);
      runDueRecurring(world.ctx);
      agent = await loginAgent(world.app); // previous session expired with the clock jump
      const loan = await agent.get(`/api/liabilities/${res.body.id}`);
      expect(loan.body.currentValueMinor).toBe(1_100_00); // +10%
    });

    it('rejects a non-positive interest rate and ignores it on assets', async () => {
      await csrf(agent.post('/api/liabilities')).send({
        category: 'loan', name: 'Bad', valueMinor: 100, interestRatePct: 0,
      }).expect(400);
      // Assets silently ignore the field (no schedule created).
      await csrf(agent.post('/api/assets')).send({
        category: 'cash', name: 'Savings', valueMinor: 100, interestRatePct: 5,
      }).expect(201);
      expect((await agent.get('/api/recurring')).body).toHaveLength(0);
    });
  });

  describe('historical view (asOf)', () => {
    it('lists holdings as they stood on a past date', async () => {
      await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Old savings', valueMinor: 100_00, asOf: '2026-03-01' });
      await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Brand new', valueMinor: 50_00 });

      // entries whose history starts after the date are omitted entirely
      const past = await agent.get('/api/assets?asOf=2026-04-01');
      expect(past.body.map((a: { name: string }) => a.name)).toEqual(['Old savings']);
      expect(past.body[0].currentValueMinor).toBe(100_00);

      const now = await agent.get('/api/assets');
      expect(now.body).toHaveLength(2);
    });

    it('values holdings at the latest valuation on or before the date', async () => {
      const created = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Savings', valueMinor: 100_00, asOf: '2026-01-01' });
      await csrf(agent.post(`/api/assets/${created.body.id}/valuations`)).send({ valueMinor: 999_00 });

      const past = await agent.get('/api/assets?asOf=2026-02-01');
      expect(past.body[0].currentValueMinor).toBe(100_00);
      const now = await agent.get('/api/assets');
      expect(now.body[0].currentValueMinor).toBe(999_00);
    });

    it('rejects malformed asOf dates', async () => {
      await agent.get('/api/assets?asOf=yesterday').expect(400);
      await agent.get('/api/liabilities?asOf=2026-13-99').expect(400);
    });
  });

  describe('graph smoothing between sparse entries', () => {
    const snap = (world: TestWorld, d: string) => (world.ctx.db
      .prepare('SELECT assets_minor FROM snapshots WHERE snapshot_date = ?')
      .get(d) as { assets_minor: number }).assets_minor;

    it('interpolates a manual revaluation linearly across the gap', async () => {
      const created = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Sav', valueMinor: 100_00, asOf: '2026-06-01' });
      await csrf(agent.post(`/api/assets/${created.body.id}/valuations`)).send({ valueMinor: 200_00 });

      // 1 Jun (100) → 11 Jun (200): a ramp, not a one-day cliff on the 11th
      expect(snap(world, '2026-06-01')).toBe(100_00);
      expect(snap(world, '2026-06-04')).toBe(130_00);
      expect(snap(world, '2026-06-06')).toBe(150_00);
      expect(snap(world, '2026-06-10')).toBe(190_00);
      expect(snap(world, '2026-06-11')).toBe(200_00);
    });

    it('re-smooths the lead-in days when an entry is edited', async () => {
      const created = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Sav', valueMinor: 100_00, asOf: '2026-06-01' });
      await csrf(agent.post(`/api/assets/${created.body.id}/valuations`)).send({ valueMinor: 200_00 });

      // move today's 200 entry to 9 Jun: the ramp must re-fit to 1→9 Jun
      const entries = (await agent.get(`/api/history/entries?side=asset&holdingId=${created.body.id}`)).body;
      await csrf(agent.patch(`/api/history/entries/asset/${entries[0].id}`))
        .send({ recordedOn: '2026-06-09' }).expect(200);

      expect(snap(world, '2026-06-05')).toBe(150_00); // halfway through 1→9 Jun
      expect(snap(world, '2026-06-09')).toBe(200_00);
      expect(snap(world, '2026-06-10')).toBe(200_00); // flat after the last entry
    });

    it('does not smooth recurring occurrences (discrete events step)', async () => {
      const created = await csrf(agent.post('/api/assets'))
        .send({ category: 'cash', name: 'Wages in', valueMinor: 100_00, asOf: '2026-05-20' });
      await csrf(agent.post('/api/recurring')).send({
        name: 'Salary', targetType: 'asset', targetId: created.body.id,
        amountMinor: 50_00, cadence: 'monthly', nextRunOn: '2026-06-10',
      });
      const { runDueRecurring } = await import('../../src/modules/recurring/service.js');
      runDueRecurring(world.ctx);

      expect(snap(world, '2026-06-05')).toBe(100_00); // unchanged until payday
      expect(snap(world, '2026-06-09')).toBe(100_00);
      expect(snap(world, '2026-06-10')).toBe(150_00); // the step lands on the day
    });
  });

  it('mirrors the structure for liabilities (no market mode)', async () => {
    const created = await csrf(agent.post('/api/liabilities'))
      .send({ category: 'mortgage', name: 'Home loan', valueMinor: 250_000_00 });
    expect(created.status).toBe(201);
    expect(created.body.valuationMode).toBe('manual');

    await csrf(agent.post('/api/liabilities'))
      .send({ category: 'cash', name: 'X', valueMinor: 1 }).expect(400); // asset category

    const list = await agent.get('/api/liabilities');
    expect(list.body).toHaveLength(1);
  });

  it('updates the daily snapshot on every mutation', async () => {
    await csrf(agent.post('/api/assets')).send({ category: 'cash', name: 'A', valueMinor: 100 });
    await csrf(agent.post('/api/liabilities')).send({ category: 'loan', name: 'L', valueMinor: 40 });
    const snap = world.ctx.db
      .prepare("SELECT * FROM snapshots WHERE snapshot_date = '2026-06-11'")
      .get() as { assets_minor: number; liabilities_minor: number; net_worth_minor: number };
    expect(snap.assets_minor).toBe(100);
    expect(snap.liabilities_minor).toBe(40);
    expect(snap.net_worth_minor).toBe(60);
  });

  it('enforces ownership boundaries (404 for other users data)', async () => {
    const created = await csrf(agent.post('/api/assets'))
      .send({ category: 'cash', name: 'Mine', valueMinor: 1000 });
    const id = created.body.id;

    createUser(world.ctx, 'mallory', 'password456');
    const mallory = await loginAgent(world.app, 'mallory', 'password456');
    await mallory.get(`/api/assets/${id}`).expect(404);
    await csrf(mallory.patch(`/api/assets/${id}`)).send({ name: 'Stolen' }).expect(404);
    await csrf(mallory.delete(`/api/assets/${id}`)).expect(404);
    await csrf(mallory.post(`/api/assets/${id}/valuations`)).send({ valueMinor: 1 }).expect(404);

    const list = await mallory.get('/api/assets');
    expect(list.body).toHaveLength(0);
  });
});
