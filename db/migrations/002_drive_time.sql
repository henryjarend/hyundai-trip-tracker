-- The payload carries `mileagetime`, which runs consistently below `duration`
-- (by 9–91s across observed trips). That difference is time stopped, so this is
-- moving time. Kept separate from duration so "idle time" is derivable.

ALTER TABLE trips ADD COLUMN IF NOT EXISTS drive_time_seconds integer;

-- Backfill from the payloads already stored.
UPDATE trips
SET drive_time_seconds = (raw -> 'mileagetime' ->> 'value')::int
WHERE drive_time_seconds IS NULL
  AND raw -> 'mileagetime' ->> 'value' ~ '^[0-9]+$';
