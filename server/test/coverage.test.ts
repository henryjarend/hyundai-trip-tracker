/**
 * Coverage against the odometer. The odometers here are lifted from live trips,
 * including the two Hyundai mis-stamped, so the cases match what the archive holds.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  combineCoverage,
  measureCoverage,
  type Coverage,
  type CoverageTrip,
  type OdometerSpan,
} from '../src/coverage.ts';

const VIN = 'KM8TEST';

const BASE = Date.parse('2026-11-03T12:00:00Z');

/** Start time defaults to id minutes after BASE: increasing, as ids usually are. */
function trip(
  id: number,
  odometerMiles: number | null,
  distanceMiles: number,
  startDate = new Date(BASE + id * 60_000),
): CoverageTrip {
  return { id, odometerMiles, distanceMiles, startDate };
}

/** A window bounded by the trips themselves, so only gaps can be untracked. */
const TRIPS_ONLY: OdometerSpan = { startMiles: null, endMiles: null };

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

/** The breakdown must always add back up to the odometer. */
function assertBalanced(coverage: Coverage) {
  close(coverage.tracked_miles + coverage.untracked_miles, coverage.odometer_miles);
  close(
    coverage.before_first_trip_miles + coverage.missed_miles + coverage.after_last_trip_miles,
    coverage.untracked_miles,
  );
}

test('the whole archive is measured against the odometer from zero', () => {
  // The live shape: tracking began at 2,628 and the car now reads 7,446.
  const coverage = measureCoverage(
    VIN,
    [trip(1, 2630.3198, 2), trip(2, 7440.199, 4809)],
    { startMiles: 0, endMiles: 7446.199 },
  );

  assert.equal(coverage.odometer_start_miles, 0);
  assert.equal(coverage.odometer_end_miles, 7446.199);
  close(coverage.odometer_miles, 7446.199);
  close(coverage.before_first_trip_miles, 2628.3198);
  close(coverage.after_last_trip_miles, 6);
  close(coverage.missed_miles, 0);
  close(coverage.tracked_miles, 7440.199 - 2628.3198);
  assert.ok(coverage.ratio !== null && Math.abs(coverage.ratio - 0.6462) < 1e-3);
  assertBalanced(coverage);
});

test('contiguous trips are fully covered despite truncated distances', () => {
  // Reported distances sum to 4, but the odometer moved 5.7: truncation, not misses.
  const coverage = measureCoverage(
    VIN,
    [trip(1, 6092.667, 1), trip(2, 6095.463, 2), trip(3, 6095.7734, 0), trip(4, 6097.389, 1)],
    TRIPS_ONLY,
  );

  assert.equal(coverage.gaps.length, 0);
  assert.equal(coverage.untracked_miles, 0);
  assert.equal(coverage.ratio, 1);
  assert.equal(coverage.odometer_start_miles, 6091.667);
  close(coverage.tracked_miles, 5.722);
});

test('driving no archived trip accounts for is a gap', () => {
  const coverage = measureCoverage(VIN, [trip(1, 6205.0723, 1), trip(2, 6215, 3)], TRIPS_ONLY);

  assert.equal(coverage.gaps.length, 1);
  const [gap] = coverage.gaps;
  assert.ok(gap);
  assert.equal(gap.after_trip_id, 1);
  assert.equal(gap.before_trip_id, 2);
  assert.equal(gap.from_odometer_miles, 6205.0723);
  assert.equal(gap.to_odometer_miles, 6212);
  close(gap.miles, 6.9277);
  close(coverage.missed_miles, 6.9277);
  assertBalanced(coverage);
});

test('excess within a mile is truncation, not a missed trip', () => {
  // 6.46 mi of odometer against a reported 6: within tolerance.
  const coverage = measureCoverage(VIN, [trip(1, 6124.792, 7), trip(2, 6131.254, 6)], TRIPS_ONLY);
  assert.equal(coverage.gaps.length, 0);
});

test('a trip Hyundai stamped out of order is placed by its odometer', () => {
  // Trip 88133 started at 08:51:24 by its stamp, after 88181 (08:50:53), but its
  // odometer puts it first. In time order that is a 14.6 mi negative gap followed by a
  // 7.4 mi false one; in odometer order everything is contiguous. Input is time order.
  const coverage = measureCoverage(
    VIN,
    [trip(87677, 6124.792, 7), trip(88161, 6133.18, 1), trip(88181, 6139.891, 6), trip(88133, 6131.254, 6)],
    TRIPS_ONLY,
  );

  assert.deepEqual(coverage.gaps, []);
  assert.equal(coverage.odometer_end_miles, 6139.891);
});

test('trips ending at the same odometer are ordered by start time, not id', () => {
  // Live: 87553 (0 mi, 17:05) got a lower id than 87554 (3 mi, 16:55) because both
  // arrived in one poll. By id, 87554 looks like it starts 3 mi before 87553 ends.
  const coverage = measureCoverage(
    VIN,
    [
      trip(87545, 6099.8125, 0, new Date('2026-11-03T21:51:24Z')),
      trip(87554, 6102.857, 3, new Date('2026-11-03T21:55:35Z')),
      trip(87553, 6102.857, 0, new Date('2026-11-03T22:05:47Z')),
      trip(87561, 6106.337, 3, new Date('2026-11-03T22:07:06Z')),
    ],
    TRIPS_ONLY,
  );

  assert.deepEqual(coverage.gaps, []);
});

test('a trip archived twice under two start stamps is counted once', () => {
  // If Hyundai re-stamps a trip, the dedupe key sees a new trip and stores it again.
  // Both rows cover the same odometer stretch: that overlap must not double the
  // tracked miles, nor read as a negative gap that offsets a real one.
  const coverage = measureCoverage(
    VIN,
    [
      trip(1, 6100, 10),
      trip(2, 6110, 10, new Date('2026-11-03T13:00:00Z')),
      trip(3, 6110, 10, new Date('2026-11-03T14:00:00Z')),
      trip(4, 6130, 10),
    ],
    TRIPS_ONLY,
  );

  close(coverage.tracked_miles, 30); // 6090–6130 less the gap, not 40
  close(coverage.missed_miles, 10); // 6110–6120, from the later copy's end
  assert.equal(coverage.gaps.length, 1);
  assertBalanced(coverage);
});

test('a trip overlapping the one before it is not a gap', () => {
  // Distance larger than the odometer moved: the start lands inside the previous trip.
  const coverage = measureCoverage(VIN, [trip(1, 6100, 10), trip(2, 6105, 8)], TRIPS_ONLY);
  assert.deepEqual(coverage.gaps, []);
  close(coverage.tracked_miles, 15);
});

test('a date range is measured between the readings at its ends', () => {
  // Last reading before the range: 6200. Newest reading inside it: 6230. The trips
  // cover 6205–6225, so 5 mi before the first and 5 after the last are untracked.
  const coverage = measureCoverage(
    VIN,
    [trip(1, 6215, 10), trip(2, 6225, 10)],
    { startMiles: 6200, endMiles: 6230 },
  );

  close(coverage.odometer_miles, 30);
  close(coverage.tracked_miles, 20);
  close(coverage.before_first_trip_miles, 5);
  close(coverage.after_last_trip_miles, 5);
  close(coverage.ratio ?? 0, 2 / 3);
  assertBalanced(coverage);
});

test('a range that starts before tracking did falls back to the first trip', () => {
  const coverage = measureCoverage(VIN, [trip(1, 2630, 2)], { startMiles: null, endMiles: 2640 });
  assert.equal(coverage.odometer_start_miles, 2628);
  close(coverage.before_first_trip_miles, 0);
  close(coverage.after_last_trip_miles, 10);
});

test('the window widens to hold a trip that runs past a stale reading', () => {
  // The reading at the range's end lags the trip that ended inside it.
  const coverage = measureCoverage(VIN, [trip(1, 6225, 10)], { startMiles: 6215, endMiles: 6220 });
  assert.equal(coverage.odometer_end_miles, 6225);
  assert.equal(coverage.after_last_trip_miles, 0);
  assert.equal(coverage.ratio, 1);
});

test('driving with no archived trip is entirely untracked', () => {
  const coverage = measureCoverage(VIN, [], { startMiles: 6200, endMiles: 6212 });
  close(coverage.odometer_miles, 12);
  assert.equal(coverage.tracked_miles, 0);
  close(coverage.before_first_trip_miles, 12);
  assert.equal(coverage.ratio, 0);
  assertBalanced(coverage);
});

test('trips without an odometer are counted but not placed', () => {
  const coverage = measureCoverage(VIN, [trip(1, 100, 5), trip(2, null, 3), trip(3, 103, 3)], TRIPS_ONLY);
  assert.equal(coverage.trips_without_odometer, 1);
  assert.equal(coverage.gaps.length, 0);
  assert.equal(coverage.tracked_miles, 8);
});

test('a car that did not move has no ratio rather than 0% or 100%', () => {
  assert.equal(measureCoverage(VIN, [], TRIPS_ONLY).ratio, null);
  assert.equal(measureCoverage(VIN, [], { startMiles: 6200, endMiles: 6200 }).ratio, null);
  assert.equal(combineCoverage([]).ratio, null);
});

test('several vehicles combine by miles, without a shared odometer', () => {
  const a = measureCoverage('A', [trip(1, 100, 10), trip(2, 110, 10)], TRIPS_ONLY); // 20 of 20
  const b = measureCoverage('B', [trip(3, 500, 0), trip(4, 520, 0)], TRIPS_ONLY); // 0 of 20

  const combined = combineCoverage([a, b]);
  assert.equal(combined.odometer_miles, 40);
  assert.equal(combined.missed_miles, 20);
  assert.equal(combined.ratio, 0.5);
  assert.equal(combined.odometer_start_miles, null);
  assert.deepEqual(
    combined.gaps.map((gap) => gap.vin),
    ['B'],
  );
  assertBalanced(combined);

  assert.equal(combineCoverage([a]), a);
});
