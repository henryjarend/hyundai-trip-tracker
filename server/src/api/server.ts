import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from '../config.ts';
import { registerRoutes } from './routes.ts';
import { closePool, DatabaseError } from '../db/pool.ts';
import { migrate } from '../db/migrate.ts';

const WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

export async function buildServer() {
  const app = Fastify({ logger: true });

  // The API queries columns that migrations add, so it must not serve traffic
  // before they are applied. Safe to run alongside the poller — see the advisory
  // lock in migrate.ts.
  await migrate();

  // A database that is down is an upstream problem, not a bug in the request —
  // report it as 503 so the UI can say something useful instead of spinning.
  app.setErrorHandler((error: unknown, _request, reply) => {
    app.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DatabaseError) {
      return reply.status(503).send({ error: `Database unavailable: ${message}` });
    }
    return reply.status(500).send({ error: message });
  });

  await registerRoutes(app);

  // Serve the built frontend from the same port when it exists. During frontend
  // development Vite serves it instead and proxies /api here.
  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

if (import.meta.main) {
  const app = await buildServer();

  const shutdown = async () => {
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
