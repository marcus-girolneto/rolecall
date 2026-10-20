import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponses, idParams } from '../../shared/http.js';
import type { ProjectsController } from './controller.js';
import { createProjectBody, projectSchema } from './schemas.js';

const security = [{ apiKey: [] }];

export const projectsRoutes =
  (controller: ProjectsController): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/projects', {
      onRequest: app.requireAuth('runs:read'),
      schema: {
        tags: ['projects'],
        summary: 'List projects visible to this key',
        security,
        response: { 200: z.object({ projects: z.array(projectSchema) }), ...errorResponses(401, 403) },
      },
      handler: controller.list,
    });

    app.post('/projects', {
      onRequest: app.requireAuth('admin'),
      schema: {
        tags: ['projects'],
        summary: 'Create a project (counts against the plan project limit)',
        security,
        body: createProjectBody,
        response: { 201: projectSchema, ...errorResponses(400, 401, 402, 403, 409) },
      },
      handler: controller.create,
    });

    app.get('/projects/:id', {
      onRequest: app.requireAuth('runs:read'),
      schema: {
        tags: ['projects'],
        summary: 'Get a project',
        security,
        params: idParams,
        response: { 200: projectSchema, ...errorResponses(401, 403, 404) },
      },
      handler: controller.get,
    });
  };
