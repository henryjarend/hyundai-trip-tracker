/**
 * One-shot poll. `--dry-run` hits the real API and prints what it parsed without
 * touching the database — run this first to confirm credentials and headers work.
 */
import { parseArgs } from 'node:util';
import { poll } from './poll.ts';
import { closePool } from '../db/pool.ts';
import { HyundaiApiError } from '../hyundai/client.ts';

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
});

const dryRun = values['dry-run'] === true;

try {
  if (dryRun) console.log('Dry run — nothing will be written.\n');
  const outcome = await poll({ dryRun });
  console.log(
    `\nDone. ${outcome.tripsSeen} trip(s) seen, ` +
      `${outcome.tripsInserted} new, ${outcome.tripsUpdated} already known, ` +
      `${outcome.statusInserted} status snapshot(s).`,
  );
} catch (error) {
  if (error instanceof HyundaiApiError) {
    console.error(`\nHyundai API error (HTTP ${error.statusCode}): ${error.message}`);
    console.error(error.body);
  } else {
    console.error(`\nPoll failed: ${(error as Error).message}`);
  }
  process.exitCode = 1;
} finally {
  await closePool();
}
