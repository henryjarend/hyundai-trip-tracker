export interface Vehicle {
  vin: string;
  nickname: string | null;
  generation: number;
  fuel_type: string;
  odometer_miles: number | null;
  first_seen_at: string;
  last_seen_at: string;
  trip_count: number;
}

export interface Trip {
  id: number;
  vin: string;
  start_date: string;
  start_date_local: string;
  duration_seconds: number;
  distance_miles: number;
  odometer_miles: number | null;
  avg_speed: number | null;
  max_speed: number | null;
  energy_total_wh: number;
  energy_regen_wh: number;
  energy_climate_wh: number;
  energy_drivetrain_wh: number;
  energy_accessories_wh: number;
  energy_battery_care_wh: number;
  miles_per_kwh: number | null;
}

export interface Summary {
  trip_count: number;
  total_miles: number;
  total_kwh: number;
  regen_kwh: number;
  total_seconds: number;
  max_speed: number | null;
  first_trip_at: string | null;
  last_trip_at: string | null;
  avg_miles_per_kwh: number | null;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    // The API puts a human-readable reason in `error` (e.g. Postgres being down);
    // prefer it over a bare status code.
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(detail ?? `${path} failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchVehicles(): Promise<{ vehicles: Vehicle[] }> {
  return get('/api/vehicles');
}

/** A time window for the archive. Both ends are optional and independent. */
export interface TimeWindow {
  from?: string;
  to?: string;
}

function withWindow(query: URLSearchParams, vin: string | null, window: TimeWindow): string {
  if (vin) query.set('vin', vin);
  if (window.from) query.set('from', window.from);
  if (window.to) query.set('to', window.to);
  return query.toString();
}

export function fetchTrips(
  vin: string | null,
  window: TimeWindow = {},
): Promise<{ trips: Trip[]; total: number }> {
  return get(`/api/trips?${withWindow(new URLSearchParams({ limit: '500' }), vin, window)}`);
}

/** Where a position came from. A requested fix is better evidence than a volunteered one. */
export type PositionSource = 'findMyCar' | 'status';

export interface TripLocation {
  latitude: number;
  longitude: number;
  synced_at: string;
  /**
   * Why this fix stands for the boundary. `odometer` means the car's odometer proves
   * it had not moved between the two, so the position is exact however old the fix is.
   * `time` means it is only the nearest reading, and the car could have been anywhere
   * along the route.
   */
  basis: 'odometer' | 'time';
  /** The odometer recorded with the fix, when the car was parked and it was known. */
  odometer_miles: number | null;
  /** How far the fix is from the trip boundary in time. */
  minutes_away: number;
  /** Nearest town from the local GeoNames data. Null if that dataset isn't loaded. */
  label: string | null;
  /** How far the named town is from the actual coordinate, in miles. */
  place_distance_miles: number | null;
  source: PositionSource;
}

export interface TripDetail extends Trip {
  start_date_raw: string;
  end_date: string;
  drive_time_seconds: number | null;
  idle_seconds: number | null;
  distance: number;
  distance_unit: number;
  odometer: number | null;
  raw: Record<string, unknown>;
  first_seen_at: string;
  updated_at: string;
  startLocation: TripLocation | null;
  endLocation: TripLocation | null;
}

export function fetchTrip(id: number): Promise<TripDetail> {
  return get(`/api/trips/${id}`);
}

/**
 * Why a poll did or did not spend a rate-limited findMyCar call. `rate_limited` and
 * `failed` are the two the UI must not hide — a silent backoff can last hours.
 */
export type LocationStatus =
  | 'fetched'
  | 'skipped_throttled'
  | 'skipped_no_movement'
  | 'rate_limited'
  | 'failed'
  | 'disabled';

export interface PollRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  trips_seen: number;
  trips_inserted: number;
  trips_updated: number;
  status_inserted: number;
  positions_inserted: number;
  events_recorded: number;
  location_status: LocationStatus | null;
  error: string | null;
}

export function fetchPollRuns(): Promise<{ runs: PollRun[] }> {
  return get('/api/poll-runs?limit=1');
}

export function fetchSummary(vin: string | null, window: TimeWindow = {}): Promise<Summary> {
  return get(`/api/stats/summary?${withWindow(new URLSearchParams(), vin, window)}`);
}

export interface StatusSnapshot {
  vin: string;
  synced_at: string;
  soc_percent: number | null;
  ev_range_miles: number | null;
  charging: boolean | null;
  plug_type: string | null;
  charge_power: number | null;
  odometer_miles: number | null;
  latitude: number | null;
  longitude: number | null;
  locked: boolean | null;
  battery_12v: number | null;
  engine_running: boolean | null;
}

export interface Position {
  vin: string;
  /** When the car reported the fix. Null if the payload carried no usable time. */
  reported_at: string | null;
  /** When we stored it — always known, so it is the fallback for ordering. */
  recorded_at: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  source: PositionSource;
}

export type EventKind =
  | 'engine_on'
  | 'engine_off'
  | 'moved'
  | 'charge_start'
  | 'charge_stop'
  | 'plugged_in'
  | 'unplugged';

export interface VehicleEvent {
  id: number;
  vin: string;
  kind: EventKind;
  /** Roughly when it happened, from the snapshot that revealed it. */
  observed_at: string | null;
  /** When we noticed. Always >= observed_at, often well after it. */
  detected_at: string;
  previous: unknown;
  current: unknown;
}

function withVin(vin: string | null, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  if (vin) query.set('vin', vin);
  return query.toString();
}

/** The newest status snapshot, which is what "right now" means for the car. */
export function fetchLatestStatus(vin: string | null): Promise<{ snapshots: StatusSnapshot[] }> {
  return get(`/api/status?${withVin(vin, { limit: '1' })}`);
}

export function fetchPositions(vin: string | null, limit = 1): Promise<{ positions: Position[] }> {
  return get(`/api/positions?${withVin(vin, { limit: String(limit) })}`);
}

export function fetchEvents(vin: string | null, limit = 100): Promise<{ events: VehicleEvent[] }> {
  return get(`/api/events?${withVin(vin, { limit: String(limit) })}`);
}
