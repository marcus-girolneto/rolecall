import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../../plugins/auth.js';
import type { CreateProjectInput } from './schemas.js';
import type { ProjectsService } from './service.js';

export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  list = async (request: FastifyRequest) => ({ projects: await this.service.list(authOf(request)) });

  get = async (request: FastifyRequest<{ Params: { id: string } }>) =>
    this.service.get(authOf(request), request.params.id);

  create = async (request: FastifyRequest<{ Body: CreateProjectInput }>, reply: FastifyReply) => {
    reply.code(201);
    return this.service.create(authOf(request), request.body);
  };
}
