/**
 * Integration tests for the HTTP layer, run against a throwaway local server.
 *
 * The point of these is to prove that the headers the Hyundai backend insists on —
 * particularly Host, Connection and Accept-Encoding, which the global `fetch`
 * silently rewrites — actually reach the wire as written.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { HyundaiApiError, HyundaiClient } from '../src/hyundai/client.ts';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Recorded[] = [];
/** Queue of [statusCode, body] responses to hand back, in order. */
let responses: Array<[number, unknown]> = [];
/** When set, the server gzips every response — mimicking what Hyundai actually does. */
let gzipResponses = false;

before(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const [status, payload] = responses.shift() ?? [200, {}];
      const json = JSON.stringify(payload);

      if (gzipResponses) {
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        });
        response.end(gzipSync(Buffer.from(json, 'utf8')));
      } else {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(json);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  received = [];
  responses = [];
  gzipResponses = false;
});

function makeClient() {
  return new HyundaiClient({
    username: 'me@example.com',
    password: 'hunter2',
    pin: '1234',
    utcOffset: '-5',
    baseUrl,
  });
}

const LOGIN_OK: [number, unknown] = [
  200,
  { access_token: 'tok-1', refresh_token: 'ref-1', expires_in: '3600' },
];

const VEHICLE = {
  vin: 'KM8KRDAF4PU123456',
  regId: 'REG1',
  nickname: 'Ioniq 5',
  generation: 2,
  fuelType: 'electric' as const,
  odometerMiles: 100,
};

test('login posts credentials with the app identity headers intact', async () => {
  responses = [LOGIN_OK];
  const token = await makeClient().login();

  assert.equal(token.accessToken, 'tok-1');

  const [request] = received;
  assert.ok(request);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/v2/ac/oauth/token');
  assert.deepEqual(JSON.parse(request.body), {
    username: 'me@example.com',
    password: 'hunter2',
  });

  // These are the headers undici's global fetch would have mangled.
  assert.equal(request.headers.host, 'api.telematics.hyundaiusa.com');
  assert.equal(request.headers['accept-encoding'], 'gzip, deflate, br');
  // undici normalises the Connection value's case; the token itself is
  // case-insensitive in HTTP, so this still matches what okhttp sends.
  assert.equal(String(request.headers.connection).toLowerCase(), 'keep-alive');
  assert.equal(request.headers['user-agent'], 'okhttp/3.12.0');
  assert.equal(request.headers.client_id, 'm66129Bb-em93-SPAHYN-bZ91-am4540zp19920');
  assert.equal(request.headers.clientsecret, 'v558o935-6nne-423i-baa8');
});

test('fetchTrips logs in first and sends the token under all three header names', async () => {
  responses = [LOGIN_OK, [200, { tripdetails: [] }]];

  const trips = await makeClient().fetchTrips(VEHICLE);
  assert.deepEqual(trips, []);

  assert.equal(received.length, 2, 'one login, one trip request');
  const tripRequest = received[1];
  assert.ok(tripRequest);
  assert.equal(tripRequest.method, 'GET');
  assert.equal(tripRequest.url, '/ac/v2/ts/alerts/maintenance/evTripDetails');

  // This endpoint is the odd one out: it wants the token three ways.
  assert.equal(tripRequest.headers.accesstoken, 'tok-1');
  assert.equal(tripRequest.headers.access_token, 'tok-1');
  assert.equal(tripRequest.headers.userid, 'me@example.com');

  assert.equal(tripRequest.headers.vin, VEHICLE.vin);
  assert.equal(tripRequest.headers['appcloud-vin'], VEHICLE.vin);
  assert.equal(tripRequest.headers.registrationid, 'REG1');
  assert.equal(tripRequest.headers.gen, '2');
  assert.equal(tripRequest.headers.bluelinkservicepin, '1234');
  assert.equal(tripRequest.headers.brandindicator, 'H');
  assert.match(String(tripRequest.headers.payloadgenerated), /^\d{14}$/);
});

test('the status poll never asks the backend to wake the car', async () => {
  responses = [LOGIN_OK, [200, { vehicleStatus: { dateTime: '2026-08-17T14:05:11Z' } }]];

  await makeClient().fetchStatus(VEHICLE);

  const statusRequest = received[1];
  assert.ok(statusRequest);
  assert.equal(statusRequest.url, '/ac/v2/rcs/rvs/vehicleStatus');
  assert.equal(statusRequest.headers.refresh, 'false');
});

test('a cached token is reused instead of logging in on every call', async () => {
  responses = [LOGIN_OK, [200, { tripdetails: [] }], [200, { tripdetails: [] }]];

  const client = makeClient();
  await client.fetchTrips(VEHICLE);
  await client.fetchTrips(VEHICLE);

  assert.equal(received.length, 3, 'one login followed by two trip calls');
  assert.equal(received[0]?.url, '/v2/ac/oauth/token');
});

test('a 401 triggers exactly one re-login and retry', async () => {
  responses = [
    LOGIN_OK,
    [401, { error: 'token expired' }],
    [200, { access_token: 'tok-2', refresh_token: 'ref-2', expires_in: '3600' }],
    [200, { tripdetails: [] }],
  ];

  const trips = await makeClient().fetchTrips(VEHICLE);
  assert.deepEqual(trips, []);

  assert.equal(received.length, 4);
  assert.equal(received[2]?.url, '/v2/ac/oauth/token', 'should have logged in again');
  assert.equal(received[3]?.headers.accesstoken, 'tok-2', 'retry should use the fresh token');
});

test('a 500 surfaces as a HyundaiApiError without retrying', async () => {
  responses = [LOGIN_OK, [500, { error: 'upstream exploded' }]];

  await assert.rejects(
    () => makeClient().fetchTrips(VEHICLE),
    (error: unknown) => {
      assert.ok(error instanceof HyundaiApiError);
      assert.equal(error.statusCode, 500);
      assert.match(error.body, /upstream exploded/);
      return true;
    },
  );

  assert.equal(received.length, 2, 'a 500 must not trigger a re-login loop');
});

test('a gzipped response body is decompressed before parsing', async () => {
  // We advertise Accept-Encoding: gzip, so the real backend is free to compress.
  // undici hands back raw bytes — if this regresses, every call fails as non-JSON.
  gzipResponses = true;
  responses = [
    LOGIN_OK,
    [
      200,
      {
        tripdetails: [
          {
            startdate: '2026-08-16 14:32:07.0',
            distance: 18,
            odometer: { value: 12482.4, unit: 3 },
            duration: { value: 1834 },
            totalused: 5120,
          },
        ],
      },
    ],
  ];

  const trips = await makeClient().fetchTrips(VEHICLE);

  assert.equal(trips.length, 1);
  assert.equal(trips[0]?.startDateRaw, '2026-08-16 14:32:07.0');
  assert.equal(trips[0]?.distanceMiles, 18);
});

test('fetchVehicles maps the enrollment payload', async () => {
  responses = [
    LOGIN_OK,
    [
      200,
      {
        enrolledVehicleDetails: [
          {
            vehicleDetails: {
              vin: VEHICLE.vin,
              regid: 'REG1',
              nickName: 'Ioniq 5',
              evStatus: 'E',
              vehicleGeneration: '2',
              odometer: '12482.4',
            },
          },
        ],
      },
    ],
  ];

  const vehicles = await makeClient().fetchVehicles();

  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0]?.vin, VEHICLE.vin);
  // The username goes in raw — percent-encoding the `@` makes Hyundai answer 502.
  assert.equal(received[1]?.url, '/ac/v2/enrollment/details/me@example.com');
});
