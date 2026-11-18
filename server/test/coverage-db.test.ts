/**
 * The coverage SQL against a real Postgres: which odometer readings it picks for a
 * range's two ends, and that the summary endpoint's query hands them to coverage.ts
 * correctly. coverage.test.ts covers the arithmetic; this covers what feeds it.
 *
 * Runs only against a database on this machine, and only inside a throwaway schema
 * that it creates, migrates and drops, so it can't touch archived trips even when
 * pointed at the dev database. Skips cleanly when no local database answers.
 *
 *   podman run --rm -d --name htt-test-db -p 5433:5432 \
 *     -e POSTGRES_PASSWORD=postgres docker.io/library/postgres:18-alpine
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npm test
 *
 * If the published port doesn't reach your WSL distro (it doesn't from every distro
 * the Podman machine serves), run the test inside a container on the database's
 * network instead, streaming the code in without .env:
 *
 *   tar c --exclude=.env --exclude=.git --exclude=web package.json node_modules server db |
 *     podman run --rm -i --network container:htt-test-db \
 *       -e DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *       docker.io/library/node:26-alpine \
 *       sh -c 'mkdir /app && cd /app && tar x && cd server && node --test test/coverage-db.test.ts'
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const SCHEMA = `coverage_test_${process.pid}`;
// Every pooled connection resolves unqualified names in the test schema first. Set
// before pool.ts is imported, since the pool reads it when it opens connections.
// node --test runs each file in its own process, so this reaches no other test.
process.env.PGOPTIONS = `-c search_path=${SCHEMA},public`;

const { config } = await import('../src/config.ts');
const { closePool, pool } = await import('../src/db/pool.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { tripSummary } = await import('../src/db/repo.ts');
type Coverage = import('../src/coverage.ts').Coverage;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const isLocal = LOCAL_HOSTS.has(new URL(config.databaseUrl).hostname);
const reachable = isLocal && (await pool.query('SELECT 1').then(() => true, () => false));
const skip = !isLocal ? 'DATABASE_URL is not local' : !reachable ? 'no local database' : false;

before(async () => {
  if (skip) return;
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  const log = console.log;
  console.log = () => undefined; // migrate() announces each file
  try {
    await migrate();
  } finally {
    console.log = log;
  }
  await seed();
});

after(async () => {
  if (!skip) await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await closePool().catch(() => undefined);
});

const A = 'TESTVINA';
const B = 'TESTVINB';

/**
 * Vehicle A on 2026-10-01 (UTC):
 *
 *   10:00–10:10  trip 1   odometer 1000 → 1010
 *   11:00        snapshot 1015            (mid-gap)
 *   12:00–12:10  trip 2   odometer 1020 → 1030   (10 mi gap before it)
 *   13:00        snapshot 1018            (stale: a moving car repeats an old odometer)
 *   14:00–15:00  trip 3   odometer 1030 → 1050
 *   16:00        snapshot 1060            (driven, trip not yet published)
 *   vehicles row 1055                     (older than the newest snapshot)
 *
 * Vehicle B: one 5 mi trip ending at 500, which is also its current odometer.
 */
async function seed() {
  await pool.query(
    `INSERT INTO vehicles (vin, reg_id, odometer_miles) VALUES ($1, 'r', 1055), ($2, 'r', 500)`,
    [A, B],
  );

  const trip = (vin: string, start: string, seconds: number, odometer: number, distance: number) =>
    pool.query(
      `INSERT INTO trips (vin, start_date_raw, start_date_local, start_date, duration_seconds,
                          distance_unit, distance, distance_miles, odometer, odometer_miles,
                          energy_total_wh, raw)
       VALUES ($1, $2::text, $2::text::timestamp, $2::text::timestamptz, $3, 3, $4, $4, $5, $5, 1000, '{}')`,
      [vin, start, seconds, distance, odometer],
    );
  await trip(A, '2026-10-01T10:00:00Z', 600, 1010, 10);
  await trip(A, '2026-10-01T12:00:00Z', 600, 1030, 10);
  await trip(A, '2026-10-01T14:00:00Z', 3600, 1050, 20);
  await trip(B, '2026-10-01T10:00:00Z', 600, 500, 5);

  const snapshot = (at: string, odometer: number | null) =>
    pool.query(
      `INSERT INTO vehicle_status_snapshots (vin, synced_at, odometer_miles, raw)
       VALUES ($1, $2, $3, '{}')`,
      [A, at, odometer],
    );
  await snapshot('2026-10-01T11:00:00Z', 1015);
  await snapshot('2026-10-01T13:00:00Z', 1018);
  await snapshot('2026-10-01T16:00:00Z', 1060);
  await snapshot('2026-10-01T17:00:00Z', null); // no odometer: ignored, not 0
}

async function coverageOf(vin: string | undefined, from?: string, to?: string): Promise<Coverage> {
  const summary = (await tripSummary(vin, from, to)) as { coverage: Coverage };
  return summary.coverage;
}

function close(actual: number | null, expected: number) {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

test('whole archive runs from 0 to the newest reading of any kind', { skip }, async () => {
  const coverage = await coverageOf(A);

  assert.equal(coverage.odometer_start_miles, 0);
  close(coverage.odometer_end_miles, 1060); // the snapshot, past both the vehicle row and the last trip
  close(coverage.tracked_miles, 40);
  close(coverage.before_first_trip_miles, 1000);
  close(coverage.missed_miles, 10);
  close(coverage.after_last_trip_miles, 10);
  assert.equal(coverage.gaps.length, 1);
});

test('a range starts at the highest reading taken by its start', { skip }, async () => {
  // Readings by 11:30: trip 1's end (1010) and the 11:00 snapshot (1015).
  const coverage = await coverageOf(A, '2026-10-01T11:30:00Z');

  close(coverage.odometer_start_miles, 1015);
  close(coverage.odometer_end_miles, 1060);
  close(coverage.before_first_trip_miles, 5);
  close(coverage.tracked_miles, 30);
  assert.equal(coverage.gaps.length, 0); // the gap sits before the range's first trip
});

test('a stale snapshot never pulls a boundary back', { skip }, async () => {
  // By 13:30 the newest reading is the stale 1018 snapshot, but trip 2 already ended at 1030.
  const coverage = await coverageOf(A, '2026-10-01T13:30:00Z');
  close(coverage.odometer_start_miles, 1030);
});

test('a trip still running at the range start is not a reading by then', { skip }, async () => {
  // Trip 3 started at 14:00 but ended at 15:00, so its 1050 is not a reading by 14:30.
  // Nor is it in the range, which takes trips by start time, so the range holds no trip.
  const coverage = await coverageOf(A, '2026-10-01T14:30:00Z', '2026-10-01T15:30:00Z');

  close(coverage.odometer_start_miles, 1030);
  close(coverage.odometer_end_miles, 1050);
  close(coverage.tracked_miles, 0);
  assert.equal(coverage.ratio, 0);
});

test('a range end ignores everything after it', { skip }, async () => {
  const coverage = await coverageOf(A, undefined, '2026-10-01T13:00:00Z');

  assert.equal(coverage.odometer_start_miles, 0);
  close(coverage.odometer_end_miles, 1030); // not the later 1060
  close(coverage.tracked_miles, 20);
  close(coverage.missed_miles, 10);
  close(coverage.after_last_trip_miles, 0);
});

test('all vehicles combine by miles, without a shared odometer', { skip }, async () => {
  const coverage = await coverageOf(undefined);

  assert.equal(coverage.odometer_start_miles, null);
  close(coverage.odometer_miles, 1560); // 1060 + 500
  close(coverage.tracked_miles, 45);
  assert.deepEqual(
    coverage.gaps.map((gap) => gap.vin),
    [A],
  );
});

test('a vehicle that drove but has no trip in the range still counts', { skip }, async () => {
  // B has a reading (500) before 11:00 and none after; A drove 1015 → 1060.
  const coverage = await coverageOf(undefined, '2026-10-01T11:00:00Z');
  close(coverage.odometer_miles, 45);

  const onlyB = await coverageOf(B, '2026-10-01T11:00:00Z');
  close(onlyB.odometer_miles, 0);
  assert.equal(onlyB.ratio, null);
});
