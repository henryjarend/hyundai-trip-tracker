/** All database reads and writes. */
import { query } from './pool.ts';
import { nearestPlace } from '../geocode.ts';
import type { Trip, Vehicle, VehicleStatusSnapshot } from '../hyundai/types.ts';

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
       charge_power, odometer_miles, latitude, longitude, locked, battery_12v, raw
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      JSON.stringify(snapshot.raw),
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

export interface PollRunOutcome {
  ok: boolean;
  tripsSeen: number;
  tripsInserted: number;
  tripsUpdated: number;
  statusInserted: number;
  error?: string;
}

export async function finishPollRun(id: number, outcome: PollRunOutcome): Promise<void> {
  await query(
    `UPDATE poll_runs SET
       finished_at = now(), ok = $2, trips_seen = $3, trips_inserted = $4,
       trips_updated = $5, status_inserted = $6, error = $7
     WHERE id = $1`,
    [
      id,
      outcome.ok,
      outcome.tripsSeen,
      outcome.tripsInserted,
      outcome.tripsUpdated,
      outcome.statusInserted,
      outcome.error ?? null,
    ],
  );
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

  const { rows } = await query(
    `SELECT latitude, longitude, synced_at,
            round(abs(extract(epoch FROM (synced_at - $2::timestamptz))) / 60.0)::int AS minutes_away
     FROM vehicle_status_snapshots
     WHERE vin = $1
       AND latitude IS NOT NULL AND longitude IS NOT NULL
       AND latitude <> 0 AND longitude <> 0
       AND synced_at ${comparison} $2::timestamptz
       AND abs(extract(epoch FROM (synced_at - $2::timestamptz))) <= $3 * 60
     ORDER BY synced_at ${ordering}
     LIMIT 1`,
    [vin, at, windowMinutes],
  );
  return rows[0] ?? null;
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
            charge_power, odometer_miles, latitude, longitude, locked, battery_12v
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
            trips_updated, status_inserted, error
     FROM poll_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
