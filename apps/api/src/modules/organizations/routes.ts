import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponses } from '../../shared/http.js';
import type { OrganizationsController } from './controller.js';
import { organizationSchema, signupBody, signupResponse } from './schemas.js';

export const organizationsRoutes =
  (controller: OrganizationsController, opts: { signupRateLimit: number }): FastifyPluginAsyncZod =>
  async (app) => {
    app.post('/signup', {
      config: {
        rateLimit: {
          max: opts.signupRateLimit,
          timeWindow: '1 hour',
          keyGenerator: (req) => `signup:${req.ip}`,
        },
      },
      schema: {
        tags: ['organizations'],
        summary: 'Create an organization, a default project and an admin API key (shown once)',
        body: signupBody,
        response: { 201: signupResponse, ...errorResponses(400, 429) },
      },
      handler: controller.signup,
    });

    app.get('/organization', {
      onRequest: app.requireAuth(),
      schema: {
        tags: ['organizations'],
        summary: 'The organization that owns the calling API key',
        security: [{ apiKey: [] }],
        response: { 200: organizationSchema, ...errorResponses(401) },
      },
      handler: controller.current,
    });
  };
