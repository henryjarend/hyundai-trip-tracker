/**
 * Infers vehicle events by diffing two consecutive status snapshots.
 *
 * This is as close to an event stream as the Bluelink USA API allows. There is no
 * webhook, no push channel and no long-poll anywhere in it — the only way to learn
 * that the car started is to notice that `engine` changed between two polls.
 *
 * Two consequences worth keeping in mind when reading anything this produces:
 *
 * 1. Latency is set by the *car's* sync cadence, not by POLL_INTERVAL_MINUTES. The
 *    cached status only changes once the car has told Hyundai something new, so an
 *    `engine_on` may surface minutes after the fact. `observed_at` is when it
 *    actually happened; `detected_at` is when we found out.
 * 2. Short events can be missed entirely. If the car starts and stops between two
 *    syncs, no field ever differs and nothing is emitted. `moved` (an odometer
 *    increase) is the backstop that catches those, since the odometer is cumulative.
 *
 * A pure function on purpose: transition logic is the part most worth testing, and
 * this way it needs no database.
 */
import type { StoredStatus, VehicleEvent } from '../db/repo.ts';
import type { VehicleStatusSnapshot } from '../hyundai/types.ts';

/** True once the plug reads as physically connected, whatever the charge state. */
function isPluggedIn(plugType: string | null): boolean | null {
  if (plugType === null || plugType === 'unknown') return null;
  return plugType === 'ac' || plugType === 'dc';
}

/**
 * Emitted only on a genuine false -> true (or true -> false) flip. A field going
 * from null to a value is the first reading, not a transition, and must not fire.
 */
function flipped(
  previous: boolean | null,
  current: boolean | null,
  target: boolean,
): boolean {
  return previous !== null && current !== null && previous !== target && current === target;
}

export function detectTransitions(
  previous: StoredStatus | null,
  current: VehicleStatusSnapshot,
): VehicleEvent[] {
  // Nothing to diff against: this is the first snapshot we have for the car.
  if (previous === null) return [];

  // An older or identical sync tells us nothing new. Cached status repeats between
  // polls, and comparing a stale reading against a newer stored one would emit
  // transitions backwards.
  if (current.syncedAt !== null) {
    if (new Date(current.syncedAt) <= previous.synced_at) return [];
  }

  const events: VehicleEvent[] = [];
  const observedAt = current.syncedAt;

  const add = (kind: VehicleEvent['kind'], from: unknown, to: unknown) => {
    events.push({ kind, observedAt, previous: from, current: to });
  };

  if (flipped(previous.engine_running, current.engineRunning, true)) {
    add('engine_on', previous.engine_running, current.engineRunning);
  }
  if (flipped(previous.engine_running, current.engineRunning, false)) {
    add('engine_off', previous.engine_running, current.engineRunning);
  }

  if (flipped(previous.charging, current.charging, true)) {
    add('charge_start', previous.charging, current.charging);
  }
  if (flipped(previous.charging, current.charging, false)) {
    add('charge_stop', previous.charging, current.charging);
  }

  const wasPlugged = isPluggedIn(previous.plug_type);
  const isPlugged = isPluggedIn(current.plugType);
  if (flipped(wasPlugged, isPlugged, true)) {
    add('plugged_in', previous.plug_type, current.plugType);
  }
  if (flipped(wasPlugged, isPlugged, false)) {
    add('unplugged', previous.plug_type, current.plugType);
  }

  // The odometer is cumulative, so this catches driving that the engine flag missed
  // because it happened entirely between two syncs.
  if (
    previous.odometer_miles !== null &&
    current.odometerMiles !== null &&
    current.odometerMiles > previous.odometer_miles
  ) {
    add('moved', previous.odometer_miles, current.odometerMiles);
  }

  return events;
}
