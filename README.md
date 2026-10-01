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
start/end locations where they can be established, and the raw payload.

A time filter above the table narrows both the list and the totals to the last 12h, 1d, 5d,
1w or month, or to an exact start and end you pick; either end of a custom range may be
left open. It filters on when a trip *started*, since that is what the archive is keyed by.

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
mise install            # Node 26, per mise.toml — skip if you have it another way
cp .env.example .env    # fill in your Bluelink email, password and PIN
npm install
```

`.env` holds your Bluelink password and PIN. It is gitignored — keep it that way.

Node 26 is a hard floor: the server has no build step because Node runs the TypeScript
sources directly. `mise.toml` pins it, and CI installs from that same file.

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

**Podman Desktop and the CLI must point at the same engine.** Podman Desktop talks to its
own Podman machine, a separate WSL distro with its own container store — so a stack
started by a bare `podman` in a different WSL distro is invisible to it. This stack runs
on the machine engine Desktop uses, so the CLI has to be aimed there too:

```bash
export CONTAINER_CONNECTION=podman-machine-default-root
```

Put that in `~/.bashrc`. Without it, `podman ps` and the `stack:*` scripts address a
different engine than Desktop and appear to show nothing.

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
| `GET /api/trips/:id` | One trip in full, plus `raw` and its start/end locations |
| `GET /api/stats/summary` | Totals and average efficiency — same filters as `/api/trips` |
| `GET /api/status` | Recent vehicle status snapshots |
| `GET /api/positions` | Recent GPS fixes from `findMyCar` |
| `GET /api/events` | Inferred transitions — engine on/off, moved, charge, plug |
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
| `LOCATION_ENABLED` | `1` | `0` disables GPS fetching entirely |
| `LOCATION_INTERVAL_MINUTES` | `60` | Floor between fixes while parked |
| `LOCATION_ACTIVE_INTERVAL_MINUTES` | `10` | Floor between fixes while the engine runs |
| `LOCATION_BACKOFF_MINUTES` | `60` | First wait after an `HT_534` refusal; doubles |
| `LOCATION_BACKOFF_MAX_MINUTES` | `720` | Cap on that doubling |

## CI, releases and the container image

Three workflows' worth of behaviour, all from off-the-shelf actions:

**Every pull request** runs `npm run typecheck` and `npm test` on the Node from
`mise.toml`, and builds the image without pushing it — a broken Dockerfile should fail on
the PR, because at release time the only fix is another release. No credentials are
needed; the geocoding tests skip themselves when Postgres is unreachable.

It also scans the **whole git history** for secrets with
[Betterleaks](https://github.com/betterleaks/betterleaks), pinned in `mise.toml`. A
secret deleted in a later commit is still readable in the one that added it, so the scan
covers every commit, not just the diff. Findings are redacted in the log, and live
validation stays off. The few values that look like credentials but aren't (the stock
`postgres:postgres` login, the MyHyundai app's public client secret, test placeholders)
are filtered by exact value in `.betterleaks.toml`. To run the same scan locally:

```bash
mise x -- betterleaks git . --redact
```

**Every push to main** updates a release pull request
([release-please](https://github.com/googleapis/release-please)) listing the
conventional-commit subjects accumulated since the last release. That PR is the release:
merging it bumps the version in `package.json`, writes `CHANGELOG.md`, tags the commit and
publishes a GitHub release. Commit subjects therefore matter — `feat:` takes the minor,
`fix:` the patch, and a `!` or a `BREAKING CHANGE:` footer takes the major.

**Merging the release PR** then builds and pushes the image to GitHub Container Registry,
tagged four ways — `1.2.3`, `1.2`, `1`, and `latest`:

```bash
podman pull ghcr.io/henryjarend/hyundai-trip-tracker:latest
```

One image, two entrypoints, exactly as the compose file uses it — `node
server/src/api/server.ts` for the API and `node server/src/ingest/index.ts` for the
poller. `npm run stack:up` still builds locally from source; the published image is for
running it somewhere that is not this checkout.

A note on the two things that are easy to trip over here:

- **The publish job hangs off the release job rather than watching for the tag.**
  Release-please tags using the workflow's own `GITHUB_TOKEN`, and events raised by that
  token never start another workflow run, so an `on: push: tags` build would never fire.
- **A newly created GHCR package is private.** Make it public under the package's settings
  if you want to pull without authenticating; otherwise `podman login ghcr.io` with a
  token carrying `read:packages`.

Images are `linux/amd64` only. Adding `platforms: linux/amd64,linux/arm64` to the build
step covers a Pi, at the cost of an emulated `npm ci` on every release.

## Live location and events

Trip payloads carry no coordinates, so a trip's start and end have to be recovered from
position fixes recorded around it. Two sources feed that:

- **`rcs/rfc/findMyCar`** — a real fix, fetched when we ask. Stored in `vehicle_positions`.
- **The cached status snapshot**, whose position is whatever the car last volunteered.
  There are far more of these, and they cost no rate-limit budget.

### The odometer is what ties a fix to a trip

Matching on time alone fails badly: fixes arrive at the car's own sync cadence, so a trip
that starts an hour after the last reading gets no start location even though the car
demonstrably never moved in between.

The odometer settles it. It is monotonic and appears in both the trip row and every status
snapshot, so a fix taken at the same odometer as a trip boundary was taken while the car
sat at that boundary — however long before or after. That is not an approximation; it is
exact, and it survives arbitrarily long gaps in polling. `/api/trips/:id` reports
`basis: "odometer"` for such a fix, and the UI labels it *parked here*.

Time-nearness (90 minutes) remains only as the fallback for a fix with no usable odometer,
reported as `basis: "time"`. A fix whose odometer *disagrees* is rejected outright rather
than demoted — the car is known to have moved in between, so it is not that endpoint.

Two guards keep the proof honest, both in `server/src/trip-location.ts`:

- **An odometer is only recorded with a fix when the car was standing still.** A cached
  status from a moving car pairs a fresh position with an odometer from however far back it
  last synced; storing that would let a mid-route fix pose as an endpoint.
- **The neighbouring trip bounds the search.** Trip distances are whole miles and snapshot
  odometers are whole miles, so the comparison needs about a mile of slack — enough that a
  sub-mile errand could otherwise be mistaken for its neighbour.

### There is no push notification, and there cannot be

The Bluelink USA API has no webhook, no push channel, no MQTT and no long-poll — the
[reference implementation](https://github.com/Hyundai-Kia-Connect/hyundai_kia_connect_api)
contains no such mechanism for any region. "The car started" can therefore only be observed
*after the fact*, by noticing that a field changed between two polls. That is what
`vehicle_events` records:

| Event | Inferred from |
|---|---|
| `engine_on` / `engine_off` | `vehicleStatus.engine` flipping |
| `moved` | The odometer increasing |
| `charge_start` / `charge_stop` | `evStatus.batteryCharge` flipping |
| `plugged_in` / `unplugged` | `evStatus.batteryPlugin` changing |

Two limits are inherent, not bugs:

1. **Latency is set by the car, not by `POLL_INTERVAL_MINUTES`.** Cached status only changes
   once the car has synced, so an `engine_on` can surface minutes late. `observed_at` is
   when it happened; `detected_at` is when we noticed.
2. **Short trips can be missed.** If the car starts and stops between two syncs, no field
   ever differs. `moved` is the backstop — the odometer is cumulative, so mileage is never
   lost even when the engine transition is.

Getting lower latency would mean setting the `refresh` header to wake the car's modem on a
schedule, which drains the 12V battery. This project deliberately never does that.

### Why location fetching is throttled

`findMyCar` is rate limited. It refuses with HTTP 200 and a body carrying
`errorCode: 502` / `errorSubCode: HT_534`, so the refusal has to be detected after parsing.

A call is only spent when it can tell us something new: the engine is running, or the
odometer has moved since the last fix. A parked car's position cannot have changed, so
asking is waste. On a refusal the poller backs off exponentially from
`LOCATION_BACKOFF_MINUTES`, capped at `LOCATION_BACKOFF_MAX_MINUTES`.

**That budget lives in the database** (`location_fetch_state`), not in memory. In memory it
would reset on every container restart, and a crash-looping poller would hammer the
endpoint. Every decision is recorded on the `poll_runs` row as `location_status`, so
`fetched` / `skipped_no_movement` / `rate_limited` is visible without reading logs.

None of this can fail a poll. A skipped, refused or failed fix leaves the trip archive —
the thing this project exists for — completely untouched.

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
- **`findMyCar` reports rate limiting as an HTTP 200.** The refusal is in the body
  (`errorCode: 502` / `errorSubCode: HT_534`), so it can only be caught after parsing —
  see `isRateLimitBody` and `HyundaiRateLimitError`. Do not put this endpoint on a timer.
- **`findMyCar`'s `time` field arrives in several shapes, and what separates them is
  whether they name a zone.** `"2026-08-17T23:01:38Z"` (what the live endpoint sends, and
  the same shape as `vehicleStatus.dateTime`) and `"Tue, 24 Jun 2025 16:18:10 GMT"` are
  real instants; a compact `"20250624161810"` carries no zone and is resolved with
  `VEHICLE_TZ` like a trip's `startdate`. Confusing the two directions shifts a fix by the
  whole vehicle offset — wrong in a way that still looks plausible on a map, but far enough
  to detach the fix from the trip it belongs to. `reported_at_raw` keeps the original so a
  mis-resolution stays recoverable, which is how migration 005 repairs the fixes stored
  before this was handled correctly.
- **Transition detection needs the previous snapshot read *before* the new one is inserted**,
  or it diffs against itself. See the ordering in `poll.ts`.
- A field going from `null` to a value is a first reading, not a transition. Emitting an
  event there would invent one every time the backend starts reporting a new field.
- `vehicle_positions` and `vehicle_events` both use `UNIQUE NULLS NOT DISTINCT` (Postgres
  15+) so that rows with a missing timestamp still dedupe instead of accumulating a copy
  on every poll.

## Not included

Backfilling lost trips, GPS routes, and authentication on the web UI — it assumes a
trusted network.

**On trip locations.** Hyundai's `evTripDetails` returns no coordinates whatsoever — the
14 fields are distance, odometer, speeds, duration, the energy breakdown and a timestamp.
`findMyCar` only ever answers "where is the car now"; there is no history endpoint anywhere
in the API, and no route data of any kind. So a trip's endpoints can only come from
positions this project recorded while it was running — trips that predate the archive, or
that happened while the poller was down, have no locations and never will. Everything
locations depend on is described under [the odometer is what ties a fix to a
trip](#the-odometer-is-what-ties-a-fix-to-a-trip); the practical consequence is that
uptime, not `POLL_INTERVAL_MINUTES`, is what fills them in.
