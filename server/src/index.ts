import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startScheduler } from './jobs/scheduler.js';
import { checkBackupDir } from './modules/backup/service.js';
import { SimulatedPriceProvider } from './modules/market/provider.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const applied = migrate(db);
if (applied.length > 0) console.log(`[db] applied migrations: ${applied.join(', ')}`);
if (config.seedOnStart) {
  seed(db);
  console.log('[db] demo account seeded (SEED_ON_START=1)');
}

const ctx: AppContext = {
  db,
  config,
  now: () => new Date(),
  prices: new SimulatedPriceProvider(),
};

// Surface a misconfigured/unwritable backup directory loudly at startup rather
// than letting every backup fail silently in the background (see BACKUP.md).
checkBackupDir(ctx);

const app = buildApp(ctx);
const stopScheduler = startScheduler(ctx);

const server = app.listen(config.port, () => {
  console.log(`Concise API listening on http://localhost:${config.port} (${config.env})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
