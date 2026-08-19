/**
 * The trip-list time filter: what each preset means, and how a selection becomes the
 * `from`/`to` instants the API takes.
 *
 * Kept out of the component because the arithmetic is the part that can be wrong in
 * ways the eye will not catch — a window resolved an hour off, or a local time read as
 * UTC, looks entirely plausible on screen and quietly hides trips.
 */

export type PresetId = '12h' | '1d' | '5d' | '1w' | '1mo' | 'all';

interface Preset {
  id: PresetId;
  label: string;
  /** Spelled out on hover: "1w" alone says nothing about which end is anchored. */
  title: string;
  /** How far back the window starts. Null means the whole archive. */
  back: { hours: number } | { months: number } | null;
}

export const PRESETS: readonly Preset[] = [
  { id: '12h', label: '12h', title: 'Trips started in the last 12 hours', back: { hours: 12 } },
  { id: '1d', label: '1d', title: 'Trips started in the last 24 hours', back: { hours: 24 } },
  { id: '5d', label: '5d', title: 'Trips started in the last 5 days', back: { hours: 120 } },
  { id: '1w', label: '1w', title: 'Trips started in the last 7 days', back: { hours: 168 } },
  {
    id: '1mo',
    label: '1mo',
    // A calendar month rather than 30 days, so "1mo" on the 19th means the 19th.
    title: 'Trips started since this day last month',
    back: { months: 1 },
  },
  // Without this there is no way back to the unfiltered archive, which is what the
  // page is for.
  { id: 'all', label: 'All', title: 'Every trip in the archive', back: null },
];

/**
 * A custom range holds the raw `datetime-local` strings rather than instants, so the
 * inputs round-trip exactly what was typed and the conversion happens once, at resolve
 * time.
 */
export type Range =
  | { kind: 'preset'; id: PresetId }
  | { kind: 'custom'; from: string | null; to: string | null };

/** What actually goes on the query string. Both ends are optional and independent. */
export interface ResolvedRange {
  from?: string;
  to?: string;
}

export const DEFAULT_RANGE: Range = { kind: 'preset', id: 'all' };

/**
 * A `datetime-local` value carries no zone, and the spec reads that form as *local*
 * time — which is what the reader meant by typing it.
 */
export function localToIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The inverse, for pre-filling the inputs. Built from the local getters rather than
 * `toISOString().slice(0, 16)`, which would silently shift the value by the offset.
 */
export function isoToLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Resolves a selection against a single moment, so one fetch uses one `now`. */
export function resolveRange(range: Range, now: Date): ResolvedRange {
  if (range.kind === 'custom') {
    const from = localToIso(range.from);
    const to = localToIso(range.to);
    return { ...(from === null ? {} : { from }), ...(to === null ? {} : { to }) };
  }

  const preset = PRESETS.find((candidate) => candidate.id === range.id);
  if (!preset || preset.back === null) return {};

  const start = new Date(now.getTime());
  if ('hours' in preset.back) {
    start.setTime(start.getTime() - preset.back.hours * 3_600_000);
  } else {
    start.setMonth(start.getMonth() - preset.back.months);
  }

  // Deliberately no `to`: the window is open at the top. A trip stamped a little ahead
  // of this browser's clock — the car and this machine are different clocks — would
  // otherwise disappear from "the last 12 hours".
  return { from: start.toISOString() };
}

/** The one way a custom range can be nonsense worth refusing to fetch. */
export function customRangeError(from: string | null, to: string | null): string | null {
  const start = localToIso(from);
  const end = localToIso(to);
  if (start === null || end === null) return null;
  return start > end ? 'Start is after end.' : null;
}
