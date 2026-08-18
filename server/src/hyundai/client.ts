/**
 * Hyundai USA (Bluelink) API client — a direct port of BetterBlueKit's
 * HyundaiUSAAPIClient.swift.
 *
 * Uses undici's `request()` rather than global `fetch` on purpose: `fetch` treats
 * Host / Connection / Accept-Encoding as managed headers and will strip or rewrite
 * them, and the Hyundai backend rejects requests that arrive without them. Do not
 * "simplify" this to fetch.
 */
import type { Transform } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { request } from 'undici';
import type { Dispatcher } from 'undici';
import { authorizedHeaders, baseHeaders, BASE_URL, redactHeaders } from './headers.ts';
import {
  parseLoginResponse,
  parseTripsResponseDetailed,
  parseVehiclesResponse,
  parseVehicleStatusResponse,
} from './parse.ts';
import type { AuthToken, Trip, Vehicle, VehicleStatusSnapshot } from './types.ts';

export interface ClientOptions {
  username: string;
  password: string;
  pin: string;
  utcOffset: string;
  debug?: boolean;
  /** Overridable so tests can point at a local server. Defaults to the real API. */
  baseUrl?: string;
}

export class HyundaiApiError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = 'HyundaiApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** Token is refreshed a minute early so a poll never starts with an about-to-expire one. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * We advertise `Accept-Encoding: gzip, deflate, br` because the real MyHyundai app
 * does and we match its fingerprint — but unlike Swift's URLSession, undici's
 * `request()` hands back the raw compressed bytes. Decompress explicitly, or every
 * gzipped response fails to parse as JSON.
 */
async function readBody(response: Dispatcher.ResponseData): Promise<string> {
  const encoding = String(response.headers['content-encoding'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();

  let decompressor: Transform | null = null;
  if (encoding === 'gzip' || encoding === 'x-gzip') decompressor = createGunzip();
  else if (encoding === 'deflate') decompressor = createInflate();
  else if (encoding === 'br') decompressor = createBrotliDecompress();

  if (decompressor === null) {
    return response.body.text();
  }

  const decoded = await buffer(response.body.pipe(decompressor));
  return decoded.toString('utf8');
}

export class HyundaiClient {
  readonly #options: ClientOptions;
  #token: AuthToken | null = null;

  constructor(options: ClientOptions) {
    this.#options = options;
  }

  async #send(
    path: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.#options.baseUrl ?? BASE_URL}${path}`;

    if (this.#options.debug) {
      console.log(`[http] ${method} ${path}`, redactHeaders(headers));
    }

    const response = await request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await readBody(response);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new HyundaiApiError(
        `${method} ${path} failed with HTTP ${response.statusCode}`,
        response.statusCode,
        text.slice(0, 2000),
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new HyundaiApiError(
        `${method} ${path} returned non-JSON body`,
        response.statusCode,
        text.slice(0, 2000),
      );
    }
  }

  async login(): Promise<AuthToken> {
    const body = await this.#send('/v2/ac/oauth/token', 'POST', baseHeaders(), {
      username: this.#options.username,
      password: this.#options.password,
    });
    this.#token = parseLoginResponse(body);
    return this.#token;
  }

  /** Returns a valid token, logging in if there isn't one or it has aged out. */
  async #authToken(): Promise<AuthToken> {
    if (this.#token && this.#token.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return this.#token;
    }
    return this.login();
  }

  #headersFor(authToken: AuthToken, vehicle?: Vehicle): Record<string, string> {
    return authorizedHeaders({
      authToken,
      username: this.#options.username,
      pin: this.#options.pin,
      utcOffset: this.#options.utcOffset,
      vehicle,
    });
  }

  /**
   * Runs an authorized call, and on a 401/403 discards the token, logs in again,
   * and retries exactly once. Bluelink tokens are sometimes invalidated server-side
   * well before `expires_in` claims.
   */
  async #withAuth<T>(fn: (authToken: AuthToken) => Promise<T>): Promise<T> {
    const token = await this.#authToken();
    try {
      return await fn(token);
    } catch (error) {
      const status = error instanceof HyundaiApiError ? error.statusCode : 0;
      if (status !== 401 && status !== 403) throw error;
      this.#token = null;
      return fn(await this.#authToken());
    }
  }

  async fetchVehicles(): Promise<Vehicle[]> {
    return this.#withAuth(async (token) => {
      // Interpolated raw, exactly as BetterBlueKit does. Percent-encoding the `@`
      // makes this endpoint answer 502 — `@` is legal in a path segment and the
      // backend evidently matches on the literal address.
      const path = `/ac/v2/enrollment/details/${this.#options.username}`;
      return parseVehiclesResponse(await this.#send(path, 'GET', this.#headersFor(token)));
    });
  }

  /**
   * The whole reason this project exists. Returns only the last ~4 trips — there is
   * no pagination, no date range, and no way to ask for more.
   */
  async fetchTrips(vehicle: Vehicle): Promise<Trip[]> {
    return this.#withAuth(async (token) => {
      const headers = this.#headersFor(token, vehicle);
      // This endpoint alone wants the token under two extra header names.
      headers.userId = this.#options.username;
      headers.access_token = token.accessToken;

      const body = await this.#send(
        '/ac/v2/ts/alerts/maintenance/evTripDetails',
        'GET',
        headers,
      );

      const { trips, skipped } = parseTripsResponseDetailed(body);
      // A dropped trip is invisible data loss — always say so.
      for (const reason of skipped) {
        console.warn(`  [trip skipped] ${reason}`);
      }
      if (trips.length === 0 && skipped.length === 0) {
        console.warn('  Hyundai returned an empty trip list (tripdetails: []).');
      }
      return trips;
    });
  }

  /** Cached status — `refresh` is false, so this does not wake the car's modem. */
  async fetchStatus(vehicle: Vehicle): Promise<VehicleStatusSnapshot> {
    return this.#withAuth(async (token) => {
      const body = await this.#send(
        '/ac/v2/rcs/rvs/vehicleStatus',
        'GET',
        this.#headersFor(token, vehicle),
      );
      return parseVehicleStatusResponse(body);
    });
  }
}
