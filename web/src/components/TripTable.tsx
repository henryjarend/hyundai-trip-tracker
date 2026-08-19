import { useMemo, useState } from 'react';
import type { Trip } from '../api.ts';
import { formatDateTime, formatDuration, formatNumber, kwh } from '../format.ts';

type SortKey =
  | 'start_date'
  | 'distance_miles'
  | 'duration_seconds'
  | 'energy_total_wh'
  | 'miles_per_kwh';

interface Column {
  key: SortKey;
  label: string;
  render: (trip: Trip) => string;
}

// Deliberately minimal — everything else lives in the detail modal.
const COLUMNS: Column[] = [
  { key: 'start_date', label: 'Started', render: (t) => formatDateTime(t.start_date) },
  { key: 'distance_miles', label: 'Miles', render: (t) => formatNumber(t.distance_miles) },
  { key: 'duration_seconds', label: 'Duration', render: (t) => formatDuration(t.duration_seconds) },
  { key: 'energy_total_wh', label: 'kWh used', render: (t) => kwh(t.energy_total_wh) },
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
}

export function TripTable({ trips, onSelect, filtered }: Props) {
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

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((previous) => !previous);
    } else {
      setSortKey(key);
      setAscending(false);
    }
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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key}>
                <button type="button" onClick={() => toggleSort(column.key)}>
                  {column.label}
                  {sortKey === column.key ? (ascending ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((trip) => (
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
                <td key={column.key} className={column.key === 'start_date' ? 'left' : ''}>
                  {column.render(trip)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
