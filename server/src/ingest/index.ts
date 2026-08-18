/**
 * Long-running poller. Runs a poll immediately, then every POLL_INTERVAL_MINUTES.
 *
 * A failed cycle is logged and retried on the next tick rather than killing the
 * process — a transient Hyundai outage should not stop the archive from growing
 * once their servers come back.
 */
import { config } from '../config.ts';
import { poll } from './poll.ts';
import { closePool } from '../db/pool.ts';
import { migrate } from '../db/migrate.ts';

const INTERVAL_MS = config.pollIntervalMinutes * 60_000;

let stopping = false;

async function runOnce(): Promise<void> {
  const startedAt = new Date();
  console.log(`\n=== poll @ ${startedAt.toISOString()} ===`);
  try {
    const outcome = await poll();
    console.log(
      `poll ok: ${outcome.tripsSeen} seen, ${outcome.tripsInserted} new, ` +
        `${outcome.statusInserted} status snapshot(s), ` +
        `${outcome.positionsInserted} position(s), ${outcome.eventsRecorded} event(s)`,
    );
  } catch (error) {
    console.error(`poll failed: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  // Self-migrating so `docker compose up` works from an empty volume.
  await migrate();

  console.log(`Poller started. Interval: ${config.pollIntervalMinutes} minute(s).`);
  await runOnce();

  const timer = setInterval(() => {
    if (!stopping) void runOnce();
  }, INTERVAL_MS);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} received, shutting down.`);
    clearInterval(timer);
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

await main();
