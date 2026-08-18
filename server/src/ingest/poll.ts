/**
 * One poll cycle: log in, enumerate vehicles, fetch each one's trips and cached
 * status, and upsert everything.
 *
 * Hyundai exposes only the last ~4 trips with no backfill, so the archive is built
 * purely by running this often enough that no trip ever falls out of that window
 * unseen.
 */
import { config, requireCredentials } from '../config.ts';
import { HyundaiClient } from '../hyundai/client.ts';
import {
  finishPollRun,
  insertStatusSnapshot,
  startPollRun,
  upsertTrips,
  upsertVehicle,
} from '../db/repo.ts';
import type { PollRunOutcome } from '../db/repo.ts';

export interface PollOptions {
  /** Fetch and parse, print the result, write nothing. */
  dryRun?: boolean;
}

export async function poll(options: PollOptions = {}): Promise<PollRunOutcome> {
  const credentials = requireCredentials();
  const client = new HyundaiClient({
    username: credentials.username,
    password: credentials.password,
    pin: credentials.pin,
    utcOffset: config.utcOffset,
    debug: config.debugHttp,
  });

  const outcome: PollRunOutcome = {
    ok: false,
    tripsSeen: 0,
    tripsInserted: 0,
    tripsUpdated: 0,
    statusInserted: 0,
  };

  // In a dry run nothing is written, so there is no poll_runs row to open either.
  const runId = options.dryRun ? null : await startPollRun();

  try {
    const vehicles = await client.fetchVehicles();
    if (vehicles.length === 0) {
      throw new Error('No vehicles returned for this account.');
    }
    console.log(`Found ${vehicles.length} vehicle(s).`);

    for (const vehicle of vehicles) {
      console.log(`\n${vehicle.nickname} (${vehicle.vin.slice(0, 4)}…${vehicle.vin.slice(-4)})`);

      if (!options.dryRun) {
        await upsertVehicle(vehicle, credentials.username);
      }

      const trips = await client.fetchTrips(vehicle);
      outcome.tripsSeen += trips.length;
      console.log(`  ${trips.length} trip(s) returned by Hyundai`);

      if (options.dryRun) {
        console.log(JSON.stringify(trips, null, 2));
      } else {
        const { inserted, updated } = await upsertTrips(vehicle.vin, trips, config.vehicleTz);
        outcome.tripsInserted += inserted;
        outcome.tripsUpdated += updated;
        console.log(`  ${inserted} new, ${updated} already known`);
      }

      // Status is a bonus signal; a failure here must not lose the trips we just
      // successfully stored.
      try {
        const status = await client.fetchStatus(vehicle);
        if (options.dryRun) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          outcome.statusInserted += await insertStatusSnapshot(vehicle.vin, status);
        }
      } catch (error) {
        console.warn(`  status fetch failed (trips were saved): ${(error as Error).message}`);
      }
    }

    outcome.ok = true;
  } catch (error) {
    outcome.error = (error as Error).message;
    throw error;
  } finally {
    if (runId !== null) {
      await finishPollRun(runId, outcome);
    }
  }

  return outcome;
}
