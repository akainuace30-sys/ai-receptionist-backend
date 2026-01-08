import { Pool } from 'pg';
import { newDb } from 'pg-mem';
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let pool;
let isMem = false;

function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return new Pool({ connectionString: databaseUrl });
  }
  // fallback to in-memory pg-mem
  const db = newDb({ autoCreateForeignKeyIndices: true });
  isMem = true;
  db.public.registerFunction({ name: 'now', returns: 'timestamp', implementation: () => new Date() });
  const adapter = db.adapters.createPg();
  pool = new adapter.Pool();
  return pool;
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function runMigrations() {
  const poolInstance = getPool();
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await poolInstance.query(sql);
  }
}

export function isInMemory() {
  return isMem;
}
