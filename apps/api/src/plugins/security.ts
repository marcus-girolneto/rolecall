import { createHash } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { looksLikeApiKey } from '../shared/crypto.js';

/** Helmet headers, CORS allow-list and per-key (or per-IP) rate limiting. */
export async function registerSecurity(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
  });
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Bucket by API key (hashed, never logged) so one noisy CI pipeline cannot starve an office NAT.
    keyGenerator: (req) => {
      // Bucket by the API key itself, not the raw header: "Bearer x", "bearer x" and "Bearer  x" are one key.
      // Anything that isn't a well-formed key falls back to the client IP, so random tokens can't dodge limits.
      const auth = req.headers.authorization;
      const token = typeof auth === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(auth)?.[1] : undefined;
      return token && looksLikeApiKey(token)
        ? `k:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
        : `ip:${req.ip}`;
    },
  });
}
