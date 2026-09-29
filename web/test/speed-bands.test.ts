import assert from 'node:assert/strict';
import test from 'node:test';
import type { Trip } from '../src/api.ts';
import { speedBreakdown } from '../src/speed-bands.ts';

function trip(avg_speed: number | null, distance_miles: number, energy_total_wh: number): Trip {
  return {
    id: 0,
    vin: 'VIN',
    start_date: '2026-09-01T12:00:00Z',
    start_date_local: '2026-09-01T08:00:00',
    duration_seconds: 600,
    distance_miles,
    odometer_miles: null,
    avg_speed,
    max_speed: null,
    energy_total_wh,
    energy_regen_wh: 0,
    energy_climate_wh: 0,
    energy_drivetrain_wh: 0,
    energy_accessories_wh: 0,
    energy_battery_care_wh: 0,
    miles_per_kwh: energy_total_wh > 0 ? distance_miles / (energy_total_wh / 1000) : null,
  };
}

test('band efficiency is weighted by energy, not a mean of per-trip values', () => {
  // 1 mi on 1 kWh and 40 mi on 10 kWh: a plain mean says 2.5, the band says 41/11.
  const { bands } = speedBreakdown([trip(25, 1, 1000), trip(30, 40, 10_000)]);
  const band = bands.find((b) => b.label === '20–35 mph')!;
  assert.equal(band.tripCount, 2);
  assert.ok(Math.abs(band.milesPerKwh! - 41 / 11) < 1e-9);
});

test('band edges are inclusive below and exclusive above', () => {
  const { bands } = speedBreakdown([trip(20, 5, 1000), trip(65, 5, 1000), trip(19.9, 5, 1000)]);
  assert.equal(bands[0]!.tripCount, 1);
  assert.equal(bands[1]!.tripCount, 1);
  assert.equal(bands[4]!.tripCount, 1);
});

test('trips with no speed or no energy are skipped and counted', () => {
  const result = speedBreakdown([trip(null, 5, 1000), trip(40, 5, 0), trip(40, 20, 5000)]);
  assert.equal(result.skipped, 2);
  assert.equal(result.overallMilesPerKwh, 4);
});

test('a band with few miles is marked thin, an empty one has no value', () => {
  const { bands } = speedBreakdown([trip(10, 3, 1000), trip(40, 30, 8000)]);
  assert.equal(bands[0]!.thin, true);
  assert.equal(bands[2]!.thin, false);
  assert.equal(bands[4]!.milesPerKwh, null);
});
