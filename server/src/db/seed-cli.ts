import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
migrate(db);
seed(db);
console.log('Seeded demo account (demo / demo) with sample portfolio and 6 years of history.');
