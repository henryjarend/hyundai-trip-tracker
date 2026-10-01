import { useEffect, useMemo, useState } from 'react';
import {
  fetchEvents,
  fetchLatestStatus,
  fetchPollRuns,
  fetchPositions,
  fetchSummary,
  fetchTrips,
  fetchVehicles,
} from './api.ts';
import type {
  LocationStatus,
  PollRun,
  Position,
  StatusSnapshot,
  Summary,
  Trip,
  Vehicle,
  VehicleEvent,
} from './api.ts';
import { EventTimeline } from './components/EventTimeline.tsx';
import { LiveStatus } from './components/LiveStatus.tsx';
import { RangeFilter } from './components/RangeFilter.tsx';
import { SpeedEfficiency } from './components/SpeedEfficiency.tsx';
import { StatTiles } from './components/StatTiles.tsx';
import { TripTable } from './components/TripTable.tsx';
import { TripModal } from './components/TripModal.tsx';
import { formatDateTime } from './format.ts';
import { BANDS, bandOf } from './speed-bands.ts';
import { DEFAULT_RANGE, resolveRange, type Range, type ResolvedRange } from './range.ts';

/**
 * How each location outcome should read, and whether it deserves attention.
 *
 * `rate_limited` and `failed` are warnings on purpose: findMyCar backoff can last
 * hours, and a silently stalled location feed is precisely the sort of thing this
 * page exists to make visible.
 */
const LOCATION_NOTES: Record<LocationStatus, { text: string; warn: boolean }> = {
  fetched: { text: 'location updated', warn: false },
  skipped_no_movement: { text: 'location unchanged (parked)', warn: false },
  skipped_throttled: { text: 'location throttled', warn: false },
  rate_limited: { text: 'location rate limited by Hyundai — backing off', warn: true },
  failed: { text: 'location fetch failed', warn: true },
  disabled: { text: 'location tracking off', warn: false },
};

export function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVin, setSelectedVin] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<PollRun | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [events, setEvents] = useState<VehicleEvent[]>([]);
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  /** The window the trips on screen were fetched for — see RangeFilter's `resolved`. */
  const [fetchedWindow, setFetchedWindow] = useState<ResolvedRange>({});
  /**
   * Archive-wide, so the header keeps saying when archiving began no matter how the
   * trip list is filtered. The tiles below are about the selection; this line is not.
   */
  const [archiveStart, setArchiveStart] = useState<string | null>(null);
  /**
   * The speed band the trip list is narrowed to. It survives a change of time range on
   * purpose: the bands are fixed speeds, so "20–35 mph over the last week" is a fair
   * follow-up to "20–35 mph over everything".
   */
  const [speedBand, setSpeedBand] = useState<number | null>(null);
  // Memoized so the list keeps its identity between renders: the pager resets to page 1
  // whenever it sees a new array, and that should mean a new selection, not a re-render.
  const listedTrips = useMemo(
    () => (speedBand === null ? trips : trips.filter((trip) => bandOf(trip) === speedBand)),
    [trips, speedBand],
  );

  useEffect(() => {
    // A poller that is failing looks identical to an empty archive. Surface it.
    fetchPollRuns()
      .then(({ runs }) => setLastPoll(runs[0] ?? null))
      .catch(() => setLastPoll(null));
  }, []);

  useEffect(() => {
    fetchVehicles()
      .then(({ vehicles: list }) => {
        setVehicles(list);
        // Default to the only car when there is just one, which is the usual case.
        if (list.length === 1) setSelectedVin(list[0]!.vin);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Resolved once here, so the trips, the totals and the caption all describe the
    // same window even though a preset's start depends on when it was asked.
    const asked = resolveRange(range, new Date());

    Promise.all([fetchTrips(selectedVin, asked), fetchSummary(selectedVin, asked)])
      .then(([tripResult, summaryResult]) => {
        if (cancelled) return;
        setTrips(tripResult.trips);
        setSummary(summaryResult);
        setFetchedWindow(asked);
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVin, range]);

  useEffect(() => {
    let cancelled = false;

    fetchSummary(selectedVin)
      .then((archive) => {
        if (!cancelled) setArchiveStart(archive.first_trip_at);
      })
      .catch(() => {
        if (!cancelled) setArchiveStart(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVin]);

  useEffect(() => {
    let cancelled = false;

    // These three are decoration around the archive: if any of them fails the trip
    // table must still render, so each settles independently and failures are
    // swallowed rather than raised into the page-level error.
    void Promise.allSettled([
      fetchLatestStatus(selectedVin),
      fetchPositions(selectedVin, 1),
      // Ten are on screen; the rest are what the pager under the timeline pages back
      // through, so the fetch has to be deeper than the page.
      fetchEvents(selectedVin, 100),
    ]).then(([statusResult, positionResult, eventResult]) => {
      if (cancelled) return;
      setStatus(
        statusResult.status === 'fulfilled' ? (statusResult.value.snapshots[0] ?? null) : null,
      );
      setPosition(
        positionResult.status === 'fulfilled' ? (positionResult.value.positions[0] ?? null) : null,
      );
      setEvents(eventResult.status === 'fulfilled' ? eventResult.value.events : []);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedVin]);

  const locationNote = lastPoll?.location_status
    ? LOCATION_NOTES[lastPoll.location_status]
    : null;

  return (
    <main>
      <header>
        <div>
          <h1>Trip History</h1>
          <p className="subtitle">
            {archiveStart
              ? `Archiving since ${formatDateTime(archiveStart)}`
              : 'Local archive of every trip, well past the 4 Hyundai keeps.'}
          </p>
        </div>

        {vehicles.length > 1 && (
          <select
            value={selectedVin ?? ''}
            onChange={(event) => setSelectedVin(event.target.value || null)}
          >
            <option value="">All vehicles</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.vin} value={vehicle.vin}>
                {vehicle.nickname ?? vehicle.vin}
              </option>
            ))}
          </select>
        )}
      </header>

      {error && <p className="error">Could not load data: {error}</p>}

      {lastPoll && !lastPoll.ok && (
        <p className="error">
          Last poll failed at {formatDateTime(lastPoll.started_at)}: {lastPoll.error}
        </p>
      )}

      {lastPoll?.ok && (
        <p className="note">
          Last poll {formatDateTime(lastPoll.started_at)} — {lastPoll.trips_seen} trip(s) retrieved,{' '}
          {lastPoll.trips_inserted} new
          {lastPoll.events_recorded > 0 && `, ${lastPoll.events_recorded} event(s)`}
          {locationNote && !locationNote.warn && ` · ${locationNote.text}`}.
        </p>
      )}

      {/* Split out of the note above so a stalled location feed is not a clause at the
          end of an otherwise reassuring "poll ok" line. */}
      {lastPoll?.ok && locationNote?.warn && (
        <p className="warn">
          {locationNote.text}. Trips are unaffected — only position fixes pause.
        </p>
      )}

      {lastPoll === null && (
        <p className="note">
          No poll has run yet. Start the poller, or trigger one with{' '}
          <code>curl -X POST localhost:3000/api/poll</code>.
        </p>
      )}

      {/* Above the filter on purpose: the live panel is about the car now, and nothing
          below the filter is. */}
      <LiveStatus status={status} position={position} />

      <RangeFilter range={range} resolved={fetchedWindow} onChange={setRange} />

      <StatTiles summary={summary} />

      {/* Built from the loaded trips rather than a stats endpoint: the page already holds
          them, and the bands follow the range filter for free. */}
      {!loading && (
        <SpeedEfficiency
          trips={trips}
          totalTrips={summary?.trip_count ?? null}
          selected={speedBand}
          onSelect={setSpeedBand}
        />
      )}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <TripTable
          trips={listedTrips}
          onSelect={setSelectedTripId}
          speedBand={speedBand === null ? null : BANDS[speedBand]!.label}
          onClearSpeedBand={() => setSpeedBand(null)}
          filtered={fetchedWindow.from !== undefined || fetchedWindow.to !== undefined}
        />
      )}

      <EventTimeline events={events} />

      {selectedTripId !== null && (
        <TripModal tripId={selectedTripId} onClose={() => setSelectedTripId(null)} />
      )}
    </main>
  );
}
