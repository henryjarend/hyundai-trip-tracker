/**
 * Header construction, ported 1:1 from BetterBlueKit's
 * Sources/BetterBlueKit/API/HyundaiUSA/HyundaiUSAAPIClient.swift (headers() and
 * authorizedHeaders()). The Hyundai backend is fussy about these — it rejects
 * requests that look nothing like the MyHyundai Android app, which is why the
 * User-Agent claims to be okhttp and why every one of these is sent verbatim.
 */
import type { AuthToken, Vehicle } from './types.ts';

export const API_HOST = 'api.telematics.hyundaiusa.com';
export const BASE_URL = `https://${API_HOST}`;

const CLIENT_ID = 'm66129Bb-em93-SPAHYN-bZ91-am4540zp19920';
const CLIENT_SECRET = 'v558o935-6nne-423i-baa8';

export function baseHeaders(): Record<string, string> {
  return {
    client_id: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    Host: API_HOST,
    'User-Agent': 'okhttp/3.12.0',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    Connection: 'Keep-Alive',
  };
}

/** `payloadGenerated` is local wall-clock time formatted as yyyyMMddHHmmss. */
export function payloadTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export interface AuthorizedHeaderOptions {
  authToken: AuthToken;
  username: string;
  pin: string;
  utcOffset: string;
  vehicle?: Vehicle;
  /**
   * `refresh: true` makes the backend poll the car's modem instead of returning
   * its cached snapshot. We always send false — waking the modem on a schedule
   * drains the 12V battery, and trip data is server-side anyway.
   */
  refresh?: boolean;
  now?: Date;
}

export function authorizedHeaders(options: AuthorizedHeaderOptions): Record<string, string> {
  const { authToken, username, pin, utcOffset, vehicle, refresh = false, now } = options;

  const headers: Record<string, string> = {
    ...baseHeaders(),
    accessToken: authToken.accessToken,
    language: '0',
    to: 'ISS',
    encryptFlag: 'false',
    from: 'SPA',
    offset: utcOffset,
    brandIndicator: 'H',
    origin: BASE_URL,
    referer: `${BASE_URL}/login`,
    username,
    blueLinkServicePin: pin,
    refresh: refresh ? 'true' : 'false',
    payloadGenerated: payloadTimestamp(now),
    includeNonConnectedVehicles: 'Y',
  };

  if (vehicle) {
    headers.gen = String(vehicle.generation);
    headers.registrationId = vehicle.regId;
    headers.vin = vehicle.vin;
    headers['APPCLOUD-VIN'] = vehicle.vin;
  }

  return headers;
}

const SENSITIVE_HEADERS = new Set([
  'accesstoken',
  'access_token',
  'bluelinkservicepin',
  'clientsecret',
  'authorization',
]);

/** Mirrors BetterBlueKit's SensitiveDataRedactor — never log a token, PIN, or VIN. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      out[key] = '<redacted>';
    } else if (lower === 'vin' || lower === 'appcloud-vin' || lower === 'registrationid') {
      out[key] = `${value.slice(0, 4)}…${value.slice(-4)}`;
    } else if (lower === 'username') {
      out[key] = value.replace(/^(.).*(@.*)$/, '$1***$2');
    } else {
      out[key] = value;
    }
  }
  return out;
}
