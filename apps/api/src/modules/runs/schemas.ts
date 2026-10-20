import { z } from 'zod';

export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

const STATUS = ['pass', 'fail', 'warn', 'error'] as const;
const MODE = ['replay', 'record', 'live'] as const;

const summarySchema = z.object({
  total: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
});
const suiteRefSchema = z.object({ name: z.string().min(1).max(500), hash: z.string().min(1).max(200) });
const gitSchema = z.object({ sha: z.string(), branch: z.string(), dirty: z.boolean() }).nullable();

/** Upload body: the raw text of each bundle file, exactly as written by the CLI (hashes are computed over these bytes). */
export const uploadBody = z.object({
  manifest: z.string().min(2).describe('manifest.json'),
  results: z.string().min(2).describe('results.json'),
  events: z.string().describe('events.jsonl'),
  signature: z.string().min(2).optional().describe('signature.json, when the bundle is signed'),
});

export const uploadQuery = z.object({
  project: z
    .string()
    .min(1)
    .optional()
    .describe('Target project id. Required for org-wide keys when the org has several projects.'),
});

export const uploadResponse = z.object({
  id: z.string(),
  url: z.string(),
  duplicate: z
    .boolean()
    .describe('True when this exact bundle (same root hash) was already stored for the project'),
});

/** Structural checks applied after the hash check (hashes prove integrity, not shape). */
export const manifestShape = z.looseObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  suite: suiteRefSchema,
  mode: z.enum(MODE),
  summary: summarySchema,
  git: gitSchema,
  rootHash: z.string().min(1),
});

export const resultShape = z.looseObject({
  schemaVersion: z.literal(1),
  suite: suiteRefSchema,
  mode: z.enum(MODE),
  summary: summarySchema,
  policy: z.array(z.looseObject({ id: z.string(), status: z.enum(STATUS) })),
  scenarios: z.array(z.looseObject({ id: z.string(), status: z.enum(STATUS) })),
});

export const runListItemSchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    suite: suiteRefSchema,
    mode: z.enum(MODE),
    summary: summarySchema,
    git: gitSchema,
    signed: z.boolean(),
    verified: z.boolean(),
  })
  .meta({ id: 'RunListItem', description: 'Same shape as RunListItem in @rolecall/core' });

export const listRunsQuery = z.object({
  project: z.string().min(1).optional(),
  suite: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  status: z.enum(STATUS).optional().describe('Overall run status: fail > error > warn > pass'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listRunsResponse = z.object({
  runs: z.array(runListItemSchema),
  nextCursor: z.string().nullable(),
});

const statusChange = z.object({
  id: z.string(),
  title: z.string(),
  from: z.enum(STATUS),
  to: z.enum(STATUS),
});

export const verifyReportSchema = z
  .object({
    ok: z.boolean(),
    signed: z.boolean(),
    keyId: z.string().optional(),
    trustedKey: z.boolean(),
    rootHash: z.string().optional(),
    problems: z.array(z.string()),
  })
  .meta({ id: 'VerifyReport' });

export const runDetailSchema = z
  .object({
    manifest: manifestShape,
    result: resultShape,
    verify: verifyReportSchema,
    baseline: z
      .object({
        runId: z.string(),
        comparison: z.object({
          regressions: z.array(statusChange),
          fixes: z.array(statusChange),
          added: z.array(z.string()),
          removed: z.array(z.string()),
          newlyAttempted: z.array(z.object({ id: z.string(), tools: z.array(z.string()) })),
        }),
      })
      .optional(),
  })
  .meta({ id: 'RunDetail', description: 'Same shape as RunDetail in @rolecall/core' });

export type UploadInput = z.output<typeof uploadBody>;
export type UploadResult = z.output<typeof uploadResponse>;
export type ListRunsInput = z.output<typeof listRunsQuery>;
export type RunDetailDto = z.output<typeof runDetailSchema>;
