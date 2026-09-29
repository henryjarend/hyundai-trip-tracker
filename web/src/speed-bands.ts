/**
 * Efficiency by average speed: the trips grouped into speed bands, each with the
 * efficiency of the band as a whole.
 *
 * Kept out of the component for the same reason as range.ts — the arithmetic is where
 * this can be wrong without looking wrong.
 */

import type { Trip } from './api.ts';

interface BandDef {
  label: string;
  /** Inclusive lower bound, mph. */
  min: number;
  /** Exclusive upper bound, mph. Null means no upper bound. */
  max: number | null;
}

/**
 * Fixed bands rather than quantiles, so a band means the same speeds whatever window is
 * selected and two windows can be compared tile for tile. The edges roughly follow the
 * kinds of driving: stop-and-go, town, suburban arterials, open road, and highway.
 */
export const BANDS: readonly BandDef[] = [
  { label: 'Under 20 mph', min: 0, max: 20 },
  { label: '20–35 mph', min: 20, max: 35 },
  { label: '35–50 mph', min: 35, max: 50 },
  { label: '50–65 mph', min: 50, max: 65 },
  { label: '65+ mph', min: 65, max: null },
];

/**
 * Below this many miles a band's efficiency is too noisy to lean on: one short trip
 * with the heater running can put a band anywhere. Such bands are still shown, marked
 * as thin, rather than hidden — hiding them would make the bands appear to cover less
 * of the driving than they do.
 */
export const THIN_MILES = 10;

export interface SpeedBand {
  label: string;
  tripCount: number;
  miles: number;
  kwh: number;
  /** Distance-weighted: the band's total miles over its total kWh. Null with no energy. */
  milesPerKwh: number | null;
  thin: boolean;
}

export interface SpeedBreakdown {
  bands: SpeedBand[];
  /** The same measure across every trip that landed in a band. */
  overallMilesPerKwh: number | null;
  /** Trips left out because Hyundai reported no average speed or no energy for them. */
  skipped: number;
}

/**
 * Efficiency is total miles over total kWh within a band, never the mean of per-trip
 * mi/kWh. A two-block trip with a cold cabin can read 1.2 mi/kWh and a plain average
 * would let it outweigh a forty-mile drive; weighting by energy is also what the
 * Efficiency tile does, so the band values and the tile are the same measure.
 */
export function speedBreakdown(trips: readonly Trip[]): SpeedBreakdown {
  const totals = BANDS.map(() => ({ tripCount: 0, miles: 0, wh: 0 }));
  let skipped = 0;

  for (const trip of trips) {
    const speed = trip.avg_speed;
    if (speed === null || !Number.isFinite(speed) || trip.energy_total_wh <= 0) {
      skipped += 1;
      continue;
    }
    const index = BANDS.findIndex(
      (band) => speed >= band.min && (band.max === null || speed < band.max),
    );
    // Only a negative speed misses every band, and that is not a speed.
    if (index === -1) {
      skipped += 1;
      continue;
    }
    const bucket = totals[index]!;
    bucket.tripCount += 1;
    bucket.miles += trip.distance_miles;
    bucket.wh += trip.energy_total_wh;
  }

  const bands = BANDS.map((band, index) => {
    const { tripCount, miles, wh } = totals[index]!;
    return {
      label: band.label,
      tripCount,
      miles,
      kwh: wh / 1000,
      milesPerKwh: wh > 0 ? miles / (wh / 1000) : null,
      thin: miles < THIN_MILES,
    };
  });

  const miles = totals.reduce((sum, bucket) => sum + bucket.miles, 0);
  const wh = totals.reduce((sum, bucket) => sum + bucket.wh, 0);

  return {
    bands,
    overallMilesPerKwh: wh > 0 ? miles / (wh / 1000) : null,
    skipped,
  };
}
