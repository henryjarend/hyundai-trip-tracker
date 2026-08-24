/**
 * The car's current state, from the newest status snapshot plus the newest position fix.
 *
 * Everything here is as fresh as the car's last sync, not as fresh as the last poll —
 * the API returns Hyundai's cached view, and the car decides when to update it. The
 * "as of" line exists so this never reads as live telemetry when it is minutes old.
 */
import type { Position, StatusSnapshot } from '../api.ts';
import { formatNumber, formatRelative } from '../format.ts';

interface Props {
  status: StatusSnapshot | null;
  position: Position | null;
}

function plugLabel(status: StatusSnapshot): string {
  if (status.charging === true) {
    const power = status.charge_power;
    return power ? `Charging · ${formatNumber(power, 1)} kW` : 'Charging';
  }
  switch (status.plug_type) {
    case 'ac':
      return 'Plugged in (AC)';
    case 'dc':
      return 'Plugged in (DC)';
    case 'none':
      return 'Unplugged';
    default:
      // 'unknown' means the backend omitted the field, which is not the same as
      // knowing the cable is out.
      return '—';
  }
}

export function LiveStatus({ status, position }: Props) {
  if (!status) return null;

  const tiles: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Engine',
      // null is "the backend did not say", which must not render as "Off".
      value: status.engine_running === null ? '—' : status.engine_running ? 'Running' : 'Off',
    },
    {
      label: 'Battery',
      value: status.soc_percent === null ? '—' : `${formatNumber(status.soc_percent, 0)}%`,
      hint:
        status.ev_range_miles === null
          ? undefined
          : `${formatNumber(status.ev_range_miles, 0)} mi range`,
    },
    { label: 'Charging', value: plugLabel(status) },
    {
      label: 'Odometer',
      value: status.odometer_miles === null ? '—' : `${formatNumber(status.odometer_miles, 0)} mi`,
    },
    {
      label: 'Locked',
      value: status.locked === null ? '—' : status.locked ? 'Yes' : 'No',
    },
    {
      label: 'Last fix',
      value: position ? formatRelative(position.reported_at ?? position.recorded_at) : 'none yet',
      hint: position
        ? `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)} · ${position.source}`
        : undefined,
    },
  ];

  return (
    <section className="live">
      <div className="live-header">
        <h2 className="section-title">Right now</h2>
        <span className="live-asof">
          as reported by the car {formatRelative(status.synced_at)}
        </span>
      </div>

      {/* Compact below 640px, identical to the summary tiles above it. The car's current
          state is context, not the reason the page exists — at full tile size it costs
          three rows and pushes the archive off a second screen. */}
      <div className="tiles tiles-compact">
        {tiles.map((tile) => (
          <div className="tile" key={tile.label}>
            <div className="tile-label">{tile.label}</div>
            <div className="tile-value">{tile.value}</div>
            {tile.hint && <div className="tile-hint">{tile.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
