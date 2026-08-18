/**
 * Decides whether a poll should spend a findMyCar call.
 *
 * The endpoint is rate limited (HT_534), so it cannot go on a fixed timer alongside
 * the trip fetch. The rules, in order:
 *
 * 1. Disabled by config -> never.
 * 2. Inside a rate-limit backoff window -> never, until it expires.
 * 3. No fix stored yet -> yes, we need a baseline.
 * 4. Otherwise a fix must be *worth* taking: either the engine is running (the
 *    position is actively changing) or the odometer has moved since the last fix.
 *    A parked car's position cannot have changed, so asking is pure waste.
 * 5. And it must not be too soon: a shorter floor while the engine runs, a longer
 *    one while idle.
 *
 * Pure so the policy can be tested without a database or a network.
 */
import type { LocationFetchState, LocationStatus } from '../db/repo.ts';

export interface LocationPolicyConfig {
  enabled: boolean;
  intervalMinutes: number;
  activeIntervalMinutes: number;
}

export interface LocationDecision {
  fetch: boolean;
  /** Recorded on the poll_runs row so a skip is visible without reading logs. */
  status: LocationStatus;
  /** Human-readable reason, logged by the poller. */
  reason: string;
}

const MINUTE_MS = 60_000;

export function decideLocationFetch(options: {
  config: LocationPolicyConfig;
  state: LocationFetchState | null;
  engineRunning: boolean | null;
  odometerMiles: number | null;
  now: Date;
}): LocationDecision {
  const { config, state, engineRunning, odometerMiles, now } = options;

  if (!config.enabled) {
    return { fetch: false, status: 'disabled', reason: 'LOCATION_ENABLED=0' };
  }

  if (state?.rate_limited_until && state.rate_limited_until > now) {
    const minutes = Math.ceil((state.rate_limited_until.getTime() - now.getTime()) / MINUTE_MS);
    return {
      fetch: false,
      status: 'rate_limited',
      reason: `backing off after HT_534, ${minutes} minute(s) remaining`,
    };
  }

  if (state?.last_success_at == null) {
    return { fetch: true, status: 'fetched', reason: 'no position stored yet' };
  }

  const moved =
    state.last_odometer_miles === null ||
    (odometerMiles !== null && odometerMiles > state.last_odometer_miles);
  const active = engineRunning === true;

  if (!moved && !active) {
    return {
      fetch: false,
      status: 'skipped_no_movement',
      reason: 'engine off and odometer unchanged since last fix',
    };
  }

  const floorMinutes = active ? config.activeIntervalMinutes : config.intervalMinutes;
  const sinceAttempt = state.last_attempt_at
    ? (now.getTime() - state.last_attempt_at.getTime()) / MINUTE_MS
    : Infinity;

  if (sinceAttempt < floorMinutes) {
    return {
      fetch: false,
      status: 'skipped_throttled',
      reason:
        `last attempt ${Math.floor(sinceAttempt)} minute(s) ago, ` +
        `floor is ${floorMinutes} (${active ? 'engine running' : 'idle'})`,
    };
  }

  return {
    fetch: true,
    status: 'fetched',
    reason: active ? 'engine running' : 'odometer moved since last fix',
  };
}
