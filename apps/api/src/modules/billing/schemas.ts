import { z } from 'zod';
import { PLAN_IDS } from './plans.js';

export const planSchema = z
  .object({
    id: z.enum(PLAN_IDS),
    name: z.string(),
    priceUsdMonthly: z.number(),
    maxProjects: z.number().nullable(),
    runsPerMonth: z.number(),
    retentionDays: z.number(),
    features: z.array(z.string()),
  })
  .meta({ id: 'Plan' });

export const billingOverviewSchema = z
  .object({
    plan: planSchema,
    period: z.string().describe('UTC month, YYYY-MM'),
    usage: z.object({ runs: z.number(), projects: z.number() }),
    limits: z.object({
      runsPerMonth: z.number(),
      maxProjects: z.number().nullable(),
      retentionDays: z.number(),
    }),
    checkoutEnabled: z.boolean(),
    plans: z.array(planSchema),
  })
  .meta({ id: 'BillingOverview' });

export const checkoutBody = z.object({ plan: z.enum(['team', 'assurance']) });
export const checkoutResponse = z.object({ url: z.string() });
export const webhookResponse = z.object({ received: z.boolean(), duplicate: z.boolean().optional() });

export type BillingOverview = z.output<typeof billingOverviewSchema>;
export type CheckoutInput = z.output<typeof checkoutBody>;
