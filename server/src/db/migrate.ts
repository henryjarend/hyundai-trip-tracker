/**
 * Minimal forward-only migration runner. Applies every .sql file in db/migrations
 * in filename order, recording each in schema_migrations so reruns are no-ops.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

/** Arbitrary constant — just has to be the same in every process that migrates. */
const MIGRATION_LOCK_KEY = 8_244_113_097_001;

export async function migrate(): Promise<string[]> {
  // The API and the poller both migrate on boot and start simultaneously under
  // compose. Serialise them so they cannot apply the same file concurrently.
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    return await runMigrations();
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    lock.release();
  }
}

async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return ran;
}

if (import.meta.main) {
  try {
    const ran = await migrate();
    console.log(ran.length ? `${ran.length} migration(s) applied.` : 'Already up to date.');
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
