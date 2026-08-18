-- Hyundai Trip Tracker — initial schema.
--
-- The Hyundai evTripDetails endpoint only ever returns the last ~4 trips and gives
-- each trip no ID. `(vin, start_date_raw)` is the only natural key available, so it
-- is what every upsert dedupes on.

CREATE TABLE IF NOT EXISTS vehicles (
    vin           text PRIMARY KEY,
    reg_id        text        NOT NULL,
    nickname      text,
    generation    integer     NOT NULL DEFAULT 1,
    fuel_type     text        NOT NULL DEFAULT 'electric',
    account_id    text,
    odometer_miles numeric,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
    id                       bigserial PRIMARY KEY,
    vin                      text        NOT NULL REFERENCES vehicles (vin) ON DELETE CASCADE,

    -- The API string verbatim ("2026-08-16 14:32:07.0"). Dedupe key: kept raw so
    -- history stays stable even if VEHICLE_TZ is changed later.
    start_date_raw           text        NOT NULL,
    -- The same wall-clock time, no zone attached.
    start_date_local         timestamp   NOT NULL,
    -- Resolved to a real instant using VEHICLE_TZ at ingest time.
    start_date               timestamptz NOT NULL,

    duration_seconds         integer     NOT NULL,

    -- Values exactly as reported, plus the unit code (1 = km, otherwise miles).
    distance_unit            smallint    NOT NULL,
    distance                 numeric     NOT NULL,
    odometer                 numeric,
    -- Normalised for querying regardless of what unit the account is set to.
    distance_miles           numeric     NOT NULL,
    odometer_miles           numeric,

    avg_speed                numeric,
    max_speed                numeric,

    -- All energy figures are watt-hours.
    energy_total_wh          integer     NOT NULL,
    energy_regen_wh          integer     NOT NULL DEFAULT 0,
    energy_climate_wh        integer     NOT NULL DEFAULT 0,
    energy_drivetrain_wh     integer     NOT NULL DEFAULT 0,
    energy_accessories_wh    integer     NOT NULL DEFAULT 0,
    energy_battery_care_wh   integer     NOT NULL DEFAULT 0,

    -- Hyundai adds and renames fields without notice; keep the original payload.
    raw                      jsonb       NOT NULL,

    first_seen_at            timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT trips_vin_start_date_raw_key UNIQUE (vin, start_date_raw)
);

CREATE INDEX IF NOT EXISTS trips_vin_start_date_idx ON trips (vin, start_date DESC);

CREATE TABLE IF NOT EXISTS vehicle_status_snapshots (
    id              bigserial PRIMARY KEY,
    vin             text        NOT NULL REFERENCES vehicles (vin) ON DELETE CASCADE,

    -- From vehicleStatus.dateTime. Cached status repeats unchanged between polls,
    -- so the unique constraint below quietly drops the duplicates.
    synced_at       timestamptz NOT NULL,

    soc_percent     numeric,
    ev_range_miles  numeric,
    charging        boolean,
    plug_type       text,
    charge_power    numeric,
    odometer_miles  numeric,
    latitude        double precision,
    longitude       double precision,
    locked          boolean,
    battery_12v     numeric,
    raw             jsonb       NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vehicle_status_vin_synced_at_key UNIQUE (vin, synced_at)
);

CREATE INDEX IF NOT EXISTS vehicle_status_vin_synced_idx
    ON vehicle_status_snapshots (vin, synced_at DESC);

CREATE TABLE IF NOT EXISTS poll_runs (
    id               bigserial PRIMARY KEY,
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    ok               boolean     NOT NULL DEFAULT false,
    trips_seen       integer     NOT NULL DEFAULT 0,
    trips_inserted   integer     NOT NULL DEFAULT 0,
    trips_updated    integer     NOT NULL DEFAULT 0,
    status_inserted  integer     NOT NULL DEFAULT 0,
    error            text
);

CREATE INDEX IF NOT EXISTS poll_runs_started_at_idx ON poll_runs (started_at DESC);
