# Hyundai Trip Tracker

Long-term trip history for a Hyundai EV, built because Bluelink only ever exposes the
**last ~4 trips**. This polls the same endpoint the MyHyundai app uses, stores every trip
in Postgres, and serves the archive as a web page.

History accumulates from the day you start the poller. Trips Hyundai has already dropped
are gone — there is no backfill.

## How it works

A poller logs in to Bluelink every `POLL_INTERVAL_MINUTES`, reads the ~4 trips currently
visible, and upserts them on `(vin, start_date_raw)`. A trip already stored has its
metrics refreshed (Hyundai sometimes revises them shortly after a trip ends) but is never
duplicated, and its `first_seen_at` is preserved — so the table only ever grows. The API
and React frontend are read-only views over that table.

The web UI lists trips with date, distance, duration, kWh used and mi/kWh; clicking a row
opens the full record — speeds, the per-system energy breakdown, moving vs. stopped time,
approximate start/end locations, and the raw payload.

The API call sequence is a direct TypeScript port of
[BetterBlueKit](https://github.com/schmidtwmark/BetterBlueKit)'s `HyundaiUSAAPIClient`:

| Call | Endpoint |
|---|---|
| Login | `POST /v2/ac/oauth/token` |
| Vehicles | `GET /ac/v2/enrollment/details/{username}` |
| **Trips** | `GET /ac/v2/ts/alerts/maintenance/evTripDetails` |
| Status | `GET /ac/v2/rcs/rvs/vehicleStatus` |

All against `https://api.telematics.hyundaiusa.com`. Status is fetched with
`refresh: false`, so nothing here ever wakes the car's modem.

Unofficial and unaffiliated with Hyundai. Requires an active Bluelink subscription.

## Setup

```bash
cp .env.example .env    # fill in your Bluelink email, password and PIN
npm install
```

`.env` holds your Bluelink password and PIN. It is gitignored — keep it that way.

### Run it

```bash
npm run stack:up
```

Postgres, the API (on `http://localhost:3000`) and the poller all start; migrations run
automatically. Open [http://localhost:3000](http://localhost:3000).

| Script | Does |
|---|---|
| `npm run stack:up` | Tear down, rebuild, start |
| `npm run stack:down` | Stop and remove containers |
| `npm run stack:logs` | Follow the poller's log |
| `npm run stack:status` | Print the last 5 poll runs from the database |
| `npm run geonames:load` | Load the offline place-name database (one-off) |

### Place names (optional, one-off)

Trip detail shows the nearest town for the start and end positions. That lookup runs
entirely locally — with the stack already running, populate it once:

```bash
npm run geonames:load
```

It downloads the GeoNames `cities500` dataset (~235k places with population ≥ 500) and
loads it into Postgres. Until you do, locations still show as coordinates and still link
to a map; only the names are missing. Re-run occasionally to refresh the data.

**Your coordinates never leave the machine.** Reverse geocoding is a spatial query
against that local table using Postgres's `earthdistance` extension — no geocoding
service, no API key, no rate limit, and nothing about where you park is sent anywhere.

**Why `stack:up` runs `down` first.** `podman-compose up` fails with
`container name … is already in use` when stopped containers from a previous run still
hold the names — it does not replace them, and `--podman-args replace` does not help.
Removing them first avoids it. (Docker Compose recreates automatically; this is a
podman-compose difference.)

**Podman Desktop on Windows won't show these containers.** Podman Desktop talks to its
own Podman machine, which is a different WSL distro with a separate container store from
the `podman` inside your Ubuntu WSL distro. Since the project files and builds live in
WSL, manage the stack from the WSL CLI — the two container lists are independent and
that is expected, not a fault.

### Run it without containers

Point `DATABASE_URL` at any Postgres instance, then:

```bash
npm run migrate      # create the schema
npm run poll:once    # one poll, writes to the database
npm run api          # serve the API + built frontend on :3000
npm run poll         # the long-running poller
```

For frontend development, `npm run dev:web` serves the UI on :5173 and proxies `/api` to
the Fastify server on :3000.

## Verifying it works

Start with a dry run — it hits the real API and prints what it parsed **without writing
anything**, so you can confirm your credentials and headers are good before involving the
database:

```bash
npm run poll:once -- --dry-run
```

If that fails, set `DEBUG_HTTP=1` to log the outgoing (redacted) headers.

Then do a real poll and check the data landed:

```bash
npm run migrate
npm run poll:once

podman exec hyundai-trip-tracker_db_1 psql -U postgres -d hyundai -c \
  "select start_date, distance_miles, energy_total_wh,
          round(distance_miles / (energy_total_wh / 1000.0), 2) as mi_per_kwh
   from trips order by start_date desc limit 10;"
```

**The key check:** poll twice and confirm `select count(*) from trips` does not change.
That proves the dedupe key works, which is what the whole design rests on. `npm run
stack:status` shows it directly — a second run over the same trips reports
`trips_inserted = 0` with `trips_updated` matching `trips_seen`.

```bash
npm test           # no credentials needed; geocoding tests skip without GeoNames loaded
npm run typecheck
```

`npm run stack:status` (or `select * from poll_runs order by started_at desc limit 5;`)
shows whether polls are succeeding. The web UI surfaces the same thing: a failed poll
raises a banner rather than silently looking like an empty archive.

## API

Read-only apart from the manual poll trigger. The same server also serves the built
frontend, so everything is on one port.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ok: true}` |
| `GET /api/vehicles` | Enrolled vehicles with a trip count each |
| `GET /api/trips` | Paginated trips, newest first — `vin`, `from`, `to`, `limit`, `offset` |
| `GET /api/trips/:id` | One trip in full, plus `raw` and approximate start/end locations |
| `GET /api/stats/summary` | Totals and average efficiency — same filters as `/api/trips` |
| `GET /api/status` | Recent vehicle status snapshots |
| `GET /api/poll-runs` | Poll history, including failures |
| `POST /api/poll` | Runs a poll immediately |

A database that is unreachable answers `503` with the reason, rather than hanging.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `HYUNDAI_USERNAME` / `HYUNDAI_PASSWORD` / `HYUNDAI_PIN` | — | Required by the poller |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/hyundai` | |
| `POLL_INTERVAL_MINUTES` | `15` | Must be shorter than the time it takes you to make 4 trips |
| `VEHICLE_TZ` | `America/Chicago` | Trip timestamps arrive with no timezone; this resolves them |
| `HYUNDAI_UTC_OFFSET` | `-5` | The `offset` header the app sends |
| `PORT` | `3000` | |
| `DEBUG_HTTP` | `0` | `1` logs redacted outgoing headers |

### Why 15 minutes

Only ~4 trips are ever visible, with no pagination. If you make 5 trips between two polls,
the oldest is lost permanently. Fifteen minutes leaves a wide margin; the calls are served
from Hyundai's cache, so polling costs the car nothing.

## Notes for future maintenance

- **Do not switch the HTTP client to global `fetch`.** It strips or rewrites `Host`,
  `Connection` and `Accept-Encoding`, which the backend requires. `server/src/hyundai/client.ts`
  uses `undici.request()` deliberately, and decompresses gzip responses by hand because
  undici does not.
- **`start_date_raw` is the dedupe key** and is stored exactly as Hyundai sends it. Changing
  `VEHICLE_TZ` recomputes `start_date` for new rows but never breaks dedupe.
- Every trip and status row keeps the original payload in a `raw` jsonb column, so fields
  this code does not parse yet are still recoverable. That is not theoretical: the
  `mileagetime` field (moving time, shown as "Moving"/"Stopped") was added in migration
  `002` and backfilled entirely from already-stored payloads.
- **The API and poller both run migrations on boot**, and start simultaneously under
  compose. They serialise behind a Postgres advisory lock in `server/src/db/migrate.ts` —
  keep that if you add another entrypoint.
- **Do not percent-encode the username** in the vehicles URL. `@` is legal in a path
  segment and Hyundai answers `502` when it is escaped; BetterBlueKit interpolates it raw
  and so must this.
- Trip entries that fail to parse are logged with the field that was missing rather than
  dropped silently — check the poller log if a trip you expect never appears.

## Not included

Backfilling lost trips, GPS routes, and authentication on the web UI — it assumes a
trusted network.

**On trip locations.** Hyundai's `evTripDetails` returns no coordinates whatsoever — the
14 fields are distance, odometer, speeds, duration, the energy breakdown and a timestamp.
The start/end positions shown in trip detail are *approximations*, taken from the nearest
`vehicleStatus` position reading within 90 minutes of each trip boundary. A poll that
lands shortly after you park gives a good destination fix; one that doesn't gives nothing.
Shortening `POLL_INTERVAL_MINUTES` improves the odds.
