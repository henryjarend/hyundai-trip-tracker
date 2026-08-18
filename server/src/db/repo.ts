/** All database reads and writes. */
import { query } from './pool.ts';
import { nearestPlace } from '../geocode.ts';
import type {
  Trip,
  Vehicle,
  VehiclePosition,
  VehicleStatusSnapshot,
} from '../hyundai/types.ts';

export async function upsertVehicle(vehicle: Vehicle, accountId: string): Promise<void> {
  await query(
    `INSERT INTO vehicles (vin, reg_id, nickname, generation, fuel_type, account_id, odometer_miles)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (vin) DO UPDATE SET
       reg_id         = EXCLUDED.reg_id,
       nickname       = EXCLUDED.nickname,
       generation     = EXCLUDED.generation,
       fuel_type      = EXCLUDED.fuel_type,
       account_id     = EXCLUDED.account_id,
       odometer_miles = COALESCE(EXCLUDED.odometer_miles, vehicles.odometer_miles),
       last_seen_at   = now()`,
    [
      vehicle.vin,
      vehicle.regId,
      vehicle.nickname,
      vehicle.generation,
      vehicle.fuelType,
      accountId,
      vehicle.odometerMiles,
    ],
  );
}

export interface TripUpsertResult {
  inserted: number;
  updated: number;
}

/**
 * Upserts trips on `(vin, start_date_raw)`.
 *
 * The naive `startDateLocal` is resolved to a real instant by Postgres via
 * `AT TIME ZONE`, which handles DST correctly — doing this in JS would need a
 * timezone database we'd rather not carry.
 *
 * A trip already stored is refreshed (Hyundai sometimes revises the numbers shortly
 * after a trip ends) but its `first_seen_at` is preserved.
 */
export async function upsertTrips(
  vin: string,
  trips: Trip[],
  timezone: string,
): Promise<TripUpsertResult> {
  const result: TripUpsertResult = { inserted: 0, updated: 0 };

  for (const trip of trips) {
    const { rows } = await query<{ inserted: boolean }>(
      `INSERT INTO trips (
         vin, start_date_raw, start_date_local, start_date, duration_seconds,
         drive_time_seconds,
         distance_unit, distance, odometer, distance_miles, odometer_miles,
         avg_speed, max_speed,
         energy_total_wh, energy_regen_wh, energy_climate_wh,
         energy_drivetrain_wh, energy_accessories_wh, energy_battery_care_wh,
         raw
       ) VALUES (
         -- $4 must be cast: AT TIME ZONE is overloaded on text and interval, so
         -- Postgres cannot infer a bare parameter's type here.
         $1, $2, $3::timestamp, $3::timestamp AT TIME ZONE $4::text, $5,
         $20,
         $6, $7, $8, $9, $10,
         $11, $12,
         $13, $14, $15,
         $16, $17, $18,
         $19
       )
       ON CONFLICT (vin, start_date_raw) DO UPDATE SET
         duration_seconds       = EXCLUDED.duration_seconds,
         drive_time_seconds     = EXCLUDED.drive_time_seconds,
         distance_unit          = EXCLUDED.distance_unit,
         distance               = EXCLUDED.distance,
         odometer               = EXCLUDED.odometer,
         distance_miles         = EXCLUDED.distance_miles,
         odometer_miles         = EXCLUDED.odometer_miles,
         avg_speed              = EXCLUDED.avg_speed,
         max_speed              = EXCLUDED.max_speed,
         energy_total_wh        = EXCLUDED.energy_total_wh,
         energy_regen_wh        = EXCLUDED.energy_regen_wh,
         energy_climate_wh      = EXCLUDED.energy_climate_wh,
         energy_drivetrain_wh   = EXCLUDED.energy_drivetrain_wh,
         energy_accessories_wh  = EXCLUDED.energy_accessories_wh,
         energy_battery_care_wh = EXCLUDED.energy_battery_care_wh,
         raw                    = EXCLUDED.raw,
         updated_at             = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        vin,
        trip.startDateRaw,
        trip.startDateLocal,
        timezone,
        trip.durationSeconds,
        trip.distanceUnit,
        trip.distance,
        trip.odometer,
        trip.distanceMiles,
        trip.odometerMiles,
        trip.avgSpeed,
        trip.maxSpeed,
        trip.energyTotalWh,
        trip.energyRegenWh,
        trip.energyClimateWh,
        trip.energyDrivetrainWh,
        trip.energyAccessoriesWh,
        trip.energyBatteryCareWh,
        JSON.stringify(trip.raw),
        trip.driveTimeSeconds,
      ],
    );

    if (rows[0]?.inserted) result.inserted += 1;
    else result.updated += 1;
  }

  return result;
}

/**
 * Stores a status snapshot. Cached status repeats unchanged between polls, so a
 * duplicate `synced_at` is expected and simply ignored. Returns 1 if a new row
 * landed, 0 otherwise.
 */
export async function insertStatusSnapshot(
  vin: string,
  snapshot: VehicleStatusSnapshot,
): Promise<number> {
  // Without a sync timestamp there is nothing to dedupe on, and storing it would
  // add a duplicate row on every single poll.
  if (snapshot.syncedAt === null) return 0;

  const { rowCount } = await query(
    `INSERT INTO vehicle_status_snapshots (
       vin, synced_at, soc_percent, ev_range_miles, charging, plug_type,
       charge_power, odometer_miles, latitude, longitude, locked, battery_12v,
       engine_running, raw
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (vin, synced_at) DO NOTHING`,
    [
      vin,
      snapshot.syncedAt,
      snapshot.socPercent,
      snapshot.evRangeMiles,
      snapshot.charging,
      snapshot.plugType,
      snapshot.chargePower,
      snapshot.odometerMiles,
      snapshot.latitude,
      snapshot.longitude,
      snapshot.locked,
      snapshot.battery12v,
      snapshot.engineRunning,
      JSON.stringify(snapshot.raw),
    ],
  );

  return rowCount ?? 0;
}

export interface StoredStatus {
  synced_at: Date;
  engine_running: boolean | null;
  charging: boolean | null;
  plug_type: string | null;
  odometer_miles: number | null;
  soc_percent: number | null;
}

/**
 * The most recent stored snapshot, used as the "before" side of transition
 * detection. Read before the new snapshot is inserted, or the comparison is
 * against itself.
 */
export async function latestStatusSnapshot(vin: string): Promise<StoredStatus | null> {
  const { rows } = await query<StoredStatus>(
    `SELECT synced_at, engine_running, charging, plug_type, odometer_miles, soc_percent
     FROM vehicle_status_snapshots
     WHERE vin = $1
     ORDER BY synced_at DESC
     LIMIT 1`,
    [vin],
  );
  return rows[0] ?? null;
}

export type VehicleEventKind =
  | 'engine_on'
  | 'engine_off'
  | 'moved'
  | 'charge_start'
  | 'charge_stop'
  | 'plugged_in'
  | 'unplugged';

export interface VehicleEvent {
  kind: VehicleEventKind;
  /** The `synced_at` of the snapshot that revealed the change. */
  observedAt: string | null;
  previous: unknown;
  current: unknown;
}

/**
 * Records inferred transitions. Duplicates are dropped by the unique constraint, so
 * re-observing an unchanged snapshot is a no-op and this is safe to call every poll.
 * Returns how many rows actually landed.
 */
export async function recordVehicleEvents(
  vin: string,
  events: VehicleEvent[],
): Promise<number> {
  let recorded = 0;
  for (const event of events) {
    const { rowCount } = await query(
      `INSERT INTO vehicle_events (vin, kind, observed_at, previous, current)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        vin,
        event.kind,
        event.observedAt,
        JSON.stringify(event.previous ?? null),
        JSON.stringify(event.current ?? null),
      ],
    );
    recorded += rowCount ?? 0;
  }
  return recorded;
}

/**
 * Stores a position fix. Returns 1 if a new row landed, 0 if it duplicated a fix we
 * already had — which is the common case, since the backend keeps returning the same
 * position until the car reports a new one.
 *
 * A zone-less `time` is resolved here with VEHICLE_TZ, exactly as trip timestamps
 * are, rather than being guessed at during parsing.
 */
export async function insertVehiclePosition(
  vin: string,
  position: VehiclePosition,
  timezone: string,
): Promise<number> {
  const { rowCount } = await query(
    `INSERT INTO vehicle_positions (
       vin, reported_at, reported_at_raw, latitude, longitude, altitude, raw
     ) VALUES (
       $1,
       COALESCE($2::timestamptz, $3::timestamp AT TIME ZONE $4::text),
       $5, $6, $7, $8, $9
     )
     ON CONFLICT DO NOTHING`,
    [
      vin,
      position.reportedAt,
      position.reportedAtLocal,
      timezone,
      position.reportedAtRaw,
      position.latitude,
      position.longitude,
      position.altitude,
      JSON.stringify(position.raw),
    ],
  );
  return rowCount ?? 0;
}

export async function startPollRun(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    'INSERT INTO poll_runs DEFAULT VALUES RETURNING id',
  );
  return rows[0]!.id;
}

/** Why a poll did or did not spend a findMyCar call. Recorded on the poll_runs row. */
export type LocationStatus =
  | 'fetched'
  | 'skipped_throttled'
  | 'skipped_no_movement'
  | 'rate_limited'
  | 'failed'
  | 'disabled';

export interface PollRunOutcome {
  ok: boolean;
  tripsSeen: number;
  tripsInserted: number;
  tripsUpdated: number;
  statusInserted: number;
  positionsInserted: number;
  eventsRecorded: number;
  locationStatus?: LocationStatus;
  error?: string;
}

export async function finishPollRun(id: number, outcome: PollRunOutcome): Promise<void> {
  await query(
    `UPDATE poll_runs SET
       finished_at = now(), ok = $2, trips_seen = $3, trips_inserted = $4,
       trips_updated = $5, status_inserted = $6, error = $7,
       positions_inserted = $8, events_recorded = $9, location_status = $10
     WHERE id = $1`,
    [
      id,
      outcome.ok,
      outcome.tripsSeen,
      outcome.tripsInserted,
      outcome.tripsUpdated,
      outcome.statusInserted,
      outcome.error ?? null,
      outcome.positionsInserted,
      outcome.eventsRecorded,
      outcome.locationStatus ?? null,
    ],
  );
}

// --- findMyCar throttle ---
//
// The endpoint is rate limited and answers HT_534 when we overstep, so the budget has
// to be tracked somewhere that survives a container restart. In memory it would reset
// on every bounce, and a crash-looping poller would hammer the endpoint.

export interface LocationFetchState {
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  last_odometer_miles: number | null;
  rate_limited_until: Date | null;
  consecutive_failures: number;
}

export async function getLocationFetchState(vin: string): Promise<LocationFetchState | null> {
  const { rows } = await query<LocationFetchState>(
    `SELECT last_attempt_at, last_success_at, last_odometer_miles,
            rate_limited_until, consecutive_failures
     FROM location_fetch_state WHERE vin = $1`,
    [vin],
  );
  return rows[0] ?? null;
}

/** Stamps an attempt before it is made, so a crash mid-call still costs us the slot. */
export async function markLocationAttempt(vin: string): Promise<void> {
  await query(
    `INSERT INTO location_fetch_state (vin, last_attempt_at, updated_at)
     VALUES ($1, now(), now())
     ON CONFLICT (vin) DO UPDATE SET last_attempt_at = now(), updated_at = now()`,
    [vin],
  );
}

/** Clears the failure count and records the odometer the fix was taken at. */
export async function markLocationSuccess(
  vin: string,
  odometerMiles: number | null,
): Promise<void> {
  await query(
    `INSERT INTO location_fetch_state (
       vin, last_attempt_at, last_success_at, last_odometer_miles,
       rate_limited_until, consecutive_failures, last_error, updated_at
     ) VALUES ($1, now(), now(), $2, NULL, 0, NULL, now())
     ON CONFLICT (vin) DO UPDATE SET
       last_attempt_at     = now(),
       last_success_at     = now(),
       -- COALESCE so a fix taken while the odometer was unreadable does not erase
       -- the last known value and re-trigger the movement gate forever.
       last_odometer_miles = COALESCE(EXCLUDED.last_odometer_miles,
                                      location_fetch_state.last_odometer_miles),
       rate_limited_until   = NULL,
       consecutive_failures = 0,
       last_error           = NULL,
       updated_at           = now()`,
    [vin, odometerMiles],
  );
}

/**
 * Records a failure and, for a rate-limit refusal, sets the window to stay quiet for.
 * Backoff doubles per consecutive failure from `baseMinutes`, capped at `maxMinutes`.
 */
export async function markLocationFailure(
  vin: string,
  options: {
    rateLimited: boolean;
    error: string;
    baseMinutes: number;
    maxMinutes: number;
  },
): Promise<Date | null> {
  const { rows } = await query<{ rate_limited_until: Date | null }>(
    `INSERT INTO location_fetch_state (
       vin, last_attempt_at, consecutive_failures, last_error,
       rate_limited_until, updated_at
     ) VALUES (
       $1, now(), 1, $2,
       CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE NULL END,
       now()
     )
     ON CONFLICT (vin) DO UPDATE SET
       last_attempt_at      = now(),
       consecutive_failures = location_fetch_state.consecutive_failures + 1,
       last_error           = $2,
       rate_limited_until   = CASE
         WHEN $3::boolean THEN now() + make_interval(mins => LEAST(
           -- base * 2^failures: the first refusal waits one base interval, each
           -- consecutive one doubles it. The exponent is clamped at 10 because
           -- power(2, n)::int overflows past 31, and 1024x base is already over
           -- the cap anyway.
           $4::int * power(2, LEAST(location_fetch_state.consecutive_failures, 10))::int,
           $5::int
         )::int)
         ELSE location_fetch_state.rate_limited_until
       END,
       updated_at = now()
     RETURNING rate_limited_until`,
    [vin, options.error, options.rateLimited, options.baseMinutes, options.maxMinutes],
  );
  return rows[0]?.rate_limited_until ?? null;
}

// --- Read paths, used by the API ---

export async function listVehicles() {
  const { rows } = await query(
    `SELECT v.vin, v.nickname, v.generation, v.fuel_type, v.odometer_miles,
            v.first_seen_at, v.last_seen_at,
            (SELECT count(*) FROM trips t WHERE t.vin = v.vin)::int AS trip_count
     FROM vehicles v
     ORDER BY v.nickname`,
  );
  return rows;
}

export interface TripQuery {
  vin?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export async function listTrips(filter: TripQuery) {
  const { rows } = await query(
    `SELECT id, vin, start_date, duration_seconds,
            -- Rendered as text on purpose: node-postgres would otherwise coerce this
            -- zone-less column into a Date using the *host's* timezone, silently
            -- shifting the wall-clock time the car actually reported.
            to_char(start_date_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_date_local,
            distance_miles, odometer_miles, avg_speed, max_speed,
            energy_total_wh, energy_regen_wh, energy_climate_wh,
            energy_drivetrain_wh, energy_accessories_wh, energy_battery_care_wh,
            CASE WHEN energy_total_wh > 0
                 THEN distance_miles / (energy_total_wh / 1000.0)
                 ELSE NULL END AS miles_per_kwh
     FROM trips
     WHERE ($1::text IS NULL OR vin = $1)
       AND ($2::timestamptz IS NULL OR start_date >= $2)
       AND ($3::timestamptz IS NULL OR start_date <= $3)
     ORDER BY start_date DESC
     LIMIT $4 OFFSET $5`,
    [filter.vin ?? null, filter.from ?? null, filter.to ?? null, filter.limit, filter.offset],
  );

  const { rows: countRows } = await query<{ total: number }>(
    `SELECT count(*)::int AS total FROM trips
     WHERE ($1::text IS NULL OR vin = $1)
       AND ($2::timestamptz IS NULL OR start_date >= $2)
       AND ($3::timestamptz IS NULL OR start_date <= $3)`,
    [filter.vin ?? null, filter.from ?? null, filter.to ?? null],
  );

  return { trips: rows, total: countRows[0]?.total ?? 0 };
}

/**
 * The nearest status snapshot to a moment in time, within `windowMinutes`.
 *
 * Hyundai's trip payload carries no coordinates at all, so a trip's start and end
 * locations can only be *approximated* from where the poller happened to observe
 * the car. The returned `minutes_away` says how stale the fix is — without it these
 * numbers would look far more authoritative than they are.
 */
async function nearestLocation(
  vin: string,
  at: string,
  direction: 'before' | 'after',
  windowMinutes = 90,
) {
  const comparison = direction === 'before' ? '<=' : '>=';
  const ordering = direction === 'before' ? 'DESC' : 'ASC';

  // Both sources are searched together. findMyCar fixes are preferred when equally
  // close in time (`source` ordering below) because they were requested at a moment
  // of our choosing, whereas a snapshot's position is whatever the car last
  // volunteered — but a much nearer snapshot still wins on time.
  const { rows } = await query(
    `WITH fixes AS (
       SELECT latitude, longitude, reported_at AS at, 'findMyCar' AS source
       FROM vehicle_positions
       WHERE vin = $1 AND reported_at IS NOT NULL
       UNION ALL
       SELECT latitude, longitude, synced_at AS at, 'status' AS source
       FROM vehicle_status_snapshots
       WHERE vin = $1
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND latitude <> 0 AND longitude <> 0
     )
     SELECT latitude, longitude, at AS synced_at, source,
            round(abs(extract(epoch FROM (at - $2::timestamptz))) / 60.0)::int AS minutes_away
     FROM fixes
     WHERE at ${comparison} $2::timestamptz
       AND abs(extract(epoch FROM (at - $2::timestamptz))) <= $3 * 60
     ORDER BY at ${ordering}, (source = 'findMyCar') DESC
     LIMIT 1`,
    [vin, at, windowMinutes],
  );
  return rows[0] ?? null;
}

export async function listPositions(vin: string | undefined, limit: number) {
  const { rows } = await query(
    `SELECT vin, reported_at, recorded_at, latitude, longitude, altitude, source
     FROM vehicle_positions
     WHERE ($1::text IS NULL OR vin = $1)
     ORDER BY COALESCE(reported_at, recorded_at) DESC
     LIMIT $2`,
    [vin ?? null, limit],
  );
  return rows;
}

export async function listVehicleEvents(vin: string | undefined, limit: number) {
  const { rows } = await query(
    `SELECT id, vin, kind, observed_at, detected_at, previous, current
     FROM vehicle_events
     WHERE ($1::text IS NULL OR vin = $1)
     ORDER BY COALESCE(observed_at, detected_at) DESC
     LIMIT $2`,
    [vin ?? null, limit],
  );
  return rows;
}

export async function getTrip(id: number) {
  const { rows } = await query(
    `SELECT id, vin, start_date, start_date_raw,
            to_char(start_date_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_date_local,
            start_date + make_interval(secs => duration_seconds) AS end_date,
            duration_seconds, drive_time_seconds,
            duration_seconds - COALESCE(drive_time_seconds, duration_seconds) AS idle_seconds,
            distance, distance_unit, distance_miles, odometer, odometer_miles,
            avg_speed, max_speed,
            energy_total_wh, energy_regen_wh, energy_climate_wh,
            energy_drivetrain_wh, energy_accessories_wh, energy_battery_care_wh,
            CASE WHEN energy_total_wh > 0
                 THEN distance_miles / (energy_total_wh / 1000.0)
                 ELSE NULL END AS miles_per_kwh,
            raw, first_seen_at, updated_at
     FROM trips WHERE id = $1`,
    [id],
  );

  const trip = rows[0];
  if (!trip) return null;

  const [startLocation, endLocation] = await Promise.all([
    nearestLocation(trip.vin, trip.start_date.toISOString(), 'before'),
    nearestLocation(trip.vin, trip.end_date.toISOString(), 'after'),
  ]);

  // Resolve each position to a town name from the local GeoNames table.
  const withPlace = async (location: typeof startLocation) => {
    if (!location) return null;
    const place = await nearestPlace(location.latitude, location.longitude);
    return { ...location, label: place?.label ?? null, place_distance_miles: place?.distance_miles ?? null };
  };

  return {
    ...trip,
    startLocation: await withPlace(startLocation),
    endLocation: await withPlace(endLocation),
  };
}

export async function tripSummary(vin?: string, from?: string, to?: string) {
  const { rows } = await query(
    `SELECT count(*)::int                          AS trip_count,
            COALESCE(sum(distance_miles), 0)       AS total_miles,
            COALESCE(sum(energy_total_wh), 0) / 1000.0 AS total_kwh,
            COALESCE(sum(energy_regen_wh), 0) / 1000.0 AS regen_kwh,
            COALESCE(sum(duration_seconds), 0)::int    AS total_seconds,
            max(max_speed)                         AS max_speed,
            min(start_date)                        AS first_trip_at,
            max(start_date)                        AS last_trip_at,
            CASE WHEN COALESCE(sum(energy_total_wh), 0) > 0
                 THEN sum(distance_miles) / (sum(energy_total_wh) / 1000.0)
                 ELSE NULL END                     AS avg_miles_per_kwh
     FROM trips
     WHERE ($1::text IS NULL OR vin = $1)
       AND ($2::timestamptz IS NULL OR start_date >= $2)
       AND ($3::timestamptz IS NULL OR start_date <= $3)`,
    [vin ?? null, from ?? null, to ?? null],
  );
  return rows[0];
}

export async function listStatusSnapshots(vin: string | undefined, limit: number) {
  const { rows } = await query(
    `SELECT vin, synced_at, soc_percent, ev_range_miles, charging, plug_type,
            charge_power, odometer_miles, latitude, longitude, locked, battery_12v,
            engine_running
     FROM vehicle_status_snapshots
     WHERE ($1::text IS NULL OR vin = $1)
     ORDER BY synced_at DESC
     LIMIT $2`,
    [vin ?? null, limit],
  );
  return rows;
}

export async function listPollRuns(limit: number) {
  const { rows } = await query(
    `SELECT id, started_at, finished_at, ok, trips_seen, trips_inserted,
            trips_updated, status_inserted, positions_inserted, events_recorded,
            location_status, error
     FROM poll_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
