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
  raw: unknown;
}
