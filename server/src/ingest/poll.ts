/**
 * One poll cycle: log in, enumerate vehicles, fetch each one's trips and cached
 * status, and upsert everything.
 *
 * Hyundai exposes only the last ~4 trips with no backfill, so the archive is built
 * purely by running this often enough that no trip ever falls out of that window
 * unseen.
 */
import { config, requireCredentials } from '../config.ts';
import { HyundaiClient, HyundaiRateLimitError } from '../hyundai/client.ts';
import {
  finishPollRun,
  getLocationFetchState,
  insertStatusSnapshot,
  insertVehiclePosition,
  latestStatusSnapshot,
  markLocationAttempt,
  markLocationFailure,
  markLocationSuccess,
  recordVehicleEvents,
  startPollRun,
  upsertTrips,
  upsertVehicle,
} from '../db/repo.ts';
import type { PollRunOutcome } from '../db/repo.ts';
import type { Vehicle, VehicleStatusSnapshot } from '../hyundai/types.ts';
import { decideLocationFetch } from './location-policy.ts';
import { detectTransitions } from './transitions.ts';

export interface PollOptions {
  /** Fetch and parse, print the result, write nothing. */
  dryRun?: boolean;
}

interface LocationOutcome {
  inserted: number;
  status: PollRunOutcome['locationStatus'];
}

/**
 * Fetches a position fix, but only when the policy says it is worth a call.
 *
 * Every failure mode here is non-fatal by design: a refused, failed or skipped fix
 * leaves the trip archive — the thing this project exists for — completely intact.
 */
async function pollLocation(
  client: HyundaiClient,
  vehicle: Vehicle,
  status: VehicleStatusSnapshot,
  options: PollOptions,
): Promise<LocationOutcome> {
  if (options.dryRun) {
    // A dry run writes nothing, so it must not consume rate-limit budget either.
    return { inserted: 0, status: 'disabled' };
  }

  const state = await getLocationFetchState(vehicle.vin);
  const decision = decideLocationFetch({
    config: {
      enabled: config.locationEnabled,
      intervalMinutes: config.locationIntervalMinutes,
      activeIntervalMinutes: config.locationActiveIntervalMinutes,
    },
    state,
    engineRunning: status.engineRunning,
    odometerMiles: status.odometerMiles,
    now: new Date(),
  });

  if (!decision.fetch) {
    console.log(`  location: skipped — ${decision.reason}`);
    return { inserted: 0, status: decision.status };
  }

  // Stamped before the call so a crash mid-request still costs the slot, rather
  // than letting a restart loop retry immediately and forever.
  await markLocationAttempt(vehicle.vin);

  try {
    const position = await client.fetchLocation(vehicle);
    if (position === null) {
      console.log('  location: backend returned no fix');
      // Not a failure — there is nothing to back off from, and the attempt stamp
      // above already applies the normal interval before we ask again.
      return { inserted: 0, status: 'fetched' };
    }

    const inserted = await insertVehiclePosition(vehicle.vin, position, config.vehicleTz);
    await markLocationSuccess(vehicle.vin, status.odometerMiles);
    console.log(
      `  location: ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` +
        `${inserted ? '' : ' (already known)'} — ${decision.reason}`,
    );
    return { inserted, status: 'fetched' };
  } catch (error) {
    const rateLimited = error instanceof HyundaiRateLimitError;
    const until = await markLocationFailure(vehicle.vin, {
      rateLimited,
      error: (error as Error).message,
      baseMinutes: config.locationBackoffMinutes,
      maxMinutes: config.locationBackoffMaxMinutes,
    });

    if (rateLimited) {
      console.warn(
        `  location: rate limited (HT_534), backing off until ${until?.toISOString() ?? 'unknown'}`,
      );
      return { inserted: 0, status: 'rate_limited' };
    }

    console.warn(`  location fetch failed: ${(error as Error).message}`);
    return { inserted: 0, status: 'failed' };
  }
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
    positionsInserted: 0,
    eventsRecorded: 0,
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
          // Read the previous snapshot before inserting the new one, or the diff
          // would be against itself and never see a transition.
          const previous = await latestStatusSnapshot(vehicle.vin);
          outcome.statusInserted += await insertStatusSnapshot(vehicle.vin, status);

          const events = detectTransitions(previous, status);
          if (events.length > 0) {
            outcome.eventsRecorded += await recordVehicleEvents(vehicle.vin, events);
            console.log(`  events: ${events.map((event) => event.kind).join(', ')}`);
          }
        }

        // Location is a further bonus still, and rate limited, so it gets its own
        // guard: neither trips nor the status we just stored may be lost to it.
        const location = await pollLocation(client, vehicle, status, options);
        outcome.positionsInserted += location.inserted;
        // poll_runs has one row per run, not per vehicle, so with several cars
        // enrolled this records the last one's outcome. The per-vehicle truth lives
        // in location_fetch_state; this column is a convenience.
        outcome.locationStatus = location.status;
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
