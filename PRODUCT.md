# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the owner running their own archive.** One person, running the stack on their
own hardware, looking at their own car. They already have Bluelink credentials configured
and the poller running; they are not being onboarded, they are checking in. They open the
page two ways, both primary:

- **Desktop browser at a desk**, often with a terminal alongside. Wide viewport, sitting
  down, willing to read a dense table.
- **Phone, away from the desk** — in the driveway, at a charger, out somewhere. Narrow
  viewport is a first-class target, not a fallback.

**Secondary: other Bluelink USA owners self-hosting.** The repository is public and a
container image is published to GHCR, so other people do stand this up. First-run states,
an empty archive, an unconfigured poller, and more than one enrolled vehicle are real and
must be handled correctly — but they never lead the design.

## Product Purpose

Bluelink only ever exposes the **last ~4 trips**, with no pagination and no history
endpoint. This polls that same endpoint on a schedule and archives every trip permanently
in Postgres, then serves the accumulated archive as a read-only web page.

The job the primary user comes to do is **understand how the car is doing over time** —
efficiency, distance and energy across a chosen window. The range filter, the totals and
the trip table are the spine of the page; live status is context around them.

Success is that the archive keeps growing without gaps, and that the owner can read trends
across it that Hyundai's own app structurally cannot show. History accumulates only from
the day the poller starts; trips Hyundai has already dropped are gone, and there is no
backfill.

## Positioning

Every claim here is a mechanism in the code, not a slogan — a neighboring product could
not truthfully copy any of them without building the same thing:

- **Permanence past Hyundai's 4-trip window.** `(vin, start_date_raw)` is the dedupe key,
  stored exactly as Hyundai sends it. Re-polling refreshes an existing trip's metrics and
  preserves `first_seen_at`; the table only ever grows.
- **Trip locations proved by odometer, not guessed by time.** The odometer is monotonic
  and appears in both the trip row and every status snapshot, so a fix at a boundary's
  odometer was taken while the car sat there — exact, however stale. Time-nearness is only
  a fallback, and a disagreeing odometer rejects a fix outright.
- **Coordinates never leave the machine.** Reverse geocoding is a local spatial query
  against a GeoNames table in the same Postgres. No geocoding service, no API key, no
  rate limit, and nothing about where you park is sent anywhere.
- **It never wakes the car.** Status is always fetched with `refresh: false`. Lower event
  latency would mean waking the modem on a schedule and draining the 12V battery; the
  project deliberately refuses that trade.

Unofficial and unaffiliated with Hyundai. Requires an active Bluelink subscription.

## Operating Context

- **The poller runs continuously**, every 15 minutes by default, in a containerized stack
  (podman-compose locally; a Flux/CNPG deployment on k3s also exists). It does not restart
  on its own after a reboot, and **downtime loses trips permanently** — if 5 trips happen
  between two polls, the oldest falls out of Hyundai's window and is gone.
- **The car sets the cadence, not the poller.** Status is served from Hyundai's cache and
  only changes once the car has synced, so "right now" on this page is always somewhat
  stale, and by an amount that varies.
- **Everything is on one port.** The Fastify API serves the built frontend, so the API and
  the page are the same origin at `:3000`.
- **No authentication.** The UI assumes a trusted network. This is a deliberate exclusion,
  not a gap to design around.
- **Read-only, with one exception.** Every endpoint is a view over the archive apart from
  `POST /api/poll`, which triggers a poll immediately.
- **Place names are an optional one-off.** Until `npm run geonames:load` is run, locations
  render as coordinates and still link to a map; only the names are missing. That is a
  normal state, not an error.
- **Units are US.** Miles, kWh, mi/kWh. Trip timestamps arrive with no timezone and are
  resolved against a configured vehicle timezone.

## Capabilities and Constraints

**What the page does today**

- Trip list: date, distance, duration, kWh used, mi/kWh; sortable; a row opens the full
  record.
- Trip detail: speeds, the per-system energy breakdown, moving vs. stopped time, start and
  end locations where they can be established, and the raw payload.
- Range filter over 12h / 1d / 5d / 1w / month, or an exact custom start and end with
  either end left open. It filters on when a trip **started**, and governs both the trip
  list and the totals — and deliberately nothing above it.
- Summary tiles for the selected window; a separate archive-wide "archiving since" line
  that ignores the filter.
- Live panel: latest status snapshot and latest position fix, labelled with how stale it
  is and whether the fix came from GPS or a cached status.
- Event timeline: engine on/off, moved, charge start/stop, plugged/unplugged, each with
  when it happened versus when it was noticed.
- Poll banner: last poll's outcome, trips seen and inserted, and location-subsystem state.
- Vehicle selector, shown only when more than one vehicle is enrolled.

**What the API cannot provide, ever**

- **No route data of any kind.** `evTripDetails` returns 14 fields — distance, odometer,
  speeds, duration, energy breakdown, timestamp — and no coordinates. There is no history
  endpoint. Trip endpoints can only come from fixes recorded while the poller was running,
  so trips predating the archive have no locations and never will. Do not design a map
  route, a path, or a trace.
- **No push channel.** No webhook, no MQTT, no long-poll. Every event is inferred after
  the fact by diffing consecutive snapshots, so a short trip between two syncs can be
  missed entirely; the odometer is the backstop that keeps mileage from being lost.
- **`findMyCar` is rate limited**, and refuses inside an HTTP 200 body. The poller backs
  off exponentially and persists that budget in the database. A throttled or refused fix
  must never fail a poll or disturb the trip archive.

**Terminology as the product uses it**

trip · poll run · fix / position · event · *observed at* (when it happened) vs. *detected
at* (when we noticed) · basis **odometer** (exact, shown as "parked here") vs. basis
**time** (a fallback guess) · the *archive*.

**Not included, deliberately:** backfilling lost trips, GPS routes, and authentication.

## Brand Commitments

- Name: **Hyundai Trip Tracker**.
- **Unaffiliated with Hyundai, and it must stay visibly so.** No Hyundai marks, logos,
  Bluelink branding, or styling that could read as an official or endorsed client.
- Voice, as established by the README: precise, plain, unhedged, and it explains *why*. It
  states limits directly instead of softening them, and it distinguishes an inherent limit
  from a bug. Never oversells.

## Evidence on Hand

- A real, live, continuously growing archive in Postgres — genuine trips, positions,
  events and poll runs. Any design work can and should use real data.
- `README.md` — thorough and accurate, including the reasoning behind every constraint.
- `docs/migrating-to-kubernetes.md` — the dump-and-restore runbook.
- The published container image at `ghcr.io/henryjarend/hyundai-trip-tracker`.

**Absent — do not fabricate:** testimonials, other named users, adoption numbers,
benchmarks, pricing, comparisons to other trackers, screenshots, or any route/map imagery
the API cannot produce.

## Product Principles

1. **The archive is the product; nothing may endanger it.** Locations, events and live
   status are all decoration around it. When they fail they degrade quietly and the trip
   table still renders.
2. **Say how stale the truth is.** Every reading comes from a car that syncs on its own
   schedule. A timestamp without its lag is a claim the data cannot support.
3. **Never imply certainty the API cannot give.** An odometer-proved location and a
   time-guessed one are different things and must read differently; so must "it happened"
   and "we noticed".
4. **Silence must never look like success.** A failing poller and an empty archive look
   identical in the data. Making that distinction visible is a core job of the page, not
   an error state bolted on.
5. **Trends over instants.** The daily reason to open this is the shape of the car's
   behavior across a window — not the last five minutes.
