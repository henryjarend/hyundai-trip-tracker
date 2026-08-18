import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectTransitions } from '../src/ingest/transitions.ts';
import type { StoredStatus } from '../src/db/repo.ts';
import type { VehicleStatusSnapshot } from '../src/hyundai/types.ts';

function stored(overrides: Partial<StoredStatus> = {}): StoredStatus {
  return {
    synced_at: new Date('2026-08-18T12:00:00Z'),
    engine_running: false,
    charging: false,
    plug_type: 'none',
    odometer_miles: 1000,
    soc_percent: 80,
    ...overrides,
  };
}

function snapshot(overrides: Partial<VehicleStatusSnapshot> = {}): VehicleStatusSnapshot {
  return {
    syncedAt: '2026-08-18T12:30:00.000Z',
    socPercent: 80,
    evRangeMiles: 200,
    charging: false,
    plugType: 'none',
    chargePower: null,
    odometerMiles: 1000,
    latitude: 42.9,
    longitude: -85.7,
    locked: true,
    battery12v: 85,
    engineRunning: false,
    raw: {},
    ...overrides,
  };
}

test('emits engine_on when the engine flips on', () => {
  const events = detectTransitions(stored(), snapshot({ engineRunning: true }));
  assert.deepEqual(
    events.map((event) => event.kind),
    ['engine_on'],
  );
  assert.equal(events[0]!.observedAt, '2026-08-18T12:30:00.000Z');
});

test('emits engine_off when the engine flips off', () => {
  const events = detectTransitions(
    stored({ engine_running: true }),
    snapshot({ engineRunning: false }),
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    ['engine_off'],
  );
});

test('emits nothing when nothing changed', () => {
  assert.deepEqual(detectTransitions(stored(), snapshot()), []);
});

test('emits nothing on the very first snapshot', () => {
  assert.deepEqual(detectTransitions(null, snapshot({ engineRunning: true })), []);
});

test('a first reading is not a transition', () => {
  // null -> true is us learning the value, not the car starting. Emitting engine_on
  // here would invent an event every time a new field starts being reported.
  const events = detectTransitions(
    stored({ engine_running: null }),
    snapshot({ engineRunning: true }),
  );
  assert.deepEqual(events, []);
});

test('ignores a snapshot that is not newer than the stored one', () => {
  // Cached status repeats between polls; re-reading an older sync must not emit
  // transitions backwards.
  const events = detectTransitions(
    stored({ synced_at: new Date('2026-08-18T13:00:00Z'), engine_running: true }),
    snapshot({ syncedAt: '2026-08-18T12:30:00.000Z', engineRunning: false }),
  );
  assert.deepEqual(events, []);
});

test('detects movement from the odometer even with no engine transition', () => {
  // The car started and stopped between two syncs, so `engine` never differed.
  const events = detectTransitions(stored(), snapshot({ odometerMiles: 1012 }));
  assert.deepEqual(
    events.map((event) => event.kind),
    ['moved'],
  );
  assert.equal(events[0]!.previous, 1000);
  assert.equal(events[0]!.current, 1012);
});

test('a decreasing odometer is never movement', () => {
  assert.deepEqual(detectTransitions(stored(), snapshot({ odometerMiles: 990 })), []);
});

test('detects charge and plug transitions', () => {
  const events = detectTransitions(
    stored({ charging: false, plug_type: 'none' }),
    snapshot({ charging: true, plugType: 'ac' }),
  );
  assert.deepEqual(new Set(events.map((event) => event.kind)), new Set(['charge_start', 'plugged_in']));
});

test('unplugging is detected as its own event', () => {
  const events = detectTransitions(
    stored({ charging: true, plug_type: 'dc' }),
    snapshot({ charging: false, plugType: 'none' }),
  );
  assert.deepEqual(new Set(events.map((event) => event.kind)), new Set(['charge_stop', 'unplugged']));
});

test('an unknown plug type is not treated as unplugged', () => {
  // 'unknown' means the field was absent or unrecognised. Reading it as "not plugged
  // in" would emit a spurious unplugged event whenever the backend omits it.
  const events = detectTransitions(
    stored({ plug_type: 'ac' }),
    snapshot({ plugType: 'unknown' }),
  );
  assert.deepEqual(events, []);
});

test('emits multiple events from one snapshot when several fields changed', () => {
  const events = detectTransitions(
    stored({ engine_running: true, odometer_miles: 1000 }),
    snapshot({ engineRunning: false, odometerMiles: 1030, plugType: 'ac', charging: true }),
  );
  assert.deepEqual(
    new Set(events.map((event) => event.kind)),
    new Set(['engine_off', 'moved', 'plugged_in', 'charge_start']),
  );
});
