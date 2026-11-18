/**
 * What the Miles and Coverage tiles say. Pure, so the wording rules are tested without
 * rendering: rounding that never claims 100% with a mile missing, the scope each
 * figure covers, and which untracked parts are worth naming.
 */
import type { Coverage, Summary } from './api.ts';
import { formatNumber } from './format.ts';

export interface Tile {
  label: string;
  value: string;
  /** One line each, under the value. */
  hints?: string[];
  title?: string;
}

/**
 * Rounded down, so a single untracked mile can never show as 100.0%. 100% is reserved
 * for odometer miles that are all inside archived trips.
 */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio >= 1) return '100%';
  return `${(Math.floor(ratio * 1000) / 10).toFixed(1)}%`;
}

const miles = (value: number) => `${formatNumber(value, 0)} mi`;

/**
 * Tracked miles against the odometer. Measured by odometer rather than by summing trip
 * distances, which Hyundai truncates to whole miles and so run about 5% low.
 */
export function milesTile(summary: Summary | null, filtered: boolean): Tile {
  const coverage = summary?.coverage;
  if (!coverage) return { label: 'Miles', value: formatNumber(summary?.total_miles, 0) };

  return {
    label: 'Miles',
    value: formatNumber(coverage.tracked_miles, 0),
    hints: [
      filtered
        ? `of ${miles(coverage.odometer_miles)} driven in this range`
        : `of all ${miles(coverage.odometer_miles)} the car has driven`,
    ],
    title:
      `Measured by odometer across archived trips. Adding up the trip distances Hyundai ` +
      `reports gives ${miles(summary.total_miles)}, because it truncates each one to whole miles.`,
  };
}

/** What share of the odometer is tracked, and where the rest went. */
export function coverageTile(coverage: Coverage | undefined, filtered: boolean): Tile {
  const scope = filtered ? 'of miles driven in this range' : 'of every mile the car has driven';
  if (!coverage || coverage.ratio === null) {
    // A null ratio from a loaded summary means the odometer didn't move.
    const idle = coverage && filtered ? ['No driving in this range'] : [];
    return { label: 'Coverage', value: '—', hints: idle };
  }
  const gaps = coverage.gaps.length;
  const parts: string[] = [];
  if (coverage.before_first_trip_miles >= 1) {
    parts.push(
      `${miles(coverage.before_first_trip_miles)} ${filtered ? 'before the first trip' : 'before tracking'}`,
    );
  }
  if (gaps > 0) {
    parts.push(`${miles(coverage.missed_miles)} in ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`);
  }
  if (coverage.after_last_trip_miles >= 1) {
    parts.push(`${miles(coverage.after_last_trip_miles)} not yet reported`);
  }

  const span =
    coverage.odometer_start_miles !== null && coverage.odometer_end_miles !== null
      ? ` (odometer ${formatNumber(coverage.odometer_start_miles, 0)} to ` +
        `${formatNumber(coverage.odometer_end_miles, 0)})`
      : '';
  const title =
    `${filtered ? 'In this range' : 'Over the life of the car'}: ` +
    `${formatNumber(coverage.tracked_miles, 1)} of ${formatNumber(coverage.odometer_miles, 1)} ` +
    `odometer miles${span} fall inside an archived trip. Untracked: ` +
    `${formatNumber(coverage.before_first_trip_miles, 1)} before the first trip, ` +
    `${formatNumber(coverage.missed_miles, 1)} in gaps between trips, ` +
    `${formatNumber(coverage.after_last_trip_miles, 1)} since the last reported trip.`;

  return {
    label: 'Coverage',
    value: formatRatio(coverage.ratio),
    hints: [scope, parts.length > 0 ? parts.join(' · ') : 'none missed'],
    title,
  };
}
