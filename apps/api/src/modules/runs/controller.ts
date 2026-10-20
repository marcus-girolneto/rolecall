import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../../plugins/auth.js';
import type { ListRunsInput, RunDetailDto, UploadInput } from './schemas.js';
import type { RunsService } from './service.js';

export class RunsController {
  constructor(private readonly service: RunsService) {}

  upload = async (
    request: FastifyRequest<{ Body: UploadInput; Querystring: { project?: string | undefined } }>,
    reply: FastifyReply,
  ) => {
    const { created, ...result } = await this.service.ingest(
      authOf(request),
      request.body,
      request.query.project,
    );
    reply.code(created ? 201 : 200);
    return result;
  };

  list = async (request: FastifyRequest<{ Querystring: ListRunsInput }>) => {
    const page = await this.service.list(authOf(request), request.query);
    return { runs: page.items, nextCursor: page.nextCursor };
  };

  // RunDetail (core) and RunDetailDto (wire schema) describe the same JSON; core uses interfaces, which TS
  // will not widen to the schema's open index signatures, hence the cast. The serializer validates the shape.
  detail = async (request: FastifyRequest<{ Params: { id: string } }>) =>
    (await this.service.detail(authOf(request), request.params.id)) as unknown as RunDetailDto;

  remove = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await this.service.remove(authOf(request), request.params.id);
    return reply.code(204).send();
  };
}
