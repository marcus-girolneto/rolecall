import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DashboardPage } from './page.js';

/** Hosted dashboard. The page holds no data; it asks for an API key and calls /v1 from the browser. */
export const dashboardRoutes =
  (page: DashboardPage): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/', { schema: { hide: true } }, async (_request, reply) => reply.redirect('/app'));

    app.get('/app', { schema: { hide: true } }, async (_request, reply) => {
      const rendered = page.render({ mode: 'cloud', apiBase: '/v1' });
      if (!rendered) {
        return reply.code(503).send({
          error: {
            code: 'dashboard_unavailable',
            message: 'Dashboard assets are not built on this server.',
          },
        });
      }
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-security-policy', rendered.csp)
        .header('cache-control', 'no-store')
        .send(rendered.html);
    });

    // Links printed by `rolecall push` point here.
    app.get(
      '/runs/:id',
      { schema: { hide: true, params: z.object({ id: z.string().regex(/^[\w-]+$/) }) } },
      async (request, reply) => reply.redirect(`/app#/runs/${request.params.id}`),
    );
  };
