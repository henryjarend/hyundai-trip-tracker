import { useMemo, useState, type ReactNode } from 'react';
import type { Trip } from '../api.ts';
import { Pager, usePager } from './Pager.tsx';
import {
  formatDateTime,
  formatDateTimeShort,
  formatDuration,
  formatNumber,
  kwh,
} from '../format.ts';

type SortKey =
  | 'start_date'
  | 'distance_miles'
  | 'duration_seconds'
  | 'energy_total_wh'
  | 'miles_per_kwh';

interface Column {
  key: SortKey;
  label: string;
  /** Header text below 640px, where the header row is the tightest thing on screen. */
  shortLabel?: string;
  /**
   * Dropped below 640px so the remaining columns fit a phone without a sideways
   * scroller. Duration is the only one of the five that is not part of what the archive
   * is read for — distance, energy and efficiency — so it is the one that gives way, and
   * it is still in the detail modal one tap away.
   */
  optional?: boolean;
  render: (trip: Trip) => ReactNode;
}

// Deliberately minimal — everything else lives in the detail modal.
const COLUMNS: Column[] = [
  {
    key: 'start_date',
    label: 'Started',
    render: (t) => (
      <>
        <span className="wide-only">{formatDateTime(t.start_date)}</span>
        <span className="narrow-only">{formatDateTimeShort(t.start_date)}</span>
      </>
    ),
  },
  { key: 'distance_miles', label: 'Miles', render: (t) => formatNumber(t.distance_miles) },
  {
    key: 'duration_seconds',
    label: 'Duration',
    optional: true,
    render: (t) => formatDuration(t.duration_seconds),
  },
  {
    key: 'energy_total_wh',
    label: 'kWh used',
    shortLabel: 'kWh',
    render: (t) => kwh(t.energy_total_wh),
  },
  { key: 'miles_per_kwh', label: 'mi/kWh', render: (t) => formatNumber(t.miles_per_kwh, 2) },
];

interface Props {
  trips: Trip[];
  onSelect: (id: number) => void;
  /**
   * Whether a time range is narrowing the list. An empty archive and an empty window
   * need opposite advice — telling someone to go start the poller when it is running
   * fine and they simply picked "12h" would send them debugging the wrong thing.
   */
  filtered: boolean;
  /** The label of the speed band narrowing the list, when one is selected above. */
  speedBand: string | null;
  onClearSpeedBand: () => void;
}

export function TripTable({ trips, onSelect, filtered, speedBand, onClearSpeedBand }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('start_date');
  const [ascending, setAscending] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...trips];
    copy.sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      // Nulls always sink to the bottom regardless of sort direction.
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      const comparison =
        sortKey === 'start_date'
          ? new Date(left as string).getTime() - new Date(right as string).getTime()
          : (left as number) - (right as number);

      return ascending ? comparison : -comparison;
    });
    return copy;
  }, [trips, sortKey, ascending]);

  // Paged over `sorted`, not `trips`: the sort is what the reader chose, so page 1 must
  // be the top of it rather than the first ten rows Hyundai happened to send.
  const pager = usePager(sorted);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((previous) => !previous);
    } else {
      setSortKey(key);
      setAscending(false);
    }
  }

  // Reachable when the time range changes under a selected band and leaves it empty;
  // the card itself can't be pressed while its band holds no trips.
  if (trips.length === 0 && speedBand !== null) {
    return (
      <p className="empty">
        No trips at {speedBand} in this time range.{' '}
        <button type="button" className="link" onClick={onClearSpeedBand}>
          Show every trip
        </button>
      </p>
    );
  }

  if (trips.length === 0) {
    return (
      <p className="empty">
        {filtered
          ? 'No trips started in this time range. Widen it, or pick All to see the whole archive.'
          : 'No trips recorded yet. Run the poller, then drive somewhere — new trips appear within one poll interval.'}
      </p>
    );
  }

  return (
    <section className="archive">
      <div className="list-header">
        <h2 className="section-title">
          {speedBand === null ? 'Every trip' : `Trips at ${speedBand}`}
        </h2>
        {/* "loaded", not "archived": the trip fetch is capped too, so this counts what
            the page holds and can page through, not the whole archive. */}
        <span className="list-count">
          {trips.length} trip{trips.length === 1 ? '' : 's'}
          {filtered ? ' in range' : ' loaded'}
          {/* Stated in the header, not only by the pressed card, because on a phone the
              cards are a screen above and the narrowed list would pass for the archive. */}
          {speedBand !== null && (
            <>
              {' · '}
              <button type="button" className="link" onClick={onClearSpeedBand}>
                Show every trip
              </button>
            </>
          )}
        </span>
      </div>

      <div className="table-wrap">
        <table aria-label="Trip archive">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.optional ? 'optional' : undefined}
                >
                  <button type="button" onClick={() => toggleSort(column.key)}>
                    <span className="wide-only">{column.label}</span>
                    <span className="narrow-only">{column.shortLabel ?? column.label}</span>
                    {sortKey === column.key ? (ascending ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pager.visible.map((trip) => (
              <tr
                key={trip.id}
                className="clickable"
                onClick={() => onSelect(trip.id)}
                // Rows are interactive, so they need to be reachable and activatable
                // without a mouse.
                tabIndex={0}
                role="button"
                aria-label={`Details for trip on ${formatDateTime(trip.start_date)}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(trip.id);
                  }
                }}
              >
                {COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={
                      [
                        column.key === 'start_date' ? 'left' : '',
                        column.optional ? 'optional' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                  >
                    {column.render(trip)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager {...pager} label="Trip pages" />
    </section>
  );
}
