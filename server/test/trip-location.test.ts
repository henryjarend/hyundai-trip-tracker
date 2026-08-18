/**
 * The rules that tie a recorded position to a trip's start or end. Pure, so these run
 * without a database — the SQL around them only assembles the candidate list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseBoundaryFix,
  startOdometer,
  type Boundary,
  type Fix,
} from '../src/trip-location.ts';

const TRIP_START = new Date('2026-08-17T19:58:12Z');
const TRIP_END = new Date('2026-08-17T20:22:36Z');

function fix(overrides: Partial<Fix> & { at: Date }): Fix {
  return {
    latitude: 42.82,
    longitude: -85.71,
    source: 'status',
    odometerMiles: null,
    ...overrides,
  };
}

function endBoundary(overrides: Partial<Boundary> = {}): Boundary {
  return {
    edge: 'end',
    at: TRIP_END,
    odometerMiles: 2654.49,
    odometerToleranceMiles: 1,
    limit: null,
    ...overrides,
  };
}

function startBoundary(overrides: Partial<Boundary> = {}): Boundary {
  return {
    edge: 'start',
    at: TRIP_START,
    odometerMiles: 2640.49,
    odometerToleranceMiles: 1,
    limit: null,
    ...overrides,
  };
}

test('an odometer match holds however stale the fix is', () => {
  // The car parked at the end of the trip and sat there for nine hours. Every fix in
  // that time is the trip's end location, not an approximation of it — a parked car
  // cannot move without the odometer moving. A time window would reject all of them.
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-18T05:30:00Z'), odometerMiles: 2654 })],
    endBoundary(),
  );

  assert.ok(chosen);
  assert.equal(chosen.basis, 'odometer');
  assert.equal(chosen.minutes_away, 547);
});

test('the whole-mile odometer of a status snapshot still counts as a match', () => {
  // Snapshots report whole miles while trips carry decimals, which is the entire
  // reason the boundary carries a tolerance.
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:25:00Z'), odometerMiles: 2654 })],
    endBoundary({ odometerMiles: 2654.9968 }),
  );

  assert.ok(chosen);
  assert.equal(chosen.basis, 'odometer');
});

test('a fix whose odometer disagrees is rejected, not merely demoted', () => {
  // 14 miles later the car is 14 miles away. Being the nearest thing we have does not
  // make it the trip's endpoint, and naming a town from it would be a fabrication.
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:30:00Z'), odometerMiles: 2668 })],
    endBoundary(),
  );

  assert.equal(chosen, null);
});

test('falls back to time-nearness for a fix with no odometer', () => {
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:40:00Z'), source: 'findMyCar' })],
    endBoundary(),
  );

  assert.ok(chosen);
  assert.equal(chosen.basis, 'time');
  assert.equal(chosen.minutes_away, 17);
});

test('the time fallback stays inside its window', () => {
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T23:00:00Z') })],
    endBoundary(),
  );

  assert.equal(chosen, null);
});

test('a proven fix beats a nearer unproven one', () => {
  const chosen = chooseBoundaryFix(
    [
      fix({ at: new Date('2026-08-17T20:25:00Z'), source: 'findMyCar' }),
      fix({ at: new Date('2026-08-17T21:10:00Z'), odometerMiles: 2654 }),
    ],
    endBoundary(),
  );

  assert.ok(chosen);
  assert.equal(chosen.basis, 'odometer');
  assert.equal(chosen.minutes_away, 47);
});

test('only looks after a trip for where it ended', () => {
  // A fix from before the trip has the wrong odometer anyway, but the side check is
  // what rules out a fix taken mid-route.
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T19:00:00Z'), odometerMiles: 2654 })],
    endBoundary(),
  );

  assert.equal(chosen, null);
});

test('only looks before a trip for where it started', () => {
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:10:00Z'), odometerMiles: 2640 })],
    startBoundary(),
  );

  assert.equal(chosen, null);
});

test('the next trip bounds how late an end fix may be', () => {
  // Two errands a mile apart: the tolerance alone would accept the second stop as the
  // first trip's end, so the neighbouring trip's start is what rules it out.
  const nextStart = new Date('2026-08-17T20:26:34Z');
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:40:00Z'), odometerMiles: 2655 })],
    endBoundary({ limit: nextStart }),
  );

  assert.equal(chosen, null);
});

test('a requested fix wins a tie with a volunteered one', () => {
  const at = new Date('2026-08-17T20:25:00Z');
  const chosen = chooseBoundaryFix(
    [
      fix({ at, odometerMiles: 2654, source: 'status' }),
      fix({ at, odometerMiles: 2654, source: 'findMyCar' }),
    ],
    endBoundary(),
  );

  assert.ok(chosen);
  assert.equal(chosen.source, 'findMyCar');
});

test('a trip with no odometer reading can still be matched on time', () => {
  const chosen = chooseBoundaryFix(
    [fix({ at: new Date('2026-08-17T20:30:00Z'), odometerMiles: 2668 })],
    endBoundary({ odometerMiles: null }),
  );

  assert.ok(chosen);
  assert.equal(chosen.basis, 'time');
});

test('startOdometer prefers the previous trip’s exact ending reading', () => {
  // 2640.49 + 14 = 2654.49: contiguous, so the previous trip ended where this one
  // began and its unrounded odometer is the better boundary.
  const result = startOdometer(
    { odometerMiles: 2654.49, distanceMiles: 14 },
    { odometerMiles: 2640.49, distanceMiles: 3 },
  );

  assert.equal(result.odometerMiles, 2640.49);
  assert.equal(result.toleranceMiles, 1);
});

test('startOdometer subtracts the distance when a trip went unseen', () => {
  // The previous known trip ended 40 miles back, which this trip's 14 do not account
  // for: something fell out of Hyundai's four-trip window before we polled. Its
  // odometer is not this trip's start.
  const result = startOdometer(
    { odometerMiles: 2654.49, distanceMiles: 14 },
    { odometerMiles: 2600.49, distanceMiles: 3 },
  );

  assert.equal(result.odometerMiles, 2640.49);
  assert.equal(result.toleranceMiles, 2, 'a rounded distance widens the tolerance');
});

test('startOdometer gives up rather than guess without an odometer', () => {
  assert.equal(startOdometer({ odometerMiles: null, distanceMiles: 14 }, null).odometerMiles, null);
  assert.equal(startOdometer({ odometerMiles: 2654, distanceMiles: null }, null).odometerMiles, null);
});
