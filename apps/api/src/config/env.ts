import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

const optional = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  /** `pglite://memory`, `pglite://<dir>` or a `postgres://` connection string. */
  DATABASE_URL: z.string().min(1).default('pglite://memory'),
  /** Base URL of the dashboard; used to build run links and Stripe redirect URLs. */
  PUBLIC_URL: z.url().default('http://localhost:8787'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: csv,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_TEAM: optional,
  STRIPE_PRICE_ASSURANCE: optional,
  /** Set to true only behind a load balancer that sets X-Forwarded-For (ALB, Fly, Render); used for client IPs. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Requests per minute per API key (or IP when unauthenticated). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  /** Signups per hour per IP. */
  SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.output<typeof envSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Parses and validates configuration once at startup. Fails fast with every problem listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}
