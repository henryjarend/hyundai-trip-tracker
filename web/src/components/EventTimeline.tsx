/**
 * Recent vehicle transitions.
 *
 * These are inferred, not pushed. Bluelink has no webhook or push channel, so an event
 * exists only because a field differed between two polls — which means the time shown
 * is when the car *reported* the change, and we may have learned about it much later.
 * Where that lag is material it is shown explicitly rather than smoothed over, because
 * a timeline that looks real-time when it isn't is worse than no timeline.
 */
import type { VehicleEvent } from '../api.ts';
import { formatDateTime, formatNumber, formatRelative } from '../format.ts';
import { Pager, usePager } from './Pager.tsx';

interface Props {
  events: VehicleEvent[];
}

const LABELS: Record<VehicleEvent['kind'], string> = {
  engine_on: 'Engine started',
  engine_off: 'Engine stopped',
  moved: 'Moved',
  charge_start: 'Charging started',
  charge_stop: 'Charging stopped',
  plugged_in: 'Plugged in',
  unplugged: 'Unplugged',
};

/** Minutes between the change happening and us noticing, when both are known. */
function detectionLagMinutes(event: VehicleEvent): number | null {
  if (!event.observed_at) return null;
  const observed = new Date(event.observed_at).getTime();
  const detected = new Date(event.detected_at).getTime();
  if (Number.isNaN(observed) || Number.isNaN(detected)) return null;
  return Math.round((detected - observed) / 60_000);
}

function describe(event: VehicleEvent): string | null {
  if (event.kind !== 'moved') return null;
  const from = typeof event.previous === 'number' ? event.previous : null;
  const to = typeof event.current === 'number' ? event.current : null;
  if (from === null || to === null) return null;
  return `${formatNumber(to - from, 1)} mi (odometer ${formatNumber(to, 0)})`;
}

export function EventTimeline({ events }: Props) {
  // The API already returns these newest-first, and there is no sort control here, so
  // page 1 is the most recent handful.
  const pager = usePager(events);

  if (events.length === 0) {
    return (
      <section className="events">
        <h2 className="section-title">Recent activity</h2>
        <p className="section-note">
          Nothing detected yet. Events appear once the poller sees a field change between
          two status readings — there is no push notification from Hyundai to wait on.
        </p>
      </section>
    );
  }

  return (
    <section className="events">
      <div className="list-header">
        <h2 className="section-title">Recent activity</h2>
        {/* "loaded", not "on record": the fetch is capped, so this is how many the page
            holds and can page through, not how many the archive contains. */}
        <span className="list-count">
          {events.length} event{events.length === 1 ? '' : 's'} loaded
        </span>
      </div>
      <p className="section-note">
        Inferred by comparing consecutive status readings, so the timing follows the car's
        own sync schedule rather than the poll interval. A short trip that starts and ends
        between two syncs shows up only as “Moved”.
      </p>

      <ul className="timeline">
        {pager.visible.map((event) => {
          const lag = detectionLagMinutes(event);
          const detail = describe(event);
          const at = event.observed_at ?? event.detected_at;

          return (
            <li key={event.id} className="timeline-item">
              <span className={`event-kind event-${event.kind}`}>{LABELS[event.kind]}</span>
              <span className="event-when" title={formatDateTime(at)}>
                {formatRelative(at)}
              </span>
              {detail && <span className="event-detail">{detail}</span>}
              {/* Only worth showing once the lag is big enough to change how the
                  timestamp should be read. */}
              {lag !== null && lag >= 5 && (
                <span
                  className="event-lag"
                  title={`Reported ${formatDateTime(event.observed_at)}, detected ${formatDateTime(event.detected_at)}`}
                >
                  known {lag} min later
                </span>
              )}
              {!event.observed_at && (
                <span className="event-lag" title="The status payload carried no timestamp">
                  time approximate
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <Pager {...pager} label="Activity pages" />
    </section>
  );
}
