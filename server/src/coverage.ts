/**
 * How many of the miles on the car's odometer the archive accounts for.
 *
 * The reference is the odometer itself: over the whole archive, every mile from 0 to
 * the current reading; over a date range, the miles between the readings at its two
 * ends. Whatever falls outside an archived trip is untracked, split by where it falls:
 *
 * - before the first archived trip (for the whole archive, everything driven before
 *   the tracker existed),
 * - in gaps between archived trips, which is driving whose trip fell out of Hyundai's
 *   four-trip window before a poll saw it,
 * - after the last archived trip, which is driving the car has reported on the
 *   odometer but whose trip Hyundai hasn't published yet.
 *
 * Tracked miles are measured by odometer too, not by summing trip distances: Hyundai
 * truncates every trip's distance to whole miles, so that sum runs low by about 0.4 mi
 * per trip (about 5% overall) even with nothing missing. Consecutive trips are
 * contiguous exactly when the later one's distance accounts for the odometer moving
 * between them, so the odometer span of a run of contiguous trips is exactly what they
 * covered.
 *
 * Trips are ordered by odometer, not by start time: Hyundai occasionally stamps a trip
 * with a start time that falls after a trip it actually preceded (seen twice, on
 * 2026-11-04 and 2026-11-09), and time order would turn each into a false gap plus an
 * equally false negative one. The odometer is monotonic, so it can't be wrong that way.
 */
import { EXACT_TOLERANCE_MILES } from './trip-location.ts';

/** The fields of one trip coverage needs. */
export interface CoverageTrip {
  id: number;
  /** Odometer at the trip's end. Trips without one can't be placed and are skipped. */
  odometerMiles: number | null;
  /** As Hyundai reports it: truncated to whole miles. */
  distanceMiles: number;
  /** Only breaks ties between trips that end at the same odometer. */
  startDate: Date;
}

/** The car's odometer at either end of the window being measured. */
export interface OdometerSpan {
  /**
   * 0 for the whole archive (the car's whole life). For a date range, the last reading
   * at or before its start; null when there is none, i.e. the range starts before
   * tracking did, in which case the first archived trip's start stands in.
   */
  startMiles: number | null;
  /**
   * The current reading for an open-ended window, otherwise the last reading at or
   * before its end. Null falls back to the last archived trip's end.
   */
  endMiles: number | null;
}

/** Driving the odometer shows between two archived trips that no trip accounts for. */
export interface CoverageGap {
  vin: string;
  /** The archived trip that ended before the gap. */
  after_trip_id: number;
  /** The archived trip that ended after it. */
  before_trip_id: number;
  /** Odometer where the earlier trip ended. */
  from_odometer_miles: number;
  /** Odometer where the later trip began (its end minus its reported distance). */
  to_odometer_miles: number;
  miles: number;
}

export interface Coverage {
  /** Odometer at the window's start. Null when the window spans several vehicles. */
  odometer_start_miles: number | null;
  /** Odometer at the window's end. Null when the window spans several vehicles. */
  odometer_end_miles: number | null;
  /** What the car drove in the window, by its odometer: the reference. */
  odometer_miles: number;
  /** The part of odometer_miles inside an archived trip. */
  tracked_miles: number;
  /** odometer_miles − tracked_miles, which is the three below added together. */
  untracked_miles: number;
  /** Before the first archived trip in the window. */
  before_first_trip_miles: number;
  /** In gaps between archived trips. */
  missed_miles: number;
  /** After the last archived trip: on the odometer, not yet published as a trip. */
  after_last_trip_miles: number;
  /** tracked / odometer; null when the car didn't move. */
  ratio: number | null;
  gaps: CoverageGap[];
  trips_without_odometer: number;
}

/**
 * How large an odometer excess has to be before it is a missed trip. Reported distance
 * is truncated, so a contiguous trip can show up to a mile of excess on its own; this
 * is the same tolerance the trip-location code uses for "the same odometer".
 */
export const GAP_TOLERANCE_MILES = EXACT_TOLERANCE_MILES;

/** Coverage of one vehicle's trips against its odometer. Input order doesn't matter. */
export function measureCoverage(
  vin: string,
  trips: readonly CoverageTrip[],
  span: OdometerSpan,
): Coverage {
  const placed = trips
    .filter((trip): trip is CoverageTrip & { odometerMiles: number } => trip.odometerMiles !== null)
    // Ties are a zero-distance trip ending where the one before it did. Start time
    // orders those correctly; id does not (trips seen in the same poll get ids in
    // payload order, not driving order), and the wrong order invents a gap.
    .toSorted(
      (a, b) =>
        a.odometerMiles - b.odometerMiles ||
        a.startDate.getTime() - b.startDate.getTime() ||
        a.id - b.id,
    );

  const gaps: CoverageGap[] = [];
  for (const [i, trip] of placed.entries()) {
    const previous = placed[i - 1];
    if (!previous) continue;
    const start = trip.odometerMiles - trip.distanceMiles;
    const excess = start - previous.odometerMiles;
    if (excess > GAP_TOLERANCE_MILES) {
      gaps.push({
        vin,
        after_trip_id: previous.id,
        before_trip_id: trip.id,
        from_odometer_miles: previous.odometerMiles,
        to_odometer_miles: start,
        miles: excess,
      });
    }
  }

  const first = placed[0];
  const last = placed.at(-1);
  // The start is derived from a truncated distance, so it can sit up to a mile past
  // the true start; never let it pass the trip's own end.
  const tripsStart = first ? Math.max(0, first.odometerMiles - first.distanceMiles) : null;
  const tripsEnd = last ? last.odometerMiles : null;

  // The window can't be narrower than the trips inside it: a trip that starts before a
  // range's end can finish after it, and a stored reading can lag a trip's own.
  const start = Math.min(span.startMiles ?? tripsStart ?? 0, tripsStart ?? Infinity);
  const end = Math.max(span.endMiles ?? tripsEnd ?? start, tripsEnd ?? -Infinity, start);
  const odometer = end - start;

  const spanned = tripsStart !== null && tripsEnd !== null ? Math.max(0, tripsEnd - tripsStart) : 0;
  const missed = Math.min(
    spanned,
    gaps.reduce((sum, gap) => sum + gap.miles, 0),
  );
  const tracked = spanned - missed;
  const before = tripsStart === null ? odometer : tripsStart - start;
  const after = tripsEnd === null ? 0 : end - tripsEnd;

  return {
    odometer_start_miles: start,
    odometer_end_miles: end,
    odometer_miles: odometer,
    tracked_miles: tracked,
    untracked_miles: odometer - tracked,
    before_first_trip_miles: before,
    missed_miles: missed,
    after_last_trip_miles: after,
    ratio: odometer > 0 ? tracked / odometer : null,
    gaps,
    trips_without_odometer: trips.length - placed.length,
  };
}

/**
 * Several vehicles' coverage as one figure. Odometers don't add across cars, so the
 * start/end readings survive only when there is exactly one vehicle.
 */
export function combineCoverage(parts: readonly Coverage[]): Coverage {
  const [only] = parts;
  if (only && parts.length === 1) return only;

  const sum = (pick: (part: Coverage) => number) =>
    parts.reduce((total, part) => total + pick(part), 0);
  const odometer = sum((part) => part.odometer_miles);
  const tracked = sum((part) => part.tracked_miles);
  return {
    odometer_start_miles: null,
    odometer_end_miles: null,
    odometer_miles: odometer,
    tracked_miles: tracked,
    untracked_miles: odometer - tracked,
    before_first_trip_miles: sum((part) => part.before_first_trip_miles),
    missed_miles: sum((part) => part.missed_miles),
    after_last_trip_miles: sum((part) => part.after_last_trip_miles),
    ratio: odometer > 0 ? tracked / odometer : null,
    gaps: parts.flatMap((part) => part.gaps),
    trips_without_odometer: sum((part) => part.trips_without_odometer),
  };
}
