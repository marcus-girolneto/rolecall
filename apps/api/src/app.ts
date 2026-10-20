import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import type { DatabaseHandle } from './db/client.js';
import { ApiKeysController } from './modules/api-keys/controller.js';
import { DrizzleApiKeysRepository } from './modules/api-keys/repository.js';
import { apiKeysRoutes } from './modules/api-keys/routes.js';
import { ApiKeysService } from './modules/api-keys/service.js';
import { BillingController } from './modules/billing/controller.js';
import { type BillingGateway, StripeBillingGateway } from './modules/billing/gateway.js';
import { DrizzleProcessedEventsRepository, DrizzleUsageRepository } from './modules/billing/repository.js';
import { billingRoutes } from './modules/billing/routes.js';
import { BillingService } from './modules/billing/service.js';
import { DashboardPage } from './modules/dashboard/page.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { OrganizationsController } from './modules/organizations/controller.js';
import { DrizzleOrganizationsRepository } from './modules/organizations/repository.js';
import { organizationsRoutes } from './modules/organizations/routes.js';
import { OrganizationsService } from './modules/organizations/service.js';
import { ProjectsController } from './modules/projects/controller.js';
import { DrizzleProjectsRepository } from './modules/projects/repository.js';
import { projectsRoutes } from './modules/projects/routes.js';
import { ProjectsService } from './modules/projects/service.js';
import { RunsController } from './modules/runs/controller.js';
import { DrizzleRunsRepository } from './modules/runs/repository.js';
import { runsRoutes } from './modules/runs/routes.js';
import { RunsService } from './modules/runs/service.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurity } from './plugins/security.js';
import { registerSwagger } from './plugins/swagger.js';
import { type Clock, systemClock } from './shared/clock.js';

export interface AppDeps {
  env: Env;
  database: DatabaseHandle;
  clock?: Clock;
  /** Defaults to the Stripe adapter configured from env. */
  billingGateway?: BillingGateway;
  /** Defaults to the built apps/ui page. */
  dashboard?: DashboardPage;
  /** Override Fastify's logger (tests pass `false`). */
  logger?: FastifyServerOptions['logger'];
}

/**
 * Composition root: the only place that knows concrete classes. Wires repositories → services → controllers → routes.
 * Tests call this with an in-memory PGlite database and a fake clock.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env, database } = deps;
  const clock = deps.clock ?? systemClock;
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');

  const app = Fastify({
    logger: deps.logger ?? {
      level: env.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers["stripe-signature"]', 'req.headers.cookie'],
        censor: '[redacted]',
      },
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Repositories (the only Drizzle-aware layer)
  const db = database.db;
  const orgsRepo = new DrizzleOrganizationsRepository(db);
  const projectsRepo = new DrizzleProjectsRepository(db);
  const keysRepo = new DrizzleApiKeysRepository(db);
  const runsRepo = new DrizzleRunsRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const eventsRepo = new DrizzleProcessedEventsRepository(db);

  // Services (business rules; depend on repository interfaces)
  const gateway =
    deps.billingGateway ??
    new StripeBillingGateway({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      prices: { team: env.STRIPE_PRICE_TEAM, assurance: env.STRIPE_PRICE_ASSURANCE },
    });
  const orgsService = new OrganizationsService(orgsRepo, clock);
  const projectsService = new ProjectsService(projectsRepo, orgsRepo);
  const keysService = new ApiKeysService(keysRepo, projectsRepo, clock);
  const runsService = new RunsService({
    runs: runsRepo,
    projects: projectsRepo,
    orgs: orgsRepo,
    usage: usageRepo,
    clock,
    publicUrl,
  });
  const billingService = new BillingService({
    orgs: orgsRepo,
    projects: projectsRepo,
    usage: usageRepo,
    events: eventsRepo,
    gateway,
    clock,
    publicUrl,
  });

  // Cross-cutting plugins
  registerErrorHandler(app);
  await registerSecurity(app, env);
  await registerSwagger(app, env);
  registerAuth(app, (token) => keysService.authenticate(token));

  // Routes
  await app.register(healthRoutes(() => database.ping()));
  await app.register(dashboardRoutes(deps.dashboard ?? new DashboardPage()));
  await app.register(
    async (v1) => {
      await v1.register(
        organizationsRoutes(new OrganizationsController(orgsService), {
          signupRateLimit: env.SIGNUP_RATE_LIMIT_MAX,
        }),
      );
      await v1.register(projectsRoutes(new ProjectsController(projectsService)));
      await v1.register(apiKeysRoutes(new ApiKeysController(keysService)));
      await v1.register(runsRoutes(new RunsController(runsService)));
      await v1.register(billingRoutes(new BillingController(billingService)));
    },
    { prefix: '/v1' },
  );

  return app;
}
