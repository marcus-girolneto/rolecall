import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../../plugins/auth.js';
import type { SignupInput } from './schemas.js';
import type { OrganizationsService } from './service.js';

export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  signup = async (request: FastifyRequest<{ Body: SignupInput }>, reply: FastifyReply) => {
    reply.code(201);
    return this.service.signup(request.body);
  };

  current = async (request: FastifyRequest) => this.service.current(authOf(request));
}
