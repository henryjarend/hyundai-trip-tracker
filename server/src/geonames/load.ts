/**
 * Downloads the GeoNames cities dataset and loads it into Postgres.
 *
 * `cities500` is every populated place with a population of 500 or more (~200k
 * rows, ~10 MB zipped) — the same dataset Immich uses for offline reverse
 * geocoding. Running this is a one-off; re-run it occasionally to pick up changes.
 *
 *   npm run geonames:load
 */
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request } from 'undici';
import { from as copyFrom } from 'pg-copy-streams';
import { pool, closePool, query } from '../db/pool.ts';
import { migrate } from '../db/migrate.ts';

const execFileAsync = promisify(execFile);

const CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';

async function download(url: string, destination: string): Promise<void> {
  console.log(`downloading ${url}`);
  const response = await request(url);
  if (response.statusCode !== 200) {
    throw new Error(`${url} returned HTTP ${response.statusCode}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

/**
 * The GeoNames dump is a tab-separated file with no header. Columns are documented
 * at https://download.geonames.org/export/dump/readme.txt — we need id, name,
 * coordinates, country, the first admin division, and population.
 */
const COL = {
  geonameid: 0,
  name: 1,
  latitude: 4,
  longitude: 5,
  countryCode: 8,
  admin1: 10,
  population: 14,
} as const;

function toCitiesTsv(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;
    const f = line.split('\t');

    const id = Number(f[COL.geonameid]);
    const lat = Number(f[COL.latitude]);
    const lon = Number(f[COL.longitude]);
    const name = f[COL.name];
    if (!Number.isInteger(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || !name) {
      continue;
    }

    // COPY treats backslashes as escapes, so neutralise them along with any stray
    // tabs in the name field.
    const clean = (value: string | undefined) =>
      (value ?? '').replaceAll('\\', ' ').replaceAll('\t', ' ').trim();

    out.push(
      [
        id,
        clean(name),
        lat,
        lon,
        clean(f[COL.countryCode]),
        clean(f[COL.admin1]),
        Number(f[COL.population]) || 0,
      ].join('\t'),
    );
  }

  return `${out.join('\n')}\n`;
}

function toAdmin1Tsv(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const [code, name] = line.split('\t');
    if (!code || !name) continue;
    out.push(`${code.trim()}\t${name.replaceAll('\\', ' ').trim()}`);
  }
  return `${out.join('\n')}\n`;
}

/** Streams a TSV into a table via COPY — far faster than row-by-row inserts. */
async function copyInto(table: string, columns: string[], tsv: string): Promise<void> {
  const client = await pool.connect();
  try {
    const stream = client.query(copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN`));
    await pipeline(Readable.from([tsv]), stream);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await migrate();

  const workDir = await mkdtemp(join(tmpdir(), 'geonames-'));
  try {
    const zipPath = join(workDir, 'cities500.zip');
    const admin1Path = join(workDir, 'admin1.txt');

    await Promise.all([download(CITIES_URL, zipPath), download(ADMIN1_URL, admin1Path)]);

    // `unzip` is present in the node:alpine image and on typical Linux hosts;
    // Node still has no built-in zip reader.
    await execFileAsync('unzip', ['-o', zipPath, '-d', workDir]);

    const citiesRaw = await readFile(join(workDir, 'cities500.txt'), 'utf8');
    const admin1Raw = await readFile(admin1Path, 'utf8');

    console.log('loading into postgres…');
    // Replace wholesale inside a transaction so a failed load can't leave the
    // table half-populated and silently degrade lookups.
    await query('BEGIN');
    try {
      await query('TRUNCATE geonames_cities');
      await query('TRUNCATE geonames_admin1');
      await copyInto(
        'geonames_cities',
        ['geonameid', 'name', 'latitude', 'longitude', 'country_code', 'admin1_code', 'population'],
        toCitiesTsv(citiesRaw),
      );
      await copyInto('geonames_admin1', ['code', 'name'], toAdmin1Tsv(admin1Raw));
      await query('COMMIT');
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }

    const { rows } = await query<{ cities: number; regions: number }>(
      'SELECT (SELECT count(*) FROM geonames_cities)::int AS cities, (SELECT count(*) FROM geonames_admin1)::int AS regions',
    );
    console.log(`loaded ${rows[0]?.cities} cities and ${rows[0]?.regions} regions.`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`geonames load failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
