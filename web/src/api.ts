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

export function fetchTrips(vin: string | null): Promise<{ trips: Trip[]; total: number }> {
  const query = new URLSearchParams({ limit: '500' });
  if (vin) query.set('vin', vin);
  return get(`/api/trips?${query}`);
}

export interface TripLocation {
  latitude: number;
  longitude: number;
  synced_at: string;
  /** How far the fix is from the trip boundary — these locations are approximate. */
  minutes_away: number;
  /** Nearest town from the local GeoNames data. Null if that dataset isn't loaded. */
  label: string | null;
  /** How far the named town is from the actual coordinate, in miles. */
  place_distance_miles: number | null;
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

export interface PollRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  trips_seen: number;
  trips_inserted: number;
  status_inserted: number;
  error: string | null;
}

export function fetchPollRuns(): Promise<{ runs: PollRun[] }> {
  return get('/api/poll-runs?limit=1');
}

export function fetchSummary(vin: string | null): Promise<Summary> {
  const query = new URLSearchParams();
  if (vin) query.set('vin', vin);
  return get(`/api/stats/summary?${query}`);
}
