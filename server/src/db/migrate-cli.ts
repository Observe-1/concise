import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const applied = migrate(db);
console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
console.log(`Database: ${config.dbPath}`);
