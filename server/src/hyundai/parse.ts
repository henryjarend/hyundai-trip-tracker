/**
 * Response parsing, ported from BetterBlueKit's HyundaiUSAAPIClient+Parsing.swift.
 *
 * Everything here is defensive: the Hyundai backend omits fields without warning
 * and occasionally changes their types. Anything unparseable is skipped rather
 * than thrown on, and the untouched payload is always kept alongside in `raw`.
 */
import type {
  AuthToken,
  FuelType,
  PlugType,
  Trip,
  Vehicle,
  VehiclePosition,
  VehicleStatusSnapshot,
} from './types.ts';

const KM_UNIT = 1;
const MILES_PER_KM = 0.621371;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/** Hyundai returns numbers as numbers or as strings depending on the field and the day. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Pulls `.value` out of the `{value, unit}` wrappers the API uses for measurements. */
function wrappedValue(value: unknown): number | null {
  const obj = asObject(value);
  return obj ? num(obj.value) : num(value);
}

function toMiles(value: number, unit: number): number {
  return unit === KM_UNIT ? value * MILES_PER_KM : value;
}

export function parseLoginResponse(body: unknown): AuthToken {
  const json = asObject(body);
  const accessToken = json?.access_token;
  const refreshToken = json?.refresh_token;
  // `expires_in` comes back as a *string* of seconds, not a number.
  const expiresIn = num(json?.expires_in);

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || expiresIn === null) {
    throw new Error('Invalid login response: missing access_token/refresh_token/expires_in');
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function parseVehiclesResponse(body: unknown): Vehicle[] {
  const json = asObject(body);
  const enrolled = json?.enrolledVehicleDetails;
  if (!Array.isArray(enrolled)) {
    throw new Error('Invalid vehicles response: enrolledVehicleDetails missing');
  }

  const vehicles: Vehicle[] = [];
  for (const entry of enrolled) {
    const details = asObject(asObject(entry)?.vehicleDetails);
    if (!details) continue;

    const { vin, regid: regId, nickName, evStatus, vehicleGeneration } = details;
    if (typeof vin !== 'string' || typeof regId !== 'string') continue;

    const fuelType: FuelType = evStatus === 'E' ? 'electric' : evStatus === 'P' ? 'phev' : 'gas';

    vehicles.push({
      vin,
      regId,
      nickname: typeof nickName === 'string' ? nickName : vin,
      generation: num(vehicleGeneration) ?? 1,
      fuelType,
      odometerMiles: num(details.odometer),
    });
  }
  return vehicles;
}

/**
 * `startdate` looks like "2026-08-16 14:32:07.0" and carries no timezone at all.
 * We keep the string verbatim (it is the dedupe key) and also normalise it to an
 * ISO-ish local form; resolving it to a real instant happens at ingest using
 * VEHICLE_TZ, not here.
 */
function normaliseLocalTimestamp(raw: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export interface TripParseResult {
  trips: Trip[];
  /** Why each unusable entry was dropped — surfaced so silent data loss is visible. */
  skipped: string[];
}

/**
 * Parses the trip payload and reports what it had to drop. A dropped entry is the
 * most likely way this project loses data silently: Hyundai returns a trip in a
 * shape we don't expect, it vanishes, and the poll still looks successful.
 */
export function parseTripsResponseDetailed(body: unknown): TripParseResult {
  const json = asObject(body);
  const details = json?.tripdetails;
  if (!Array.isArray(details)) {
    throw new Error(
      `Invalid trip response: tripdetails missing. Top-level keys: ${
        json ? Object.keys(json).join(', ') || '(none)' : '(not an object)'
      }`,
    );
  }

  const trips: Trip[] = [];
  const skipped: string[] = [];
  for (const [index, entry] of details.entries()) {
    const trip = asObject(entry);
    if (!trip) {
      skipped.push(`entry ${index}: not an object`);
      continue;
    }

    const startDateRaw = trip.startdate;
    if (typeof startDateRaw !== 'string') {
      skipped.push(`entry ${index}: startdate missing or not a string (keys: ${Object.keys(trip).join(', ')})`);
      continue;
    }
    const startDateLocal = normaliseLocalTimestamp(startDateRaw);
    if (startDateLocal === null) {
      skipped.push(`entry ${index}: unrecognised startdate format "${startDateRaw}"`);
      continue;
    }

    const distance = num(trip.distance);
    const totalUsed = num(trip.totalused);
    if (distance === null || totalUsed === null) {
      skipped.push(
        `entry ${index} (${startDateRaw}): missing ${distance === null ? 'distance' : ''}` +
          `${distance === null && totalUsed === null ? ' and ' : ''}` +
          `${totalUsed === null ? 'totalused' : ''} (keys: ${Object.keys(trip).join(', ')})`,
      );
      continue;
    }

    // The {value, unit} wrappers carry the account's unit system; the bare
    // `distance` field shares whatever unit the odometer reports in.
    const odometerObj = asObject(trip.odometer);
    const distanceUnit = num(odometerObj?.unit) ?? 3;
    const odometer = wrappedValue(trip.odometer);

    trips.push({
      startDateRaw,
      startDateLocal,
      durationSeconds: wrappedValue(trip.duration) ?? 0,
      driveTimeSeconds: wrappedValue(trip.mileagetime),
      distanceUnit,
      distance,
      odometer,
      distanceMiles: toMiles(distance, distanceUnit),
      odometerMiles: odometer === null ? null : toMiles(odometer, distanceUnit),
      avgSpeed: wrappedValue(trip.avgspeed),
      maxSpeed: wrappedValue(trip.maxspeed),
      energyTotalWh: totalUsed,
      energyRegenWh: num(trip.regen) ?? 0,
      energyClimateWh: num(trip.climate) ?? 0,
      energyDrivetrainWh: num(trip.drivetrain) ?? 0,
      energyAccessoriesWh: num(trip.accessories) ?? 0,
      energyBatteryCareWh: num(trip.batterycare) ?? 0,
      raw: trip,
    });
  }
  return { trips, skipped };
}

export function parseTripsResponse(body: unknown): Trip[] {
  return parseTripsResponseDetailed(body).trips;
}

function parsePlugType(batteryPlugin: number | null): PlugType {
  switch (batteryPlugin) {
    case 0:
      return 'none';
    case 1:
      return 'dc';
    case 2:
      return 'ac';
    default:
      return 'unknown';
  }
}

/** Digs the EV range out of evStatus.drvDistance[].rangeByFuel, in miles. */
function parseEvRangeMiles(evStatus: Json | null): number | null {
  const distances = evStatus?.drvDistance;
  if (!Array.isArray(distances)) return null;

  for (const entry of distances) {
    const rangeByFuel = asObject(asObject(entry)?.rangeByFuel);
    if (!rangeByFuel) continue;
    const source = asObject(rangeByFuel.evModeRange) ?? asObject(rangeByFuel.totalAvailableRange);
    if (!source) continue;
    const value = num(source.value);
    if (value === null) continue;
    return toMiles(value, num(source.unit) ?? 3);
  }
  return null;
}

export function parseVehicleStatusResponse(body: unknown): VehicleStatusSnapshot {
  const json = asObject(body);
  const status = asObject(json?.vehicleStatus);
  if (!status) {
    throw new Error('Invalid status response: vehicleStatus missing');
  }

  const evStatus = asObject(status.evStatus);
  const battery = asObject(status.battery);
  const coord = asObject(asObject(status.vehicleLocation)?.coord);

  const chargePower = Math.max(
    num(evStatus?.batteryStndChrgPower) ?? 0,
    num(evStatus?.batteryFstChrgPower) ?? 0,
  );

  const syncedRaw = status.dateTime;
  const synced = typeof syncedRaw === 'string' ? new Date(syncedRaw) : null;

  return {
    syncedAt: synced && !Number.isNaN(synced.getTime()) ? synced.toISOString() : null,
    socPercent: num(evStatus?.batteryStatus),
    evRangeMiles: parseEvRangeMiles(evStatus),
    charging: typeof evStatus?.batteryCharge === 'boolean' ? evStatus.batteryCharge : null,
    plugType: parsePlugType(num(evStatus?.batteryPlugin)),
    chargePower: chargePower > 0 ? chargePower : null,
    odometerMiles: wrappedValue(status.odometer),
    latitude: num(coord?.lat),
    longitude: num(coord?.lon),
    locked: typeof status.doorLock === 'boolean' ? status.doorLock : null,
    battery12v: num(battery?.batSoc),
    engineRunning: typeof status.engine === 'boolean' ? status.engine : null,
    raw: status,
  };
}

/** Matches "Tue, 24 Jun 2025 16:18:10 GMT" — the only form that pins down a real instant. */
const RFC_1123_GMT = /^[A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/;

interface ParsedFixTime {
  reportedAt: string | null;
  reportedAtLocal: string | null;
}

/**
 * `findMyCar` stamps its fixes in one of two shapes, and they mean different things:
 *
 * - "Tue, 24 Jun 2025 16:18:10 GMT" — explicitly UTC, so it resolves to an instant.
 * - "20250624161810" (or an ISO-ish variant with separators) — carries no zone at
 *   all, exactly like a trip's `startdate`. Resolved with VEHICLE_TZ at ingest
 *   rather than guessed at here.
 *
 * Treating the second form as UTC would silently shift every fix by the offset,
 * which is the kind of error that looks plausible on a map and stays unnoticed.
 */
function parseFixTime(value: unknown): ParsedFixTime {
  if (typeof value !== 'string' || value.trim() === '') {
    return { reportedAt: null, reportedAtLocal: null };
  }

  const raw = value.trim();

  if (RFC_1123_GMT.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return { reportedAt: parsed.toISOString(), reportedAtLocal: null };
    }
  }

  // Strip the separators the compact form sometimes arrives with, then read the
  // fixed-width digits positionally.
  const digits = raw.replace(/[-T:Z\s]/g, '');
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(digits);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return {
      reportedAt: null,
      reportedAtLocal: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    };
  }

  return { reportedAt: null, reportedAtLocal: null };
}

/**
 * Parses a `findMyCar` response.
 *
 * Returns null when the payload carries no usable fix. That is a routine outcome,
 * not an error: the backend answers 200 with no `coord` when it has no position to
 * give. Rate limiting is signalled the same way (a 200 body carrying errorCode 502
 * / errorSubCode HT_534) and is detected in the client, which can act on it.
 */
export function parseFindMyCarResponse(body: unknown): VehiclePosition | null {
  const json = asObject(body);
  const coord = asObject(json?.coord);

  const latitude = num(coord?.lat);
  const longitude = num(coord?.lon);
  if (latitude === null || longitude === null) return null;

  // (0, 0) is the backend's "no idea" answer, not a fix in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;

  const { reportedAt, reportedAtLocal } = parseFixTime(json?.time);

  return {
    latitude,
    longitude,
    altitude: num(coord?.alt),
    reportedAtRaw: typeof json?.time === 'string' ? json.time : null,
    reportedAt,
    reportedAtLocal,
    raw: json,
  };
}

/**
 * True when a 200 response body is actually the backend refusing on rate-limit
 * grounds. `findMyCar` reports this in-band rather than with HTTP 429.
 */
export function isRateLimitBody(body: unknown): boolean {
  const json = asObject(body);
  return num(json?.errorCode) === 502 && json?.errorSubCode === 'HT_534';
}
