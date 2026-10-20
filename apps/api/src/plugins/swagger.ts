import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import type { Env } from '../config/env.js';

/** OpenAPI document generated from the zod route schemas. UI at /docs, JSON at /docs/json. */
export async function registerSwagger(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Rolecall Cloud API',
        description:
          'Stores, re-verifies and compares Rolecall evidence bundles per organization and project.',
        version: '0.1.0',
      },
      servers: [{ url: env.PUBLIC_URL }],
      components: {
        securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'API key: rc_live_…' } },
      },
      tags: [
        { name: 'runs', description: 'Evidence bundle ingest, history and comparison' },
        { name: 'projects' },
        { name: 'api-keys' },
        { name: 'organizations' },
        { name: 'billing' },
        { name: 'health' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
}
