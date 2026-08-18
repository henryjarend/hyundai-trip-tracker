/**
 * Choosing which recorded position fix stands for a trip's start or end.
 *
 * Hyundai's trip payload carries no coordinates whatsoever and `findMyCar` only ever
 * answers "where is the car now" — there is no history endpoint anywhere in the API.
 * A trip's endpoints can therefore only be recovered from fixes we happened to record
 * around it, which makes *which* fix to trust the whole problem.
 *
 * The naive rule is "nearest in time, within some window", and it fails badly: fixes
 * arrive at the car's own sync cadence, so a trip that starts an hour after the last
 * observation gets no start location at all even though the car demonstrably never
 * moved in between.
 *
 * The odometer is what fixes that. It is monotonic, and it appears in both the trip
 * row and every status snapshot, so a fix whose odometer equals the trip's boundary
 * odometer was taken while the car sat at that boundary — however long before or
 * after. A parked car cannot have moved without the odometer moving, so such a fix is
 * not an approximation at all, and stays valid for arbitrarily large gaps in polling.
 * Time-nearness survives only as the fallback for fixes with no odometer.
 *
 * Pure so the rules can be tested without a database, like `ingest/location-policy.ts`.
 */

export type FixSource = 'findMyCar' | 'status';

/** A position we recorded, from either source, with whatever odometer came with it. */
export interface Fix {
  latitude: number;
  longitude: number;
  /** When the *car* reported the fix, not when we asked for it. */
  at: Date;
  source: FixSource;
  /** Odometer at the moment of the fix; null for fixes recorded before it was stored. */
  odometerMiles: number | null;
}

/** One end of a trip: the moment, the odometer there, and how far each may be off. */
export interface Boundary {
  edge: 'start' | 'end';
  at: Date;
  odometerMiles: number | null;
  /**
   * How much disagreement still counts as the same odometer. Status snapshots report
   * whole miles while trips carry decimals, so even an exactly known boundary needs
   * about a mile of slack — and a boundary derived from a rounded trip distance needs
   * more. The caller says which case this is.
   */
  odometerToleranceMiles: number;
  /**
   * The neighbouring trip's boundary. A fix beyond it was taken during or after a
   * different drive, so it cannot stand for this one no matter what its odometer
   * says — this is what stops a sub-mile trip from being confused with its neighbour.
   * Null when there is no known neighbour (the archive's edge, or a trip that fell
   * out of Hyundai's four-trip window before we ever saw it).
   */
  limit: Date | null;
}

export interface ResolvedFix {
  latitude: number;
  longitude: number;
  at: Date;
  source: FixSource;
  odometer_miles: number | null;
  /** Distance from the trip boundary in minutes; 0 when the fix lands on it. */
  minutes_away: number;
  /**
   * Why this fix was accepted. `odometer` means the car provably had not moved
   * between the fix and the boundary. `time` means it is merely the nearest
   * observation, and could be anywhere along the route.
   */
  basis: 'odometer' | 'time';
}

/** How near in time a fix with no odometer has to be to stand in for a boundary. */
const DEFAULT_WINDOW_MINUTES = 90;

const MINUTE_MS = 60_000;

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / MINUTE_MS;
}

/**
 * Picks the best fix for one boundary out of `fixes`, which may be in any order and
 * may contain fixes on the wrong side of it. Returns null when nothing qualifies —
 * an honest gap, which the UI shows as "no location", is the correct answer far more
 * often than the nearest fix from three hours and two errands away.
 */
export function chooseBoundaryFix(
  fixes: readonly Fix[],
  boundary: Boundary,
  options: { windowMinutes?: number } = {},
): ResolvedFix | null {
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;

  // A start location can only come from before the car left; an end location only
  // from after it arrived. Anything on the other side is mid-route.
  const onCorrectSide = (fix: Fix) =>
    boundary.edge === 'start' ? fix.at <= boundary.at : fix.at >= boundary.at;

  const withinLimit = (fix: Fix) => {
    if (boundary.limit === null) return true;
    return boundary.edge === 'start' ? fix.at >= boundary.limit : fix.at <= boundary.limit;
  };

  const odometerAgrees = (fix: Fix) =>
    fix.odometerMiles !== null &&
    boundary.odometerMiles !== null &&
    Math.abs(fix.odometerMiles - boundary.odometerMiles) <= boundary.odometerToleranceMiles;

  const candidates = fixes.filter((fix) => onCorrectSide(fix) && withinLimit(fix));

  // Nearest to the boundary first, and a fix we asked for ahead of one the car merely
  // volunteered at the same instant.
  const byProximity = [...candidates].sort((a, b) => {
    const delta = minutesBetween(a.at, boundary.at) - minutesBetween(b.at, boundary.at);
    if (delta !== 0) return delta;
    return Number(b.source === 'findMyCar') - Number(a.source === 'findMyCar');
  });

  const resolve = (fix: Fix, basis: 'odometer' | 'time'): ResolvedFix => ({
    latitude: fix.latitude,
    longitude: fix.longitude,
    at: fix.at,
    source: fix.source,
    odometer_miles: fix.odometerMiles,
    minutes_away: Math.round(minutesBetween(fix.at, boundary.at)),
    basis,
  });

  // Proven by the odometer, at any distance in time.
  const proven = byProximity.find(odometerAgrees);
  if (proven) return resolve(proven, 'odometer');

  // Otherwise the nearest fix that has no odometer to check, inside the time window.
  // Fixes whose odometer *disagrees* are excluded rather than demoted: the car is
  // known to have moved between them and the boundary.
  const nearby = byProximity.find(
    (fix) =>
      (fix.odometerMiles === null || boundary.odometerMiles === null) &&
      minutesBetween(fix.at, boundary.at) <= windowMinutes,
  );
  return nearby ? resolve(nearby, 'time') : null;
}

/** The odometer fields a trip needs for its boundaries to be worked out. */
export interface TripOdometer {
  odometerMiles: number | null;
  distanceMiles: number | null;
}

/** Tolerance for two readings of the same odometer, one of which is whole-mile. */
const EXACT_TOLERANCE_MILES = 1;
/**
 * Tolerance once a *rounded* trip distance has been subtracted: Hyundai reports trip
 * distance in whole miles, so the derived start odometer inherits that error on top.
 */
const DERIVED_TOLERANCE_MILES = 2;

/**
 * The odometer at a trip's start, which the payload does not carry.
 *
 * The previous trip's ending odometer is the exact answer whenever the two trips are
 * contiguous — but they often are not, because a trip can fall out of Hyundai's
 * four-trip window unseen. Subtracting this trip's own distance is the fallback, and
 * costs precision because that distance is rounded to whole miles.
 */
export function startOdometer(
  trip: TripOdometer,
  previous: TripOdometer | null,
): { odometerMiles: number | null; toleranceMiles: number } {
  const end = trip.odometerMiles;
  const distance = trip.distanceMiles;

  if (end !== null && distance !== null && previous?.odometerMiles != null) {
    const gap = end - previous.odometerMiles - distance;
    // Contiguous: the previous trip ended exactly this trip's distance ago, so no
    // unseen driving happened in between and its odometer *is* this trip's start.
    if (previous.odometerMiles <= end && Math.abs(gap) <= EXACT_TOLERANCE_MILES) {
      return { odometerMiles: previous.odometerMiles, toleranceMiles: EXACT_TOLERANCE_MILES };
    }
  }

  if (end === null || distance === null) {
    return { odometerMiles: null, toleranceMiles: EXACT_TOLERANCE_MILES };
  }

  return { odometerMiles: end - distance, toleranceMiles: DERIVED_TOLERANCE_MILES };
}

export { EXACT_TOLERANCE_MILES, DERIVED_TOLERANCE_MILES };
