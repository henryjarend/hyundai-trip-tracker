-- Local reverse geocoding via the GeoNames cities database.
--
-- Coordinates never leave this machine: "nearest town" is a spatial lookup against
-- a table we populate ourselves (npm run geonames:load), not a call to a geocoding
-- service. No API keys, no rate limits, no coordinates sent anywhere.
--
-- `earthdistance` (with `cube`) ships with the stock Postgres image, so this needs
-- no PostGIS.

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

CREATE TABLE IF NOT EXISTS geonames_cities (
    geonameid    integer PRIMARY KEY,
    name         text             NOT NULL,
    latitude     double precision NOT NULL,
    longitude    double precision NOT NULL,
    country_code text,
    admin1_code  text,
    population   integer
);

-- Maps ("US", "MI") -> "Michigan", so a label can read "Rockford, Michigan"
-- rather than "Rockford, MI".
CREATE TABLE IF NOT EXISTS geonames_admin1 (
    code text PRIMARY KEY,   -- e.g. "US.MI"
    name text NOT NULL
);

-- The index that makes nearest-city search fast: a GIST index over each city's
-- position as an earth-cube point, letting the <-> operator order by true
-- great-circle distance.
CREATE INDEX IF NOT EXISTS geonames_cities_earth_idx
    ON geonames_cities USING gist (ll_to_earth(latitude, longitude));
