import { z } from 'zod';
import { apiKeyCreatedSchema } from '../api-keys/schemas.js';
import { PLAN_IDS } from '../billing/plans.js';
import { projectSchema } from '../projects/schemas.js';

export const signupBody = z.object({
  orgName: z.string().trim().min(2).max(100),
  email: z.email().max(254),
});

export const organizationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    plan: z.enum(PLAN_IDS),
    createdAt: z.string(),
  })
  .meta({ id: 'Organization' });

export const signupResponse = z.object({
  organization: organizationSchema,
  project: projectSchema,
  apiKey: apiKeyCreatedSchema,
});

export type SignupInput = z.output<typeof signupBody>;
export type OrganizationDto = z.output<typeof organizationSchema>;
export type SignupResult = z.output<typeof signupResponse>;
