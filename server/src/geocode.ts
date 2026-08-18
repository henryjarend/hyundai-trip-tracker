/**
 * Offline reverse geocoding: coordinates → nearest town.
 *
 * Resolved entirely against the local `geonames_cities` table (populated by
 * `npm run geonames:load`), so no coordinates are ever sent to a third party and
 * there are no API keys or rate limits to respect.
 *
 * Lookups happen at read time rather than at ingest. They are a single indexed
 * query, so there is nothing to cache and no stale labels to invalidate — loading
 * a newer GeoNames dump improves every existing trip immediately.
 */
import { query } from './db/pool.ts';

export interface NearestPlace {
  name: string;
  region: string | null;
  country_code: string | null;
  /** Distance from the queried coordinate, in miles. */
  distance_miles: number;
  /** "Rockford, Michigan" — region resolved to a full name where known. */
  label: string;
}

/**
 * Nothing sensible is within this radius of an ocean coordinate, and returning a
 * town 200 miles away would be worse than returning nothing.
 */
const MAX_DISTANCE_METRES = 80_000;

export async function nearestPlace(
  latitude: number,
  longitude: number,
): Promise<NearestPlace | null> {
  if (latitude === 0 && longitude === 0) return null;

  const { rows } = await query<NearestPlace>(
    `SELECT c.name,
            a.name AS region,
            c.country_code,
            earth_distance(ll_to_earth(c.latitude, c.longitude),
                           ll_to_earth($1, $2)) / 1609.344 AS distance_miles,
            -- Prefer the spelled-out region ("Michigan"); fall back to the raw
            -- admin code when the dump has no name for it.
            c.name || COALESCE(', ' || a.name, COALESCE(', ' || c.admin1_code, '')) AS label
     FROM geonames_cities c
     LEFT JOIN geonames_admin1 a
            ON a.code = c.country_code || '.' || c.admin1_code
     WHERE earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(c.latitude, c.longitude)
       AND earth_distance(ll_to_earth(c.latitude, c.longitude), ll_to_earth($1, $2)) <= $3
     -- earth_box uses the GIST index to shrink the candidate set; this then
     -- orders those few by true great-circle distance.
     ORDER BY ll_to_earth(c.latitude, c.longitude) <-> ll_to_earth($1, $2)
     LIMIT 1`,
    [latitude, longitude, MAX_DISTANCE_METRES],
  );

  return rows[0] ?? null;
}

/** True once the GeoNames dataset has been loaded, so the UI can explain itself. */
export async function geonamesLoaded(): Promise<boolean> {
  try {
    const { rows } = await query<{ loaded: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM geonames_cities) AS loaded',
    );
    return rows[0]?.loaded ?? false;
  } catch {
    // Table missing entirely (migrations not yet run) counts as not loaded.
    return false;
  }
}
