import type { Summary } from '../api.ts';
import { formatDuration, formatNumber } from '../format.ts';

interface Props {
  summary: Summary | null;
}

export function StatTiles({ summary }: Props) {
  const tiles = [
    { label: 'Trips', value: summary ? String(summary.trip_count) : '—' },
    { label: 'Miles', value: formatNumber(summary?.total_miles, 0) },
    { label: 'Energy used', value: `${formatNumber(summary?.total_kwh, 1)} kWh` },
    { label: 'Regenerated', value: `${formatNumber(summary?.regen_kwh, 1)} kWh` },
    { label: 'Efficiency', value: `${formatNumber(summary?.avg_miles_per_kwh, 2)} mi/kWh` },
    { label: 'Time driving', value: formatDuration(summary?.total_seconds) },
  ];

  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div className="tile" key={tile.label}>
          <div className="tile-label">{tile.label}</div>
          <div className="tile-value">{tile.value}</div>
        </div>
      ))}
    </div>
  );
}
