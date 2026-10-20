import { z } from 'zod';
import { SCOPES } from '../../shared/auth.js';

export const apiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** First 8 characters after `rc_live_`, for display only. */
    prefix: z.string(),
    scopes: z.array(z.enum(SCOPES)),
    projectId: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
  })
  .meta({ id: 'ApiKey' });

export const apiKeyCreatedSchema = apiKeySchema
  .extend({ key: z.string().describe('Plaintext key. Returned only once; store it in your CI secrets.') })
  .meta({ id: 'ApiKeyCreated' });

export const createApiKeyBody = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(SCOPES)).min(1).max(3),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe('Bind the key to one project (recommended for CI ingest keys).'),
});

export type ApiKeyDto = z.output<typeof apiKeySchema>;
export type ApiKeyCreatedDto = z.output<typeof apiKeyCreatedSchema>;
export type CreateApiKeyInput = z.output<typeof createApiKeyBody>;
