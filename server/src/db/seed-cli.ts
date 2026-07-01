import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
migrate(db);
seed(db);
console.log('Seeded demo account (demo / demo) with a lifelong portfolio and 45 years of history.');
