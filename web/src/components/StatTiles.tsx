import type { Summary } from '../api.ts';
import { coverageTile, milesTile, type Tile } from '../coverage-text.ts';
import { formatDuration, formatNumber } from '../format.ts';

interface Props {
  summary: Summary | null;
  /**
   * Whether a date range narrows the totals. Coverage changes meaning with it: over
   * the whole archive it is every mile the car has ever driven, over a range only the
   * miles driven within it. The tiles say which, since the number alone can't.
   */
  filtered: boolean;
}

export function StatTiles({ summary, filtered }: Props) {
  const tiles: Tile[] = [
    { label: 'Trips', value: summary ? String(summary.trip_count) : '—' },
    milesTile(summary, filtered),
    { label: 'Energy used', value: `${formatNumber(summary?.total_kwh, 1)} kWh` },
    { label: 'Regenerated', value: `${formatNumber(summary?.regen_kwh, 1)} kWh` },
    { label: 'Efficiency', value: `${formatNumber(summary?.avg_miles_per_kwh, 2)} mi/kWh` },
    { label: 'Time driving', value: formatDuration(summary?.total_seconds) },
    coverageTile(summary?.coverage, filtered),
  ];

  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div className="tile" key={tile.label} title={tile.title}>
          <div className="tile-label">{tile.label}</div>
          <div className="tile-value">{tile.value}</div>
          {tile.hints?.map((hint) => (
            <div className="tile-hint" key={hint}>
              {hint}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
