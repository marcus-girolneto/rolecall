import { z } from 'zod';
import type { PolicyRule, SuiteDef } from './types.js';

const PRODUCTION = /\bprod(uction)?\b/i;

const targetSchema = z.object({
  kind: z.enum(['memory', 'sandbox', 'staging'], {
    error: 'target.kind must be "memory", "sandbox" or "staging". Rolecall never runs against production.',
  }),
  name: z
    .string()
    .min(1)
    .refine(
      (n) => !PRODUCTION.test(n),
      'target.name looks like production. Rolecall never runs against production.',
    ),
  allowHosts: z.array(z.string()).optional(),
});

const ruleSchema = z.object({
  role: z.string().min(1),
  tool: z.string().min(1),
  args: z.unknown(),
  expect: z.enum(['allow', 'deny']),
  label: z.string().optional(),
  state: z.enum(['unchanged', 'changed']).optional(),
});

const scenarioSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  turns: z.array(z.string().min(1)).min(1),
  forbid: z
    .array(
      z.union([
        z.string(),
        z.object({
          tool: z.string(),
          args: z.unknown().optional(),
          match: z.record(z.string(), z.unknown()).optional(),
        }),
      ]),
    )
    .optional(),
  require: z.array(z.string()).optional(),
  state: z.enum(['unchanged', 'changed']).optional(),
  technique: z.string().optional(),
});

const fn = z.custom<(...args: never[]) => unknown>((v) => typeof v === 'function', 'expected a function');

const suiteSchema = z.object({
  name: z.string().min(1),
  target: targetSchema,
  roles: z
    .record(z.string(), z.unknown())
    .refine((r) => Object.keys(r).length > 0, 'define at least one role'),
  setup: fn,
  teardown: fn.optional(),
  snapshot: fn,
  agent: z.object({ kind: z.string(), invokeTool: fn, run: fn, describeTools: fn.optional() }),
  permissions: z.record(z.string(), z.record(z.string(), z.enum(['allow', 'deny']))).optional(),
  examples: z.record(z.string(), z.unknown()).optional(),
  policy: z.array(ruleSchema).optional(),
  scenarios: z.array(scenarioSchema).optional(),
  attacks: z.union([z.string(), z.literal(false)]).optional(),
  isDenied: fn.optional(),
  ignoreStatePaths: z.array(z.string()).optional(),
  redact: z
    .object({ values: z.array(z.string()).optional(), patterns: z.array(z.instanceof(RegExp)).optional() })
    .optional(),
});

export class SuiteValidationError extends Error {
  override name = 'SuiteValidationError';
}

/** Declares a Rolecall suite. Validates its shape eagerly so mistakes surface with a clear message. */
export function defineSuite<Ctx, Id>(suite: SuiteDef<Ctx, Id>): SuiteDef<Ctx, Id> {
  validateSuite(suite);
  return suite;
}

export function validateSuite<Ctx, Id>(suite: SuiteDef<Ctx, Id>): void {
  const parsed = suiteSchema.safeParse(suite);
  const problems: string[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(suite)'}: ${i.message}`);

  if (parsed.success) {
    const roles = new Set(Object.keys(suite.roles));
    suite.policy?.forEach((r, i) => {
      if (!roles.has(r.role))
        problems.push(`policy.${i}.role: unknown role "${r.role}" (known: ${[...roles].join(', ')})`);
    });
    for (const role of Object.keys(suite.permissions ?? {})) {
      if (!roles.has(role))
        problems.push(`permissions.${role}: unknown role "${role}" (known: ${[...roles].join(', ')})`);
    }
    suite.scenarios?.forEach((s, i) => {
      if (!roles.has(s.role)) problems.push(`scenarios.${i}.role: unknown role "${s.role}"`);
    });
    const names = new Set<string>();
    suite.scenarios?.forEach((s) => {
      if (names.has(s.name)) problems.push(`scenarios: duplicate scenario name "${s.name}"`);
      names.add(s.name);
    });
    if (!policyRules(suite).length && !suite.scenarios?.length)
      problems.push('suite: add a `permissions` table, a policy rule or a scenario');
  }

  if (problems.length) {
    throw new SuiteValidationError(
      `Invalid Rolecall suite "${(suite as { name?: string }).name ?? '?'}":\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/** Every probe rule in the suite: the `permissions` table expanded with `examples`, then explicit `policy` rules. */
export function policyRules<Ctx, Id>(suite: SuiteDef<Ctx, Id>): PolicyRule[] {
  const fromTable: PolicyRule[] = [];
  for (const [role, tools] of Object.entries(suite.permissions ?? {})) {
    for (const [tool, expect] of Object.entries(tools)) {
      fromTable.push({ role, tool, args: suite.examples?.[tool] ?? {}, expect });
    }
  }
  return [...fromTable, ...(suite.policy ?? [])];
}
