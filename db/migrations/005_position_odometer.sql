-- Make a recorded position provable against a trip boundary, and repair the fixes
-- that were stored with the wrong instant.
--
-- Two problems, both discovered against live data:
--
-- 1. `findMyCar` returns "2026-08-17T23:01:38Z" — the same explicitly-UTC shape as
--    `vehicleStatus.dateTime` — but parseFixTime stripped the trailing Z along with
--    the separators and then resolved the result with VEHICLE_TZ. Every fix so stored
--    sits a full vehicle offset away from the moment it was actually taken, which is
--    enough to detach it from the trip it belongs to.
--
-- 2. A position on its own cannot be tied to a trip except by time-nearness, which
--    fails whenever the car sat parked longer than the matching window. The odometer
--    settles it — it is monotonic, and a fix taken at the same odometer as a trip's
--    boundary was taken while the car sat at that boundary, however long before or
--    after. That only works if the odometer is recorded alongside the fix.

ALTER TABLE vehicle_positions
    ADD COLUMN IF NOT EXISTS odometer_miles numeric;

-- Re-derive the instant for every fix whose raw stamp names its zone. Postgres reads
-- those directly; the zone-less forms are left exactly as ingest resolved them.
-- Skipped where a correctly-stamped row for the same fix already exists, so this can
-- never trip the (vin, reported_at, latitude, longitude) uniqueness and fail a boot.
UPDATE vehicle_positions p
SET reported_at = p.reported_at_raw::timestamptz
WHERE p.reported_at_raw ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
  AND p.reported_at IS DISTINCT FROM p.reported_at_raw::timestamptz
  AND NOT EXISTS (
      SELECT 1
      FROM vehicle_positions other
      WHERE other.id <> p.id
        AND other.vin = p.vin
        AND other.latitude = p.latitude
        AND other.longitude = p.longitude
        AND other.reported_at = p.reported_at_raw::timestamptz
  );

-- Backfill the odometer for fixes taken before the column existed, but only from a
-- snapshot that proves the car was standing still (engine off) within a few minutes
-- of the fix. A snapshot from a moving car carries a stale odometer, and pairing that
-- with a mid-route position would manufacture a "proof" that the car was parked
-- somewhere it was merely driving past.
UPDATE vehicle_positions p
SET odometer_miles = (
    SELECT s.odometer_miles
    FROM vehicle_status_snapshots s
    WHERE s.vin = p.vin
      AND s.odometer_miles IS NOT NULL
      AND s.engine_running IS FALSE
      AND abs(extract(epoch FROM (s.synced_at - COALESCE(p.reported_at, p.recorded_at)))) <= 900
    ORDER BY abs(extract(epoch FROM (s.synced_at - COALESCE(p.reported_at, p.recorded_at))))
    LIMIT 1
)
WHERE p.odometer_miles IS NULL;
