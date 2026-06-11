import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { startScheduler } from './jobs/scheduler.js';
import { SimulatedPriceProvider } from './modules/market/provider.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const applied = migrate(db);
if (applied.length > 0) console.log(`[db] applied migrations: ${applied.join(', ')}`);

const ctx: AppContext = {
  db,
  config,
  now: () => new Date(),
  prices: new SimulatedPriceProvider(),
};

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
