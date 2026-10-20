import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses } from '../../shared/http.js';

/** Liveness never touches dependencies; readiness pings the database. */
export const healthRoutes =
  (ping: () => Promise<void>): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/healthz', {
      config: { rateLimit: false },
      schema: { tags: ['health'], response: { 200: z.object({ status: z.literal('ok') }) } },
      handler: async () => ({ status: 'ok' as const }),
    });

    app.get('/readyz', {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        response: { 200: z.object({ status: z.literal('ready') }), ...errorResponses(503) },
      },
      handler: async (request, reply) => {
        try {
          await ping();
          return { status: 'ready' as const };
        } catch (err) {
          request.log.warn({ err }, 'readiness check failed');
          return reply.code(503).send({ error: { code: 'unavailable', message: 'Database unavailable' } });
        }
      },
    });
  };
