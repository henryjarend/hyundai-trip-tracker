import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseLoginResponse,
  parseTripsResponse,
  parseTripsResponseDetailed,
  parseVehiclesResponse,
  parseVehicleStatusResponse,
} from '../src/hyundai/parse.ts';
import { authorizedHeaders, payloadTimestamp } from '../src/hyundai/headers.ts';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), 'utf8'));
}

test('parseLoginResponse handles expires_in arriving as a string', () => {
  const token = parseLoginResponse({
    access_token: 'abc',
    refresh_token: 'def',
    expires_in: '3600',
  });

  assert.equal(token.accessToken, 'abc');
  assert.equal(token.refreshToken, 'def');
  // Roughly an hour out, allowing for test execution time.
  const secondsOut = (token.expiresAt - Date.now()) / 1000;
  assert.ok(secondsOut > 3590 && secondsOut <= 3600, `expected ~3600s, got ${secondsOut}`);
});

test('parseLoginResponse rejects a response missing a token', () => {
  assert.throws(() => parseLoginResponse({ access_token: 'abc' }), /Invalid login response/);
});

test('parseVehiclesResponse maps an EV and skips entries with no VIN', () => {
  const vehicles = parseVehiclesResponse(fixture('vehicles.json'));

  assert.equal(vehicles.length, 1);
  assert.deepEqual(vehicles[0], {
    vin: 'KM8KRDAF4PU123456',
    regId: 'REG0000000000000001',
    nickname: 'Ioniq 5',
    generation: 2,
    fuelType: 'electric',
    odometerMiles: 12482.4,
  });
});

test('parseTripsResponse parses trips and skips the unparseable one', () => {
  const trips = parseTripsResponse(fixture('trips.json'));

  assert.equal(trips.length, 3, 'the malformed-date entry should be dropped');

  const [first] = trips;
  assert.ok(first);
  // The raw string is the dedupe key and must survive untouched.
  assert.equal(first.startDateRaw, '2026-08-16 14:32:07.0');
  assert.equal(first.startDateLocal, '2026-08-16T14:32:07');
  assert.equal(first.durationSeconds, 1834);
  assert.equal(first.distance, 18);
  assert.equal(first.distanceMiles, 18, 'unit 3 is miles, so no conversion');
  assert.equal(first.odometerMiles, 12482.4);
  assert.equal(first.energyTotalWh, 5120);
  assert.equal(first.energyRegenWh, 940);
  assert.equal(first.energyBatteryCareWh, 120);
});

test('parseTripsResponse reads mileagetime as drive time, and tolerates its absence', () => {
  const [withIt] = parseTripsResponse({
    tripdetails: [
      {
        startdate: '2026-08-17 13:14:31.0',
        distance: 0,
        odometer: { value: 2637.4092 },
        duration: { unit: 3, value: 74 },
        mileagetime: { unit: 3, value: 65 },
        totalused: 30,
      },
    ],
  });
  assert.ok(withIt);
  assert.equal(withIt.durationSeconds, 74);
  assert.equal(withIt.driveTimeSeconds, 65, 'time actually moving');
  // This account's payload omits odometer.unit entirely; the miles default applies.
  assert.equal(withIt.distanceUnit, 3);

  const [without] = parseTripsResponse({
    tripdetails: [
      { startdate: '2026-08-17 13:14:31.0', distance: 5, duration: { value: 100 }, totalused: 900 },
    ],
  });
  assert.ok(without);
  assert.equal(without.driveTimeSeconds, null);
});

test('parseTripsResponse converts kilometre-unit trips to miles', () => {
  const trips = parseTripsResponse({
    tripdetails: [
      {
        startdate: '2026-08-16 14:32:07.0',
        distance: 100,
        odometer: { value: 20000, unit: 1 },
        duration: { value: 3600 },
        totalused: 15000,
      },
    ],
  });

  const [trip] = trips;
  assert.ok(trip);
  assert.equal(trip.distance, 100, 'the reported value is stored as-is');
  assert.equal(trip.distanceUnit, 1);
  assert.ok(Math.abs(trip.distanceMiles - 62.1371) < 0.001);
  assert.ok(Math.abs((trip.odometerMiles ?? 0) - 12427.42) < 0.01);
});

test('parseTripsResponse keeps a zero-energy trip without dividing by zero', () => {
  const trips = parseTripsResponse(fixture('trips.json'));
  const zeroEnergy = trips.find((t) => t.energyTotalWh === 0);
  assert.ok(zeroEnergy, 'the 0 Wh trip should still be stored');
  assert.equal(zeroEnergy.distanceMiles, 5);
});

test('parseTripsResponse rejects a payload with no tripdetails array', () => {
  assert.throws(() => parseTripsResponse({ error: 'nope' }), /tripdetails missing/);
});

test('the thrown message names the keys actually present, to aid diagnosis', () => {
  assert.throws(
    () => parseTripsResponse({ trips: [], status: 'ok' }),
    /Top-level keys: trips, status/,
  );
});

test('parseTripsResponseDetailed explains every entry it drops', () => {
  const { trips, skipped } = parseTripsResponseDetailed({
    tripdetails: [
      { startdate: '2026-08-16 14:32:07.0', distance: 10, totalused: 3000 },
      { startdate: 'not-a-date', distance: 1, totalused: 1 },
      { startdate: '2026-08-16 09:00:00.0', distance: 5 },
      { nothing: true },
    ],
  });

  assert.equal(trips.length, 1);
  assert.equal(skipped.length, 3);
  assert.match(skipped[0] ?? '', /unrecognised startdate format "not-a-date"/);
  // The reason names the missing field and lists what was present, so an
  // unexpected payload shape can be diagnosed from the log alone.
  assert.match(skipped[1] ?? '', /missing totalused/);
  assert.match(skipped[1] ?? '', /keys: startdate, distance/);
  assert.match(skipped[2] ?? '', /startdate missing/);
});

test('parseVehicleStatusResponse extracts SoC, range, charging and location', () => {
  const status = parseVehicleStatusResponse(fixture('status.json'));

  assert.equal(status.syncedAt, '2026-08-17T14:05:11.000Z');
  assert.equal(status.socPercent, 64);
  assert.equal(status.evRangeMiles, 182);
  assert.equal(status.charging, true);
  assert.equal(status.plugType, 'ac');
  assert.equal(status.chargePower, 10.5);
  assert.equal(status.odometerMiles, 12482.4);
  assert.equal(status.latitude, 36.1627);
  assert.equal(status.longitude, -86.7816);
  assert.equal(status.locked, true);
  assert.equal(status.battery12v, 87);
});

test('parseVehicleStatusResponse tolerates a sparse payload', () => {
  const status = parseVehicleStatusResponse({ vehicleStatus: {} });

  assert.equal(status.syncedAt, null);
  assert.equal(status.socPercent, null);
  assert.equal(status.charging, null);
  assert.equal(status.plugType, 'unknown');
});

test('payloadTimestamp formats as yyyyMMddHHmmss in local time', () => {
  assert.equal(payloadTimestamp(new Date(2026, 7, 17, 9, 5, 3)), '20260817090503');
});

test('authorizedHeaders sends the full set the backend expects', () => {
  const headers = authorizedHeaders({
    authToken: { accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 1000 },
    username: 'me@example.com',
    pin: '1234',
    utcOffset: '-5',
    vehicle: {
      vin: 'KM8KRDAF4PU123456',
      regId: 'REG1',
      nickname: 'Ioniq 5',
      generation: 2,
      fuelType: 'electric',
      odometerMiles: 1,
    },
  });

  assert.equal(headers.accessToken, 'tok');
  assert.equal(headers.brandIndicator, 'H');
  assert.equal(headers.Host, 'api.telematics.hyundaiusa.com');
  assert.equal(headers['User-Agent'], 'okhttp/3.12.0');
  assert.equal(headers.offset, '-5');
  assert.equal(headers.gen, '2');
  assert.equal(headers.registrationId, 'REG1');
  assert.equal(headers['APPCLOUD-VIN'], 'KM8KRDAF4PU123456');
  // Never poll with refresh=true — it wakes the car's modem.
  assert.equal(headers.refresh, 'false');
});
