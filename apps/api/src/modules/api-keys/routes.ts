import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses, idParams } from '../../shared/http.js';
import type { ApiKeysController } from './controller.js';
import { apiKeyCreatedSchema, apiKeySchema, createApiKeyBody } from './schemas.js';

const security = [{ apiKey: [] }];

export const apiKeysRoutes =
  (controller: ApiKeysController): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/api-keys', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['api-keys'],
        summary: 'List API keys (never includes secrets)',
        security,
        response: { 200: z.object({ apiKeys: z.array(apiKeySchema) }), ...errorResponses(401, 403) },
      },
      handler: controller.list,
    });

    app.post('/api-keys', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['api-keys'],
        summary: 'Create an API key; the plaintext is returned only in this response',
        security,
        body: createApiKeyBody,
        response: { 201: apiKeyCreatedSchema, ...errorResponses(400, 401, 403, 404) },
      },
      handler: controller.create,
    });

    app.delete('/api-keys/:id', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        security,
        params: idParams,
        response: { 204: z.undefined(), ...errorResponses(401, 403, 404) },
      },
      handler: controller.revoke,
    });
  };
