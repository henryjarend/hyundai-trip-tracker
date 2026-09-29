import type { Trip } from '../api.ts';
import { formatNumber } from '../format.ts';
import { speedBreakdown, THIN_MILES, type SpeedBand } from '../speed-bands.ts';

interface Props {
  trips: Trip[];
  /** How many trips the selected window holds, which the loaded list can fall short of. */
  totalTrips: number | null;
}

function percentFrom(value: number, base: number): string {
  const change = Math.round(((value - base) / base) * 100);
  if (change === 0) return 'same as overall';
  return `${change > 0 ? '+' : '−'}${Math.abs(change)}% vs overall`;
}

/**
 * One sentence that answers the question the section asks, from the bands with
 * enough miles behind them. Nothing is said when fewer than two qualify: a single
 * band has nothing to be compared against.
 */
function headline(bands: SpeedBand[]): string | null {
  const solid = bands.filter((band) => !band.thin && band.milesPerKwh !== null);
  if (solid.length < 2) return null;

  const best = solid.reduce((a, b) => (b.milesPerKwh! > a.milesPerKwh! ? b : a));
  const worst = solid.reduce((a, b) => (b.milesPerKwh! < a.milesPerKwh! ? b : a));
  if (best === worst) return null;

  const drop = Math.round((1 - worst.milesPerKwh! / best.milesPerKwh!) * 100);
  return (
    `Most efficient at ${best.label} (${formatNumber(best.milesPerKwh, 2)} mi/kWh). ` +
    `${worst.label} gets ${drop}% fewer miles from each kWh.`
  );
}

export function SpeedEfficiency({ trips, totalTrips }: Props) {
  const { bands, overallMilesPerKwh, skipped } = speedBreakdown(trips);
  const populated = bands.filter((band) => band.milesPerKwh !== null);
  if (populated.length === 0) return null;

  // Bars share one zero-based scale, so their lengths compare as efficiencies do.
  // Scaling from the smallest value instead would turn a 10% gap into a bar twice
  // as long.
  const scaleMax = Math.max(...populated.map((band) => band.milesPerKwh!));
  const summary = headline(bands);
  const truncated = totalTrips !== null && totalTrips > trips.length;

  return (
    <section className="speed">
      <div className="list-header">
        <h2 className="section-title">Efficiency by average speed</h2>
        <span className="list-count">
          {truncated ? `latest ${trips.length} of ${totalTrips} trips` : `${trips.length - skipped} trips`}
          {skipped > 0 && ` · ${skipped} without speed data`}
        </span>
      </div>

      {summary && <p className="speed-headline">{summary}</p>}

      <div className="tiles speed-tiles">
        {bands.map((band) => {
          const width = band.milesPerKwh === null ? 0 : (band.milesPerKwh / scaleMax) * 100;
          const volume =
            band.tripCount === 0
              ? 'no trips'
              : `${band.tripCount} trip${band.tripCount === 1 ? '' : 's'} · ${formatNumber(band.miles, 0)} mi`;
          return (
            <div
              className={`tile speed-tile${band.thin ? ' speed-thin' : ''}`}
              key={band.label}
              title={
                band.milesPerKwh === null
                  ? undefined
                  : `${formatNumber(band.miles, 1)} mi on ${formatNumber(band.kwh, 1)} kWh`
              }
            >
              <div className="tile-label">{band.label}</div>
              <div className="tile-value">
                {band.milesPerKwh === null ? '—' : formatNumber(band.milesPerKwh, 2)}
                {band.milesPerKwh !== null && <span className="tile-unit"> mi/kWh</span>}
              </div>
              <div className="speed-bar" aria-hidden="true">
                <div className="speed-bar-fill" style={{ width: `${width}%` }} />
              </div>
              <div className="tile-hint">{volume}</div>
              {band.milesPerKwh !== null && overallMilesPerKwh !== null && (
                <div className="tile-hint">
                  {band.thin
                    ? `under ${THIN_MILES} mi — too little to judge`
                    : percentFrom(band.milesPerKwh, overallMilesPerKwh)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="section-note">
        Trips are banded by the average speed Hyundai reports for the whole trip, so a
        highway run with a slow start can land a band lower than the road suggests. Each
        band's value is its total miles over its total kWh. Speed isn't the only lever:
        climate and a cold battery weigh heaviest on short, slow trips.
      </p>
    </section>
  );
}
