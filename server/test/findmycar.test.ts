import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRateLimitBody, parseFindMyCarResponse } from '../src/hyundai/parse.ts';

test('parses a fix with an RFC-1123 GMT timestamp as a real instant', () => {
  const position = parseFindMyCarResponse({
    coord: { lat: 43.1234, lon: -85.5678, alt: 231.5, type: 0 },
    time: 'Tue, 24 Jun 2025 16:18:10 GMT',
  });

  assert.ok(position);
  assert.equal(position.latitude, 43.1234);
  assert.equal(position.longitude, -85.5678);
  assert.equal(position.altitude, 231.5);
  assert.equal(position.reportedAt, '2025-06-24T16:18:10.000Z');
  assert.equal(position.reportedAtLocal, null);
  assert.equal(position.reportedAtRaw, 'Tue, 24 Jun 2025 16:18:10 GMT');
});

test('treats a compact timestamp as zone-less, not as UTC', () => {
  // Reading this as UTC would shift every fix by the vehicle's offset — plausible
  // on a map and easy to never notice. It is resolved with VEHICLE_TZ at ingest.
  const position = parseFindMyCarResponse({
    coord: { lat: 43.1, lon: -85.5 },
    time: '20250624161810',
  });

  assert.ok(position);
  assert.equal(position.reportedAt, null);
  assert.equal(position.reportedAtLocal, '2025-06-24T16:18:10');
});

test('accepts the separated variant of the compact timestamp', () => {
  const position = parseFindMyCarResponse({
    coord: { lat: 43.1, lon: -85.5 },
    time: '2025-06-24T16:18:10Z',
  });

  assert.ok(position);
  assert.equal(position.reportedAtLocal, '2025-06-24T16:18:10');
});

test('returns a fix with no timestamp rather than dropping it', () => {
  const position = parseFindMyCarResponse({ coord: { lat: 43.1, lon: -85.5 } });

  assert.ok(position);
  assert.equal(position.reportedAt, null);
  assert.equal(position.reportedAtLocal, null);
  assert.equal(position.reportedAtRaw, null);
});

test('returns null when the response carries no coord', () => {
  assert.equal(parseFindMyCarResponse({ errorCode: 0 }), null);
  assert.equal(parseFindMyCarResponse({}), null);
  assert.equal(parseFindMyCarResponse(null), null);
});

test('rejects the (0, 0) no-fix answer', () => {
  // The backend reports "no idea" as the origin, which is in the Gulf of Guinea.
  assert.equal(parseFindMyCarResponse({ coord: { lat: 0, lon: 0 } }), null);
});

test('parses coordinates delivered as strings', () => {
  const position = parseFindMyCarResponse({ coord: { lat: '43.1', lon: '-85.5' } });
  assert.ok(position);
  assert.equal(position.latitude, 43.1);
  assert.equal(position.longitude, -85.5);
});

test('detects the in-band rate limit refusal', () => {
  // HT_534 arrives as an HTTP 200 whose body says no.
  assert.equal(isRateLimitBody({ errorCode: 502, errorSubCode: 'HT_534' }), true);
  assert.equal(isRateLimitBody({ errorCode: '502', errorSubCode: 'HT_534' }), true);
});

test('does not mistake other errors for rate limiting', () => {
  assert.equal(isRateLimitBody({ errorCode: 502, errorSubCode: 'HT_500' }), false);
  assert.equal(isRateLimitBody({ errorCode: 400, errorSubCode: 'HT_534' }), false);
  assert.equal(isRateLimitBody({ coord: { lat: 43.1, lon: -85.5 } }), false);
  assert.equal(isRateLimitBody(null), false);
});
