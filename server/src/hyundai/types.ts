/** Domain types for the Hyundai USA (Bluelink) API, ported from BetterBlueKit. */

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export type FuelType = 'electric' | 'phev' | 'gas';

export interface Vehicle {
  vin: string;
  regId: string;
  nickname: string;
  generation: number;
  fuelType: FuelType;
  /** Odometer in miles, as reported by the enrollment endpoint. */
  odometerMiles: number | null;
}

export interface Trip {
  /** `startdate` verbatim, e.g. "2026-08-16 14:32:07.0". The dedupe key. */
  startDateRaw: string;
  /** Same wall-clock time as an ISO string with no zone, e.g. "2026-08-16T14:32:07". */
  startDateLocal: string;
  /** Total elapsed time, including time stopped. */
  durationSeconds: number;
  /**
   * From the payload's `mileagetime`, which runs consistently below `duration` —
   * time actually moving. `duration - driveTimeSeconds` is time idle.
   */
  driveTimeSeconds: number | null;
  /** Unit code as reported: 1 = kilometres, anything else = miles. */
  distanceUnit: number;
  distance: number;
  odometer: number | null;
  distanceMiles: number;
  odometerMiles: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  energyTotalWh: number;
  energyRegenWh: number;
  energyClimateWh: number;
  energyDrivetrainWh: number;
  energyAccessoriesWh: number;
  energyBatteryCareWh: number;
  raw: unknown;
}

export type PlugType = 'dc' | 'ac' | 'none' | 'unknown';

export interface VehicleStatusSnapshot {
  /** From `vehicleStatus.dateTime`, ISO 8601. Null when the backend omits it. */
  syncedAt: string | null;
  socPercent: number | null;
  evRangeMiles: number | null;
  charging: boolean | null;
  plugType: PlugType;
  chargePower: number | null;
  odometerMiles: number | null;
  latitude: number | null;
  longitude: number | null;
  locked: boolean | null;
  battery12v: number | null;
  /**
   * From `vehicleStatus.engine`. The only field in the cached payload that says
   * whether the car is running right now, which is what makes trip-in-progress
   * detection possible at all.
   */
  engineRunning: boolean | null;
  raw: unknown;
}

/**
 * A position fix from `rcs/rfc/findMyCar`.
 *
 * Unlike the coordinates embedded in a status snapshot, this is fetched on demand
 * rather than whenever the car last chose to sync — but the endpoint is rate
 * limited, so each call has to be worth making.
 */
export interface VehiclePosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** `time` verbatim, so a mis-resolved format stays recoverable. */
  reportedAtRaw: string | null;
  /**
   * Resolved instant, set only when `time` carried a zone (the RFC-1123 "… GMT"
   * form). Null when the stamp was zone-less — `reportedAtLocal` carries it then.
   */
  reportedAt: string | null;
  /**
   * Zone-less wall clock ("2026-08-18T09:14:02"), resolved with VEHICLE_TZ at
   * ingest the same way trip timestamps are. Null when `reportedAt` is set.
   */
  reportedAtLocal: string | null;
  raw: unknown;
}
