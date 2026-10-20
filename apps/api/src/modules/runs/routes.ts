import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses, idParams } from '../../shared/http.js';
import type { RunsController } from './controller.js';
import {
  listRunsQuery,
  listRunsResponse,
  MAX_BUNDLE_BYTES,
  runDetailSchema,
  uploadBody,
  uploadQuery,
  uploadResponse,
} from './schemas.js';

const security = [{ apiKey: [] }];

export const runsRoutes =
  (controller: RunsController): FastifyPluginAsyncZod =>
  async (app) => {
    app.post('/runs', {
      onRequest: app.requireAuth('runs:write'),
      bodyLimit: MAX_BUNDLE_BYTES,
      schema: {
        tags: ['runs'],
        summary: 'Upload an evidence bundle (re-verified server-side; idempotent by root hash)',
        security,
        querystring: uploadQuery,
        body: uploadBody,
        response: {
          200: uploadResponse,
          201: uploadResponse,
          ...errorResponses(400, 401, 402, 403, 404, 413, 422),
        },
      },
      handler: controller.upload,
    });

    app.get('/runs', {
      onRequest: app.requireAuth('runs:read'),
      schema: {
        tags: ['runs'],
        summary: 'List runs, newest first (cursor pagination)',
        security,
        querystring: listRunsQuery,
        response: { 200: listRunsResponse, ...errorResponses(400, 401, 403, 404) },
      },
      handler: controller.list,
    });

    app.get('/runs/:id', {
      onRequest: app.requireAuth('runs:read'),
      schema: {
        tags: ['runs'],
        summary: 'Run detail with fresh verification and baseline comparison',
        security,
        params: idParams,
        response: { 200: runDetailSchema, ...errorResponses(401, 403, 404) },
      },
      handler: controller.detail,
    });

    app.delete('/runs/:id', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['runs'],
        summary: 'Delete a run (does not refund monthly quota)',
        security,
        params: idParams,
        response: { 204: z.undefined(), ...errorResponses(401, 403, 404) },
      },
      handler: controller.remove,
    });
  };
