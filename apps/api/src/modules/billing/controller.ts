import type { FastifyReply, FastifyRequest } from 'fastify';
import { authOf } from '../../plugins/auth.js';
import type { CheckoutInput } from './schemas.js';
import type { BillingService } from './service.js';

export class BillingController {
  constructor(private readonly service: BillingService) {}

  overview = async (request: FastifyRequest) => this.service.overview(authOf(request));

  checkout = async (request: FastifyRequest<{ Body: CheckoutInput }>) =>
    this.service.checkout(authOf(request), request.body);

  webhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const signature = request.headers['stripe-signature'];
    return reply.send(
      await this.service.handleWebhook(raw, typeof signature === 'string' ? signature : undefined),
    );
  };
}
