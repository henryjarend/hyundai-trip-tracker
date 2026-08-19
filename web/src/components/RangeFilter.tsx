import { useState } from 'react';
import { formatDateTime } from '../format.ts';
import {
  customRangeError,
  isoToLocalInput,
  PRESETS,
  resolveRange,
  type PresetId,
  type Range,
  type ResolvedRange,
} from '../range.ts';

interface Props {
  range: Range;
  /**
   * The window the visible trips were actually fetched for, not the one a fresh
   * `resolveRange` would produce now. A preset's start moves with the clock, so
   * re-deriving it here would caption the table with a window it was never loaded
   * for.
   */
  resolved: ResolvedRange;
  onChange: (range: Range) => void;
}

/** Says exactly what was asked for, including which end is open. */
function describe(resolved: ResolvedRange): string {
  const from = resolved.from ? formatDateTime(resolved.from) : null;
  const to = resolved.to ? formatDateTime(resolved.to) : null;

  if (from && to) return `${from} → ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Up to ${to}`;
  return 'The whole archive';
}

export function RangeFilter({ range, resolved, onChange }: Props) {
  const custom = range.kind === 'custom';

  // Drafts, because a half-typed range must not be fetched. They only reach `onChange`
  // once they make sense.
  const [draft, setDraft] = useState({ from: '', to: '' });
  const error = customRangeError(draft.from || null, draft.to || null);

  function openCustom() {
    // Start from whatever window is already on screen, so switching to Custom is a
    // refinement rather than a reset.
    const current = resolved.from ?? null;
    const from = draft.from || (current ? isoToLocalInput(new Date(current)) : '');
    setDraft({ ...draft, from });
    onChange({ kind: 'custom', from: from || null, to: draft.to || null });
  }

  function edit(field: 'from' | 'to', value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (customRangeError(next.from || null, next.to || null) === null) {
      onChange({ kind: 'custom', from: next.from || null, to: next.to || null });
    }
  }

  function selectPreset(id: PresetId) {
    onChange({ kind: 'preset', id });
  }

  return (
    <section className="range" aria-label="Time range">
      <div className="range-chips" role="group">
        {PRESETS.map((preset) => {
          const selected = range.kind === 'preset' && range.id === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.title}
              aria-pressed={selected}
              className={`range-chip${selected ? ' selected' : ''}`}
              onClick={() => selectPreset(preset.id)}
            >
              {preset.label}
            </button>
          );
        })}

        <button
          type="button"
          title="Pick an exact start and end"
          aria-pressed={custom}
          className={`range-chip${custom ? ' selected' : ''}`}
          onClick={openCustom}
        >
          Custom
        </button>
      </div>

      {custom && (
        <div className="range-custom">
          <label>
            From
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(event) => edit('from', event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(event) => edit('to', event.target.value)}
            />
          </label>
          {/* Either end may be left blank for an open-ended window, so this is a way
              out of a half-filled custom range rather than the only way to submit. */}
          <button
            type="button"
            className="link"
            onClick={() => {
              setDraft({ from: '', to: '' });
              onChange({ kind: 'preset', id: 'all' });
            }}
          >
            Clear
          </button>
        </div>
      )}

      <p className={error ? 'range-summary invalid' : 'range-summary'}>
        {error ?? describe(resolved)}
        {!error && (
          // The filter is on when the trip *started*, which is what the archive is
          // keyed by. Trips are minutes long, so this only ever matters at a boundary.
          <span className="range-note"> · by trip start time</span>
        )}
      </p>
    </section>
  );
}
