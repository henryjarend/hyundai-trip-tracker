import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideLocationFetch } from '../src/ingest/location-policy.ts';
import type { LocationFetchState } from '../src/db/repo.ts';

const NOW = new Date('2026-08-18T12:00:00Z');

const CONFIG = { enabled: true, intervalMinutes: 60, activeIntervalMinutes: 10 };

function state(overrides: Partial<LocationFetchState> = {}): LocationFetchState {
  return {
    last_attempt_at: new Date('2026-08-18T11:00:00Z'),
    last_success_at: new Date('2026-08-18T11:00:00Z'),
    last_odometer_miles: 1000,
    rate_limited_until: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

function decide(overrides: Parameters<typeof decideLocationFetch>[0]) {
  return decideLocationFetch(overrides);
}

test('fetches when there is no state at all', () => {
  const result = decide({
    config: CONFIG,
    state: null,
    engineRunning: false,
    odometerMiles: 1000,
    now: NOW,
  });
  assert.equal(result.fetch, true);
  assert.equal(result.status, 'fetched');
});

test('never fetches when disabled', () => {
  const result = decide({
    config: { ...CONFIG, enabled: false },
    state: null,
    engineRunning: true,
    odometerMiles: 5000,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'disabled');
});

test('respects an active rate-limit window even with the engine running', () => {
  const result = decide({
    config: CONFIG,
    state: state({ rate_limited_until: new Date('2026-08-18T13:00:00Z') }),
    engineRunning: true,
    odometerMiles: 2000,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'rate_limited');
  assert.match(result.reason, /60 minute/);
});

test('fetches again once the rate-limit window has passed', () => {
  const result = decide({
    config: CONFIG,
    state: state({
      rate_limited_until: new Date('2026-08-18T11:30:00Z'),
      last_attempt_at: new Date('2026-08-18T10:00:00Z'),
    }),
    engineRunning: false,
    odometerMiles: 1050,
    now: NOW,
  });
  assert.equal(result.fetch, true);
});

test('skips a parked car whose odometer has not moved', () => {
  const result = decide({
    config: CONFIG,
    state: state({ last_attempt_at: new Date('2026-08-18T09:00:00Z') }),
    engineRunning: false,
    odometerMiles: 1000,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'skipped_no_movement');
});

test('fetches when the odometer moved and the idle floor has elapsed', () => {
  const result = decide({
    config: CONFIG,
    state: state({ last_attempt_at: new Date('2026-08-18T10:30:00Z') }),
    engineRunning: false,
    odometerMiles: 1042,
    now: NOW,
  });
  assert.equal(result.fetch, true);
  assert.match(result.reason, /odometer moved/);
});

test('applies the idle floor to a car that moved only recently', () => {
  const result = decide({
    config: CONFIG,
    state: state({ last_attempt_at: new Date('2026-08-18T11:30:00Z') }),
    engineRunning: false,
    odometerMiles: 1042,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'skipped_throttled');
});

test('a running engine uses the shorter floor', () => {
  // 30 minutes since the last attempt: under the 60 minute idle floor, over the
  // 10 minute active one.
  const attempt = new Date('2026-08-18T11:30:00Z');

  const idle = decide({
    config: CONFIG,
    state: state({ last_attempt_at: attempt }),
    engineRunning: false,
    odometerMiles: 1042,
    now: NOW,
  });
  assert.equal(idle.fetch, false);

  const active = decide({
    config: CONFIG,
    state: state({ last_attempt_at: attempt }),
    engineRunning: true,
    odometerMiles: 1000,
    now: NOW,
  });
  assert.equal(active.fetch, true);
  assert.match(active.reason, /engine running/);
});

test('a running engine is still throttled inside the active floor', () => {
  const result = decide({
    config: CONFIG,
    state: state({ last_attempt_at: new Date('2026-08-18T11:55:00Z') }),
    engineRunning: true,
    odometerMiles: 1000,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'skipped_throttled');
});

test('fetches when the last odometer reading is unknown', () => {
  // Without a baseline we cannot prove the car has not moved, so take the fix.
  const result = decide({
    config: CONFIG,
    state: state({ last_odometer_miles: null, last_attempt_at: new Date('2026-08-18T10:00:00Z') }),
    engineRunning: false,
    odometerMiles: null,
    now: NOW,
  });
  assert.equal(result.fetch, true);
});

test('a null odometer reading does not count as movement', () => {
  const result = decide({
    config: CONFIG,
    state: state({ last_attempt_at: new Date('2026-08-18T09:00:00Z') }),
    engineRunning: false,
    odometerMiles: null,
    now: NOW,
  });
  assert.equal(result.fetch, false);
  assert.equal(result.status, 'skipped_no_movement');
});
