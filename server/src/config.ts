/**
 * Environment configuration. Credentials are required only by the poller, so the
 * API server can boot without them — `requireCredentials()` is called by the
 * ingest entrypoints rather than at module load.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env if present. Real environment variables (e.g. those set
// by docker compose) always win — loadEnvFile does not overwrite them.
const dotenvPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(dotenvPath)) {
  process.loadEnvFile(dotenvPath);
}

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got: ${raw}`);
  return parsed;
}

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/hyundai'),
  pollIntervalMinutes: intEnv('POLL_INTERVAL_MINUTES', 15),
  /** Timezone the car reports trip timestamps in — they arrive with no zone attached. */
  vehicleTz: env('VEHICLE_TZ', 'America/Chicago'),
  /** The `offset` header value BetterBlue sends; should match your UTC offset in hours. */
  utcOffset: env('HYUNDAI_UTC_OFFSET', '-5'),
  port: intEnv('PORT', 3000),
  debugHttp: env('DEBUG_HTTP', '0') === '1',

  /**
   * findMyCar is rate limited, so location fetching is opt-out and heavily
   * throttled. Trips are never affected by any of this — a skipped or refused
   * position fetch is not a failed poll.
   */
  locationEnabled: env('LOCATION_ENABLED', '1') === '1',
  /** Floor between fixes while the car is idle. */
  locationIntervalMinutes: intEnv('LOCATION_INTERVAL_MINUTES', 60),
  /** Shorter floor while the engine is running — that is when position changes. */
  locationActiveIntervalMinutes: intEnv('LOCATION_ACTIVE_INTERVAL_MINUTES', 10),
  /** First backoff step after an HT_534 refusal; doubles per consecutive failure. */
  locationBackoffMinutes: intEnv('LOCATION_BACKOFF_MINUTES', 60),
  /** Ceiling for that doubling, so backoff cannot run away to days. */
  locationBackoffMaxMinutes: intEnv('LOCATION_BACKOFF_MAX_MINUTES', 720),
};

export interface Credentials {
  username: string;
  password: string;
  pin: string;
}

export function requireCredentials(): Credentials {
  return {
    username: env('HYUNDAI_USERNAME'),
    password: env('HYUNDAI_PASSWORD'),
    pin: env('HYUNDAI_PIN'),
  };
}
