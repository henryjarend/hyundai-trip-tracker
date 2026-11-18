/**
 * The Miles and Coverage tile wording. Numbers are formatted with the same locale-aware
 * helper the tiles use, so these pass whatever locale the test runs under; the rules
 * under test are the words, the rounding and what gets left out.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Coverage, Summary } from '../src/api.ts';
import { coverageTile, formatRatio, milesTile } from '../src/coverage-text.ts';
import { formatNumber } from '../src/format.ts';

const mi = (value: number) => `${formatNumber(value, 0)} mi`;

/** The whole archive as production had it on 2026-11-18. */
function coverage(overrides: Partial<Coverage> = {}): Coverage {
  return {
    odometer_start_miles: 0,
    odometer_end_miles: 7446.199,
    odometer_miles: 7446.199,
    tracked_miles: 4808.4449,
    untracked_miles: 2637.7541,
    before_first_trip_miles: 2628.3198,
    missed_miles: 9.4343,
    after_last_trip_miles: 0,
    ratio: 4808.4449 / 7446.199,
    gaps: [
      { vin: 'V', after_trip_id: 7, before_trip_id: 54, from_odometer_miles: 2650, to_odometer_miles: 2653.09, miles: 3.09 },
      { vin: 'V', after_trip_id: 335, before_trip_id: 4, from_odometer_miles: 2700, to_odometer_miles: 2704.93, miles: 4.93 },
      { vin: 'V', after_trip_id: 44937, before_trip_id: 44969, from_odometer_miles: 4000, to_odometer_miles: 4001.42, miles: 1.42 },
    ],
    trips_without_odometer: 0,
    ...overrides,
  };
}

function summary(cov: Coverage): Summary {
  return {
    trip_count: 570,
    total_miles: 4567,
    total_kwh: 1500,
    regen_kwh: 200,
    total_seconds: 500_000,
    max_speed: 80,
    first_trip_at: '2026-08-17T10:57:35Z',
    last_trip_at: '2026-11-18T11:32:15Z',
    avg_miles_per_kwh: 3.04,
    coverage: cov,
  };
}

test('ratio rounds down so a missed mile never shows as 100%', () => {
  assert.equal(formatRatio(4808.4449 / 7446.199), '64.5%'); // 64.576…
  assert.equal(formatRatio(0.9997), '99.9%');
  assert.equal(formatRatio(0.99999999), '99.9%');
  assert.equal(formatRatio(1), '100%');
  assert.equal(formatRatio(0), '0.0%');
  assert.equal(formatRatio(null), '—');
});

test('whole archive: coverage is of every mile and names what came before tracking', () => {
  const tile = coverageTile(coverage(), false);

  assert.equal(tile.value, '64.5%');
  assert.deepEqual(tile.hints, [
    'of every mile the car has driven',
    `${mi(2628.3198)} before tracking · ${mi(9.4343)} in 3 gaps`,
  ]);
  assert.match(tile.title ?? '', /^Over the life of the car: /);
});

test('a range: coverage is of that range and says "before the first trip"', () => {
  const tile = coverageTile(
    coverage({
      odometer_start_miles: 5726.8657,
      odometer_miles: 1719.3,
      tracked_miles: 1700,
      before_first_trip_miles: 4.3,
      missed_miles: 0,
      after_last_trip_miles: 15,
      ratio: 1700 / 1719.3,
      gaps: [],
    }),
    true,
  );

  assert.deepEqual(tile.hints, [
    'of miles driven in this range',
    `${mi(4.3)} before the first trip · ${mi(15)} not yet reported`,
  ]);
  assert.match(tile.title ?? '', /^In this range: /);
});

test('parts under a mile are truncation noise and left unnamed', () => {
  const tile = coverageTile(
    coverage({ before_first_trip_miles: 0.5, after_last_trip_miles: 0.9, missed_miles: 0, gaps: [], ratio: 0.9997 }),
    true,
  );
  assert.deepEqual(tile.hints, ['of miles driven in this range', 'none missed']);
});

test('a single gap is singular', () => {
  const [gap] = coverage().gaps;
  assert.ok(gap);
  const tile = coverageTile(coverage({ before_first_trip_miles: 0, gaps: [gap], missed_miles: 3.09 }), true);
  assert.equal(tile.hints?.[1], `${mi(3.09)} in 1 gap`);
});

test('a range where the car did not move says so; a loading summary says nothing', () => {
  const idle = coverage({ odometer_miles: 0, tracked_miles: 0, ratio: null, gaps: [] });
  assert.deepEqual(coverageTile(idle, true), { label: 'Coverage', value: '—', hints: ['No driving in this range'] });
  assert.deepEqual(coverageTile(undefined, true).hints, []);
});

test('miles are tracked miles by odometer, against the odometer in scope', () => {
  const whole = milesTile(summary(coverage()), false);
  assert.equal(whole.value, formatNumber(4808.4449, 0));
  assert.deepEqual(whole.hints, [`of all ${mi(7446.199)} the car has driven`]);
  // The truncated sum stays findable, because it's what the trip table adds up to.
  assert.match(whole.title ?? '', new RegExp(mi(4567)));

  const range = milesTile(summary(coverage({ odometer_miles: 1719.3 })), true);
  assert.deepEqual(range.hints, [`of ${mi(1719.3)} driven in this range`]);
});

test('miles fall back to the summed distance when there is no coverage', () => {
  const tile = milesTile({ ...summary(coverage()), coverage: undefined as unknown as Coverage }, false);
  assert.deepEqual(tile, { label: 'Miles', value: formatNumber(4567, 0) });
});
