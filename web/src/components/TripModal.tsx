import { useEffect, useRef, useState } from 'react';
import { fetchTrip } from '../api.ts';
import type { TripDetail, TripLocation } from '../api.ts';
import { formatDateTime, formatDuration, formatNumber, kwh } from '../format.ts';

interface Props {
  tripId: number;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

function LocationBlock({ label, location }: { label: string; location: TripLocation | null }) {
  if (!location) {
    return <Row label={label} value="no nearby reading" />;
  }

  const coords = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  // Show the town when we have it; the link always points at the coordinates.
  // Until the poller geocodes a position, the coordinates stand in as the text.
  const linkText = location.label ?? coords;
  // The town is the *nearest* one, which can sit some distance from the actual
  // coordinate — keep that visible on hover rather than implying pinpoint accuracy.
  const title =
    location.label && location.place_distance_miles !== null
      ? `${coords} · nearest town is ${location.place_distance_miles.toFixed(1)} mi away`
      : coords;

  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">
        <a
          href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}
          target="_blank"
          rel="noreferrer"
          title={title}
        >
          {linkText}
        </a>
        <span className="detail-hint">
          {location.minutes_away === 0
            ? ' · at the trip boundary'
            : ` · ${location.minutes_away} min ${label.startsWith('Start') ? 'before' : 'after'}`}
        </span>
      </span>
    </div>
  );
}

export function TripModal({ tripId, onClose }: Props) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTrip(tripId)
      .then((result) => !cancelled && setTrip(result))
      .catch((cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // Escape closes, and focus moves into the dialog so keyboard users aren't
  // stranded behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const energyRows = trip
    ? [
        ['Drivetrain', trip.energy_drivetrain_wh],
        ['Climate', trip.energy_climate_wh],
        ['Accessories', trip.energy_accessories_wh],
        ['Battery care', trip.energy_battery_care_wh],
      ]
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Trip details"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{trip ? formatDateTime(trip.start_date) : 'Trip'}</h2>
          <button type="button" className="close" onClick={onClose} ref={closeRef}>
            ✕
          </button>
        </header>

        {error && <p className="error">{error}</p>}
        {!trip && !error && <p className="empty">Loading…</p>}

        {trip && (
          <div className="modal-body">
            <section>
              <h3>Trip</h3>
              <Row label="Started" value={formatDateTime(trip.start_date)} />
              <Row label="Ended" value={formatDateTime(trip.end_date)} />
              <Row label="Distance" value={`${formatNumber(trip.distance_miles)} mi`} />
              <Row label="Total time" value={formatDuration(trip.duration_seconds)} />
              <Row label="Moving" value={formatDuration(trip.drive_time_seconds)} />
              <Row label="Stopped" value={formatDuration(trip.idle_seconds)} />
              <Row label="Avg speed" value={`${formatNumber(trip.avg_speed, 0)} mph`} />
              <Row label="Max speed" value={`${formatNumber(trip.max_speed, 0)} mph`} />
              <Row label="Odometer at end" value={`${formatNumber(trip.odometer_miles, 1)} mi`} />
            </section>

            <section>
              <h3>Energy</h3>
              <Row label="Total used" value={`${kwh(trip.energy_total_wh)} kWh`} />
              <Row label="Regenerated" value={`${kwh(trip.energy_regen_wh)} kWh`} />
              <Row label="Efficiency" value={`${formatNumber(trip.miles_per_kwh, 2)} mi/kWh`} />
              {energyRows.map(([label, value]) => (
                <Row key={String(label)} label={String(label)} value={`${value} Wh`} />
              ))}
            </section>

            <section>
              <h3>Approximate location</h3>
              <p className="section-note">
                Hyundai's trip data contains no coordinates. These are the closest
                readings the poller took around the trip, so treat them as rough.
                Town names come from a local GeoNames database — run{' '}
                <code>npm run geonames:load</code> if they're missing.
              </p>
              <LocationBlock label="Start (nearest before)" location={trip.startLocation} />
              <LocationBlock label="End (nearest after)" location={trip.endLocation} />
            </section>

            <section>
              <h3>Record</h3>
              <Row label="Reported start" value={trip.start_date_raw} />
              <Row label="First seen" value={formatDateTime(trip.first_seen_at)} />
              <Row label="Last updated" value={formatDateTime(trip.updated_at)} />
              <button type="button" className="link" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? 'Hide' : 'Show'} raw payload
              </button>
              {showRaw && <pre className="raw">{JSON.stringify(trip.raw, null, 2)}</pre>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
