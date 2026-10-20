import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../../plugins/auth.js';
import type { CreateApiKeyInput } from './schemas.js';
import type { ApiKeysService } from './service.js';

export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  list = async (request: FastifyRequest) => ({ apiKeys: await this.service.list(authOf(request)) });

  create = async (request: FastifyRequest<{ Body: CreateApiKeyInput }>, reply: FastifyReply) => {
    reply.code(201);
    return this.service.create(authOf(request), request.body);
  };

  revoke = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.revoke(authOf(request), request.params.id);
    return reply.code(204).send();
  };
}
