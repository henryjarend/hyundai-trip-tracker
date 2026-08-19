import type { FastifyInstance } from 'fastify';
import {
  getTrip,
  listPollRuns,
  listPositions,
  listStatusSnapshots,
  listTrips,
  listVehicleEvents,
  listVehicles,
  tripSummary,
} from '../db/repo.ts';
import { poll } from '../ingest/poll.ts';

interface TripQueryString {
  vin?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * `from` and `to` go into a `timestamptz` parameter, so an unparseable one would come
 * back as a Postgres cast error dressed as a 503 — a database outage, as far as the UI
 * can tell. Reject it here instead, where it is plainly the caller's fault.
 */
function invalidTimestamp(raw: string | undefined): boolean {
  return raw !== undefined && raw !== '' && Number.isNaN(new Date(raw).getTime());
}

function timestampError(query: { from?: string; to?: string }): string | null {
  const bad = (['from', 'to'] as const).find((key) => invalidTimestamp(query[key]));
  return bad ? `Invalid ${bad} timestamp; expected an ISO 8601 instant` : null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/vehicles', async () => ({ vehicles: await listVehicles() }));

  app.get<{ Querystring: TripQueryString }>('/api/trips', async (request, reply) => {
    const { vin, from, to } = request.query;
    const invalid = timestampError(request.query);
    if (invalid) return reply.status(400).send({ error: invalid });

    return listTrips({
      vin,
      from,
      to,
      limit: clampInt(request.query.limit, 200, 1000),
      offset: clampInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER),
    });
  });

  app.get<{ Params: { id: string } }>('/api/trips/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return reply.status(400).send({ error: 'Invalid trip id' });
    }
    const trip = await getTrip(id);
    if (!trip) return reply.status(404).send({ error: 'Trip not found' });
    return trip;
  });

  app.get<{ Querystring: TripQueryString }>('/api/stats/summary', async (request, reply) => {
    const { vin, from, to } = request.query;
    const invalid = timestampError(request.query);
    if (invalid) return reply.status(400).send({ error: invalid });

    return tripSummary(vin, from, to);
  });

  app.get<{ Querystring: TripQueryString }>('/api/status', async (request) => ({
    snapshots: await listStatusSnapshots(request.query.vin, clampInt(request.query.limit, 100, 1000)),
  }));

  app.get<{ Querystring: TripQueryString }>('/api/positions', async (request) => ({
    positions: await listPositions(request.query.vin, clampInt(request.query.limit, 100, 1000)),
  }));

  app.get<{ Querystring: TripQueryString }>('/api/events', async (request) => ({
    events: await listVehicleEvents(request.query.vin, clampInt(request.query.limit, 100, 1000)),
  }));

  app.get<{ Querystring: TripQueryString }>('/api/poll-runs', async (request) => ({
    runs: await listPollRuns(clampInt(request.query.limit, 20, 200)),
  }));

  // Manual trigger, handy for verification and for a "refresh now" button later.
  app.post('/api/poll', async (_request, reply) => {
    try {
      return await poll();
    } catch (error) {
      return reply.status(502).send({ error: (error as Error).message });
    }
  });
}
