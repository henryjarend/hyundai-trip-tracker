import pg from 'pg';
import { config } from '../config.ts';

// node-postgres returns numeric/int8 as strings by default to avoid precision loss.
// Every numeric column in this schema is small enough for a JS double, and the API
// and frontend both want numbers, so parse them eagerly.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Without these, a request made while Postgres is unreachable hangs forever
  // rather than failing — the UI would just spin with no error.
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
  idleTimeoutMillis: 30_000,
});

// An idle client erroring out (e.g. Postgres restarting under the poller) emits on
// the pool. Without a listener Node treats it as an unhandled error and exits.
pool.on('error', (error) => {
  console.error(`postgres pool error: ${error.message}`);
});

/** Anything that failed at the database layer, so the API can answer 503 not 500. */
export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/**
 * Every query goes through here so that connection failures, timeouts and SQL
 * errors all surface as one recognisable type. `pg` reports a refused connection
 * as a bare Error with no code, which is otherwise indistinguishable from a bug.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  try {
    return await pool.query<T>(text, params);
  } catch (error) {
    throw new DatabaseError((error as Error).message, { cause: error });
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
