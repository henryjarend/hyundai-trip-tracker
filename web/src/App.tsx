import { useEffect, useState } from 'react';
import { fetchPollRuns, fetchSummary, fetchTrips, fetchVehicles } from './api.ts';
import type { PollRun, Summary, Trip, Vehicle } from './api.ts';
import { StatTiles } from './components/StatTiles.tsx';
import { TripTable } from './components/TripTable.tsx';
import { TripModal } from './components/TripModal.tsx';
import { formatDateTime } from './format.ts';

export function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVin, setSelectedVin] = useState<string | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<PollRun | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

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

    Promise.all([fetchTrips(selectedVin), fetchSummary(selectedVin)])
      .then(([tripResult, summaryResult]) => {
        if (cancelled) return;
        setTrips(tripResult.trips);
        setSummary(summaryResult);
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
  }, [selectedVin]);

  return (
    <main>
      <header>
        <div>
          <h1>Trip History</h1>
          <p className="subtitle">
            {summary?.first_trip_at
              ? `Archiving since ${formatDateTime(summary.first_trip_at)}`
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
          Last poll {formatDateTime(lastPoll.started_at)} — {lastPoll.trips_seen} trip(s) seen,{' '}
          {lastPoll.trips_inserted} new.
        </p>
      )}

      {lastPoll === null && (
        <p className="note">
          No poll has run yet. Start the poller, or trigger one with{' '}
          <code>curl -X POST localhost:3000/api/poll</code>.
        </p>
      )}

      <StatTiles summary={summary} />

      {loading ? (
        <p className="empty">Loading…</p>
      ) : (
        <TripTable trips={trips} onSelect={setSelectedTripId} />
      )}

      {selectedTripId !== null && (
        <TripModal tripId={selectedTripId} onClose={() => setSelectedTripId(null)} />
      )}
    </main>
  );
}
