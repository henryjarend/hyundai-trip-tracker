/**
 * Reverse geocoding is a SQL query against the local GeoNames table, so these
 * exercise the real query against the real database rather than mocking it.
 * They skip cleanly when no database or dataset is available, so `npm test`
 * still passes on a bare checkout.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { geonamesLoaded, nearestPlace } from '../src/geocode.ts';
import { closePool } from '../src/db/pool.ts';

const available = await geonamesLoaded().catch(() => false);

after(async () => {
  await closePool().catch(() => undefined);
});

test('nearestPlace names a well-known city', { skip: !available && 'GeoNames not loaded' }, async () => {
  // Statue of Liberty — deliberately a public landmark, not project data.
  const place = await nearestPlace(40.6892, -74.0445);

  assert.ok(place, 'expected a nearby place');
  assert.match(place.label, /,/, 'label should pair a place with its region');
  assert.ok(place.distance_miles < 20, `expected something close, got ${place.distance_miles} mi`);
  assert.equal(place.country_code, 'US');
});

test(
  'nearestPlace returns null in the middle of an ocean',
  { skip: !available && 'GeoNames not loaded' },
  async () => {
    // Point Nemo — the most remote spot on the planet. Naming a "nearest town"
    // here would be actively misleading, so the radius cap must reject it.
    assert.equal(await nearestPlace(-48.876667, -123.393333), null);
  },
);

test('nearestPlace ignores a null island coordinate', { skip: !available && 'GeoNames not loaded' }, async () => {
  // 0,0 is what the API reports when it has no fix, not a real position.
  assert.equal(await nearestPlace(0, 0), null);
});
