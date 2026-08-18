-- Live position tracking (findMyCar) plus a transition log derived from status polls.
--
-- Background: the trip payload carries no coordinates at all, so until now a trip's
-- start/end location could only be approximated from whichever cached status snapshot
-- happened to sit nearest it in time. `rcs/rfc/findMyCar` returns a real fix on demand,
-- which is both fresher and independent of the car's own sync cadence.
--
-- That endpoint is rate limited (errorCode 502 / errorSubCode HT_534), so every call has
-- to be earned. The state table below is what makes the throttle survive a restart —
-- keeping it in memory would reset the budget every time the poller container bounces.

CREATE TABLE IF NOT EXISTS vehicle_positions (
    id           bigserial PRIMARY KEY,
    vin          text        NOT NULL REFERENCES vehicles (vin) ON DELETE CASCADE,

    -- When the *car* reported the fix, as opposed to when we asked for it.
    -- findMyCar's `time` arrives in two shapes (see parseFindMyCarResponse): an
    -- RFC-1123 "… GMT" string, which is a real instant, or a zone-less compact
    -- stamp, which is resolved with VEHICLE_TZ on the way in. Null if absent.
    reported_at  timestamptz,
    -- Kept verbatim so a format we mis-resolve can be re-derived later.
    reported_at_raw text,

    latitude     double precision NOT NULL,
    longitude    double precision NOT NULL,
    altitude     double precision,

    -- 'findMyCar' today. Status snapshots also carry a cached position; if that ever
    -- gets promoted into this table, this column is what tells the two apart.
    source       text        NOT NULL DEFAULT 'findMyCar',

    raw          jsonb       NOT NULL,
    recorded_at  timestamptz NOT NULL DEFAULT now(),

    -- NULLS NOT DISTINCT (Postgres 15+) so that a fix with no usable `time` still
    -- dedupes on its coordinates instead of inserting a fresh row on every poll.
    -- Coordinates are part of the key deliberately: if the car genuinely moved we
    -- want the row even when the timestamp is missing or repeated.
    CONSTRAINT vehicle_positions_fix_key
        UNIQUE NULLS NOT DISTINCT (vin, reported_at, latitude, longitude)
);

CREATE INDEX IF NOT EXISTS vehicle_positions_vin_reported_idx
    ON vehicle_positions (vin, reported_at DESC);

-- Throttle/backoff bookkeeping for findMyCar, one row per vehicle.
CREATE TABLE IF NOT EXISTS location_fetch_state (
    vin                  text PRIMARY KEY REFERENCES vehicles (vin) ON DELETE CASCADE,

    last_attempt_at      timestamptz,
    last_success_at      timestamptz,
    -- Odometer at the last successful fix. A fix is only worth spending a call on
    -- once this has moved — the reference implementation gates on the same signal.
    last_odometer_miles  numeric,

    -- Set when the backend answers HT_534. No call is attempted until it passes.
    rate_limited_until   timestamptz,
    -- Drives the exponential backoff; reset to 0 by any successful fix.
    consecutive_failures integer     NOT NULL DEFAULT 0,
    last_error           text,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Transitions inferred by diffing consecutive status snapshots. This is the closest
-- thing to an event stream the USA API allows: there is no webhook, no push channel
-- and no long-poll anywhere in the Bluelink API, so "the car started" can only ever
-- be observed after the fact, by noticing that a field changed between two polls.
--
-- Latency is therefore bounded by the car's own sync cadence, not by POLL_INTERVAL —
-- a cached status only changes once the car has told Hyundai something new.
CREATE TABLE IF NOT EXISTS vehicle_events (
    id           bigserial PRIMARY KEY,
    vin          text        NOT NULL REFERENCES vehicles (vin) ON DELETE CASCADE,

    -- engine_on | engine_off | moved | charge_start | charge_stop |
    -- plugged_in | unplugged
    kind         text        NOT NULL,

    -- The synced_at of the snapshot that revealed the change, i.e. roughly when it
    -- happened. Null only if the backend omitted dateTime.
    observed_at  timestamptz,
    -- When we noticed, which is always >= observed_at and often well after it.
    detected_at  timestamptz NOT NULL DEFAULT now(),

    previous     jsonb,
    current      jsonb,

    -- Re-reading the same snapshot must not re-emit the same event.
    CONSTRAINT vehicle_events_key
        UNIQUE NULLS NOT DISTINCT (vin, kind, observed_at)
);

CREATE INDEX IF NOT EXISTS vehicle_events_vin_observed_idx
    ON vehicle_events (vin, observed_at DESC);

-- Engine state is what makes trip-in-progress detection possible, and it is already
-- present in the cached status response we fetch — it was simply never stored.
ALTER TABLE vehicle_status_snapshots
    ADD COLUMN IF NOT EXISTS engine_running boolean;

-- Backfill from the payloads already stored, exactly as migration 002 did.
UPDATE vehicle_status_snapshots
SET engine_running = (raw ->> 'engine')::boolean
WHERE engine_running IS NULL
  AND raw ->> 'engine' IN ('true', 'false');

-- Per-run accounting for the new work, so a rate-limited or skipped location fetch is
-- visible in `poll_runs` rather than only in the container log.
ALTER TABLE poll_runs
    ADD COLUMN IF NOT EXISTS positions_inserted integer NOT NULL DEFAULT 0;
ALTER TABLE poll_runs
    ADD COLUMN IF NOT EXISTS events_recorded integer NOT NULL DEFAULT 0;
-- fetched | skipped_throttled | skipped_no_movement | rate_limited | failed | disabled
ALTER TABLE poll_runs
    ADD COLUMN IF NOT EXISTS location_status text;
