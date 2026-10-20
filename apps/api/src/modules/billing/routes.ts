import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorResponses } from '../../shared/http.js';
import type { BillingController } from './controller.js';
import { billingOverviewSchema, checkoutBody, checkoutResponse, webhookResponse } from './schemas.js';

const security = [{ apiKey: [] }];

export const billingRoutes =
  (controller: BillingController): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/billing', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['billing'],
        summary: 'Current plan, usage this month and limits',
        security,
        response: { 200: billingOverviewSchema, ...errorResponses(401, 403) },
      },
      handler: controller.overview,
    });

    app.post('/billing/checkout', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['billing'],
        summary: 'Start a Stripe Checkout session for a paid plan',
        security,
        body: checkoutBody,
        response: { 200: checkoutResponse, ...errorResponses(400, 401, 403, 501) },
      },
      handler: controller.checkout,
    });

    // Stripe signs the exact bytes it sends, so this route must see the raw body. The parser override is
    // scoped to this encapsulated plugin and does not affect any other route.
    await app.register(async (raw) => {
      raw.removeContentTypeParser('application/json');
      raw.addContentTypeParser(
        'application/json',
        { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
        (_req, body, done) => done(null, body),
      );
      raw.post('/billing/webhook', {
        config: { rateLimit: false },
        schema: {
          tags: ['billing'],
          summary: 'Stripe webhook endpoint (signature verified against the raw body)',
          response: { 200: webhookResponse, ...errorResponses(400, 501) },
        },
        handler: controller.webhook,
      });
    });
  };
