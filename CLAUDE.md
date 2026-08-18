# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Polls the Hyundai Bluelink USA API (which only ever exposes the last ~4 trips) and archives every trip in Postgres, with a read-only Fastify API and React frontend over the archive. The README is thorough and accurate — especially "Notes for future maintenance" — read it for anything not covered here.

## Commands

Containerized stack (Postgres + API + poller, via podman-compose):

```bash
npm run stack:up       # tear down, rebuild, start — serves everything on :3000
npm run stack:down
npm run stack:logs     # follow the poller
npm run stack:status   # last 5 poll runs from the database
```

`CONTAINER_CONNECTION=podman-machine-default-root` must be exported (it is in `~/.bashrc`) — otherwise `podman`/`podman-compose` address a different WSL engine than Podman Desktop and appear to show nothing. `stack:up` deliberately runs `down` first; podman-compose cannot replace stopped containers holding the same names.

Directly (needs `DATABASE_URL` reachable; `.env` holds Bluelink credentials):

```bash
npm run migrate               # apply db/migrations/*.sql (forward-only, filename order)
npm run poll:once -- --dry-run  # hit the real API, print parsed output, write nothing
npm run poll:once             # one real poll
npm run api                   # API + built frontend on :3000
npm run dev:web               # Vite dev server on :5173, proxies /api to :3000
```

Tests and checks (no credentials or database needed; geocoding tests skip when GeoNames isn't loaded):

```bash
npm test                                    # server workspace, node --test
cd server && node --test test/parse.test.ts # one file
cd server && node --test --test-name-pattern 'dedupe' 'test/**/*.test.ts'
npm run typecheck                           # tsc --noEmit in both workspaces
```

There is no build step for the server: Node ≥ 26 runs the TypeScript sources directly via native type stripping (the Docker image does the same). Only `web/` is compiled, by Vite.

## Architecture

npm workspaces: `server/` (poller + API + Hyundai client) and `web/` (React 19 + Vite). Raw SQL migrations live in `db/migrations/`.

Data flow: `server/src/ingest/index.ts` (long-running poller) → `hyundai/client.ts` logs into Bluelink and fetches trips/status → `hyundai/parse.ts` normalizes → `db/repo.ts` upserts. The API (`api/server.ts` + `api/routes.ts`) is a read-only view over those tables and also serves the built frontend, so everything is on one port. Every poll — success or failure — writes a `poll_runs` row; the UI surfaces failures as a banner.

Both the API and the poller run migrations on boot; `db/migrate.ts` serializes them with a Postgres advisory lock and records applied files in `schema_migrations`.

Events (`ingest/transitions.ts`) are inferred by diffing consecutive status snapshots — there is no push channel in the Bluelink API, so engine on/off, moved, charge, and plug events can only be noticed after the fact. Location fetching (`ingest/location-policy.ts`) is budgeted: `findMyCar` refuses with `HT_534` inside an HTTP 200 body, backoff state is persisted in the database (`location_fetch_state`) so restarts don't reset it, and every decision lands on `poll_runs.location_status`. Location failures must never fail a poll.

Trip start/end locations (`trip-location.ts`, pure and unit-tested) are matched to recorded fixes by **odometer**, not by time-nearness: the odometer is monotonic and appears in both the trip row and every status snapshot, so a fix at the boundary's odometer was taken while the car sat there, however stale. Time-nearness is only the fallback for a fix with no odometer, and a disagreeing odometer rejects a fix outright. This only holds because an odometer is stored with a fix *only when the car was standing still* — a moving car's cached status pairs a fresh position with a stale odometer, which would let a mid-route fix pose as an endpoint.

## Invariants — do not break these

- **`(vin, start_date_raw)` is the dedupe key**, stored exactly as Hyundai sends it. The whole design rests on it: polling twice must leave `count(*) from trips` unchanged (second run reports `trips_inserted = 0`). `first_seen_at` is preserved on update.
- **Do not switch `hyundai/client.ts` from `undici.request()` to global `fetch`** — fetch rewrites `Host`/`Connection`/`Accept-Encoding` headers the backend requires; gzip is decompressed by hand because undici doesn't.
- **Never wake the car's modem**: status is always fetched with `refresh: false`. Changing that drains the 12V battery.
- Trip and status rows keep the original payload in a `raw` jsonb column so unparsed fields stay recoverable — keep doing that for new ingest paths.
- Postgres 18+ images mount the data volume at `/var/lib/postgresql` (not `.../data`); the old path makes the container refuse to start.
