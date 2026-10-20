import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { attackScenarios, attacksPath, readAttacks } from './attacks.js';
import { Cassette, CassetteMissError } from './cassette.js';
import { policyRules, validateSuite } from './define.js';
import { defaultIsDenied, errorMessage } from './denial.js';
import { diffState } from './diff.js';
import { normalize, sha256, stableStringify } from './hash.js';
import { blockNetwork } from './network-guard.js';
import { createRedactor } from './redact.js';
import type {
  DenialCheckInput,
  Finding,
  ForbidExpectation,
  ForbidResult,
  Layer,
  PolicyResult,
  PolicyRule,
  RunEvent,
  RunMode,
  RunResult,
  ScenarioDef,
  ScenarioResult,
  Status,
  SuiteDef,
  TimelineEntry,
  ToolCallRecord,
  ToolHooks,
} from './types.js';

export class LiveTargetRefusedError extends Error {
  override name = 'LiveTargetRefusedError';
}

export interface RunOptions {
  mode?: RunMode;
  /** Directory holding per-scenario cassettes. Defaults to `rolecall/cassettes` under the cwd. */
  cassetteDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Only run tests whose id contains this string. */
  filter?: string;
  /** Directory that relative suite paths (attacks file) resolve against. Defaults to the process cwd. */
  cwd?: string;
  onEvent?: (event: RunEvent) => void;
}

export interface RunOutput {
  result: RunResult;
  events: RunEvent[];
  models: Array<{ provider: string; modelId: string }>;
  /** Cassette files that were read or written during the run. */
  cassettes: string[];
}

type ProbeOutcome = { layer: Exclude<Layer, 'model_refused'>; error?: string; result?: unknown };

const FAILING: ReadonlySet<Finding['code']> = new Set([
  'unexpected_execution',
  'unexpected_denial',
  'state_changed',
  'state_unchanged',
  'required_tool_missing',
]);
/** Errors that mean the tool ran against empty or missing test data rather than a real decision. */
const MISSING_DATA =
  /Cannot read properties of (undefined|null)|is not a function|is not iterable|undefined is not an object/;
/** Provider throttling, as reported by the AI SDK and common gateways. */
const RATE_LIMITED = /rate.?limit|too many requests|\b429\b|quota exceeded/i;
const ERRORING: ReadonlySet<Finding['code']> = new Set(['unexpected_error', 'agent_error']);

export async function runSuite<Ctx, Id>(suite: SuiteDef<Ctx, Id>, opts: RunOptions = {}): Promise<RunOutput> {
  validateSuite(suite);
  const mode = opts.mode ?? 'replay';
  const env = opts.env ?? process.env;
  const cassetteDir = opts.cassetteDir ?? join(process.cwd(), 'rolecall', 'cassettes');

  if (suite.target.kind !== 'memory' && env.ROLECALL_ALLOW_LIVE !== '1') {
    throw new LiveTargetRefusedError(
      `Suite "${suite.name}" targets ${suite.target.kind} "${suite.target.name}", which executes real tool handlers ` +
        'outside memory. Set ROLECALL_ALLOW_LIVE=1 to confirm this target is safe to modify.',
    );
  }

  const isDenied = suite.isDenied ?? defaultIsDenied;
  const events: RunEvent[] = [];
  const models = new Map<string, { provider: string; modelId: string }>();
  const cassettes = new Set<string>();
  const emit = (e: RunEvent) => {
    events.push(e);
    opts.onEvent?.(e);
  };
  const timed = async <T>(testId: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    emit({ testId, phase: 'start', at: new Date().toISOString() });
    try {
      return await fn();
    } finally {
      emit({
        testId,
        phase: 'end',
        at: new Date().toISOString(),
        durationMs: Math.round(performance.now() - start),
      });
    }
  };

  const identity = (role: string): Id => {
    const value = suite.roles[role];
    return (typeof value === 'function' ? (value as () => Id)() : value) as Id;
  };

  const withCtx = async <T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const ctx = await suite.setup();
    try {
      return await fn(ctx);
    } finally {
      await suite.teardown?.(ctx);
    }
  };

  const snapshot = async (ctx: Ctx) => normalize(await suite.snapshot(ctx));

  const classify = (input: DenialCheckInput): boolean => {
    try {
      return isDenied(input);
    } catch {
      return false;
    }
  };

  const probe = async (ctx: Ctx, role: string, tool: string, args: unknown): Promise<ProbeOutcome> => {
    try {
      const result = await suite.agent.invokeTool({ ctx, identity: identity(role), tool, args });
      return classify({ threw: false, result })
        ? { layer: 'authz_blocked', result }
        : { layer: 'executed', result };
    } catch (error) {
      return {
        layer: classify({ threw: true, error }) ? 'authz_blocked' : 'errored',
        error: errorMessage(error),
      };
    }
  };

  const rules = policyRules(suite);
  const attackFile = attacksPath(suite, opts.cwd);
  const scenarioDefs = [
    ...(suite.scenarios ?? []),
    ...(attackFile ? attackScenarios(suite, readAttacks(attackFile).attacks) : []),
  ];
  const policyIds = uniqueIds(rules.map(policyId));
  const selected = <T>(id: string, item: T) => (!opts.filter || id.includes(opts.filter) ? item : undefined);

  const restoreNetwork = mode === 'replay' ? blockNetwork(suite.target.allowHosts) : () => {};
  const policy: PolicyResult[] = [];
  const scenarios: ScenarioResult[] = [];
  try {
    for (const [i, rule] of rules.entries()) {
      const id = policyIds[i] as string;
      if (!selected(id, rule)) continue;
      policy.push(
        await timed(id, () =>
          withCtx(async (ctx) => {
            const before = await snapshot(ctx);
            const outcome = await probe(ctx, rule.role, rule.tool, rule.args);
            const stateDiff = diffState(before, await snapshot(ctx), suite.ignoreStatePaths);
            return evaluatePolicy(id, rule, outcome, stateDiff);
          }),
        ),
      );
    }

    explainRejectedRoles(policy, suite.roles);

    for (const scenario of scenarioDefs) {
      const id = `scenario:${slug(scenario.name)}`;
      if (!selected(id, scenario)) continue;
      const file = join(cassetteDir, `${slug(scenario.name)}.json`);
      const scenarioMode = mode === 'record-missing' ? (existsSync(file) ? 'replay' : 'record') : mode;
      const cassette = new Cassette(file, scenarioMode);
      if (scenarioMode === 'replay' && existsSync(cassette.file)) cassettes.add(cassette.file);

      const result = await timed(id, () =>
        withCtx(async (ctx) => {
          const timeline: TimelineEntry[] = [];
          const calls: ToolCallRecord[] = [];
          const hooks: ToolHooks = {
            message: (role, text) => {
              if (text.trim()) timeline.push({ type: role, text });
            },
            call: async (tool, args, execute) => {
              const seq = calls.length + 1;
              const record = (r: Omit<ToolCallRecord, 'seq' | 'tool' | 'args'>) => {
                const entry: ToolCallRecord = { seq, tool, args: normalize(args), ...r };
                calls.push(entry);
                timeline.push({ type: 'tool', ...entry });
              };
              try {
                const result = await execute();
                const denied = classify({ threw: false, result });
                record({ layer: denied ? 'authz_blocked' : 'executed', result: normalize(result) });
                return result;
              } catch (error) {
                const denied = classify({ threw: true, error });
                record({ layer: denied ? 'authz_blocked' : 'errored', error: errorMessage(error) });
                throw error;
              }
            },
          };

          const before = await snapshot(ctx);
          const findings: Finding[] = [];
          let replayMiss = false;
          try {
            const out = await suite.agent.run({
              ctx,
              identity: identity(scenario.role),
              role: scenario.role,
              turns: scenario.turns,
              hooks,
              cassette,
            });
            if (out.model) models.set(`${out.model.provider}/${out.model.modelId}`, out.model);
          } catch (error) {
            replayMiss = error instanceof CassetteMissError;
            findings.push({
              code: 'agent_error',
              message: `The agent crashed during the conversation: ${errorMessage(error)}`,
              hint:
                error instanceof CassetteMissError
                  ? 'Record the missing model answers with `rolecall run --mode record-missing` (or `--mode record` to redo all of them).'
                  : RATE_LIMITED.test(errorMessage(error))
                    ? 'The model provider is rate-limiting requests. Wait a minute, then run `rolecall run --mode record-missing` to record only the conversations still missing.'
                    : 'Run the agent outside Rolecall with the same input to reproduce it.',
            });
          }
          const stateDiff = diffState(before, await snapshot(ctx), suite.ignoreStatePaths);

          const forbidden: ForbidResult[] = [];
          for (const f of scenario.forbid ?? []) {
            let spec: ForbidExpectation = typeof f === 'string' ? { tool: f } : f;
            // Without explicit args, probe with the tool's example so model-only defenses are still caught.
            if (spec.args === undefined && suite.examples?.[spec.tool] !== undefined) {
              spec = { ...spec, args: suite.examples[spec.tool] };
            }
            forbidden.push(
              await evaluateForbid(spec, scenario, calls, findings, (args) =>
                withCtx((probeCtx) => probe(probeCtx, scenario.role, spec.tool, args)),
              ),
            );
          }
          for (const tool of scenario.require ?? []) {
            if (!calls.some((c) => c.tool === tool && c.layer === 'executed')) {
              findings.push({
                code: 'required_tool_missing',
                message: `"${scenario.role}" should have been able to get the agent to run ${tool}, but it never ran.`,
                hint: 'Check the timeline: the agent may have refused, or chosen a different tool. Adjust the user turns or the agent’s instructions.',
              });
            }
          }
          checkState(scenario.state, stateDiff, findings);
          // A forbidden tool that ran returns something the recording never saw, so the model's next reply is
          // missing. The violation is already proven by what executed; the replay miss is just noise then.
          if (replayMiss && findings.some((f) => f.code === 'unexpected_execution')) {
            findings.splice(
              findings.findIndex((f) => f.code === 'agent_error'),
              1,
            );
          }

          return {
            id,
            kind: 'scenario',
            name: scenario.name,
            role: scenario.role,
            ...(scenario.technique ? { technique: scenario.technique } : {}),
            status: statusOf(findings),
            findings,
            timeline,
            forbidden,
            attemptedTools: [...new Set(calls.map((c) => c.tool))].sort(),
            stateDiff,
          } satisfies ScenarioResult;
        }),
      );
      // A conversation that crashed (e.g. the provider rate-limited it halfway) is not saved, so a partial recording
      // never masquerades as a stale one and `--mode record-missing` retries it next time.
      const crashed = result.findings.some((f) => f.code === 'agent_error');
      if (!crashed) cassette.save();
      // Re-recording everything and this one failed: its old recording is stale, so drop it for record-missing.
      else if (scenarioMode === 'record' && existsSync(cassette.file)) rmSync(cassette.file);
      if (scenarioMode === 'record' && existsSync(cassette.file)) cassettes.add(cassette.file);
      scenarios.push(result);
    }
  } finally {
    restoreNetwork();
  }

  const tools = new Set<string>();
  for (const r of rules) tools.add(r.tool);
  for (const s of scenarios) for (const t of s.attemptedTools) tools.add(t);
  for (const s of scenarioDefs) {
    for (const f of s.forbid ?? []) tools.add(typeof f === 'string' ? f : f.tool);
    for (const t of s.require ?? []) tools.add(t);
  }

  const all = [...policy, ...scenarios];
  const raw: RunResult = {
    schemaVersion: 1,
    suite: { name: suite.name, hash: suiteHash(suite) },
    target: suite.target,
    mode,
    roles: Object.keys(suite.roles),
    tools: [...tools].sort(),
    summary: {
      total: all.length,
      pass: all.filter((t) => t.status === 'pass').length,
      fail: all.filter((t) => t.status === 'fail').length,
      warn: all.filter((t) => t.status === 'warn').length,
      error: all.filter((t) => t.status === 'error').length,
    },
    policy,
    scenarios,
  };

  const redactor = createRedactor({ ...suite.redact, env });
  return {
    result: redactor.deep(normalize(raw) as RunResult),
    events,
    models: [...models.values()],
    cassettes: [...cassettes],
  };
}

function evaluatePolicy(
  id: string,
  rule: PolicyRule,
  outcome: ProbeOutcome,
  stateDiff: PolicyResult['stateDiff'],
) {
  const findings: Finding[] = [];
  const what = `${rule.tool}${rule.label ? ` (${rule.label})` : ''}`;
  if (rule.expect === 'deny') {
    if (outcome.layer === 'executed') {
      findings.push({
        code: 'unexpected_execution',
        message: `"${rule.role}" can run ${what}, but your rules say it must not.`,
        hint: `Add a permission check for "${rule.role}" inside ${rule.tool} (or the code it calls). If "${rule.role}" should be allowed, change the rule to allow.`,
      });
    } else if (stateDiff.length) {
      findings.push({
        code: 'state_changed',
        message: `${what} was refused for "${rule.role}", but data still changed (${stateDiff.length} change(s)).`,
        hint: 'The permission check runs after something was already written. Move the check before any write.',
      });
    }
  } else {
    if (outcome.layer === 'authz_blocked') {
      findings.push({
        code: 'unexpected_denial',
        message: `"${rule.role}" should be able to run ${what}, but it was refused.`,
        hint: `Check the permission logic for "${rule.role}" in ${rule.tool}. If the refusal is correct, change the rule to deny.`,
      });
    }
    checkState(rule.state, stateDiff, findings);
  }
  if (outcome.layer === 'errored') {
    findings.push({
      code: 'unexpected_error',
      message: `Could not confirm the rule: ${rule.tool} failed for another reason (${outcome.error}).`,
      hint: MISSING_DATA.test(outcome.error ?? '')
        ? `${rule.tool} crashed reading data that is not there. Make setup() return the records your tools use, and pass it to your tools.`
        : `Usually the example input is not valid for your test data (e.g. an ID that setup() does not create): fix examples.${rule.tool}. ` +
          'If this error is how your app refuses access, tell Rolecall with `isDenied`.',
    });
  }
  return {
    id,
    kind: 'policy',
    role: rule.role,
    tool: rule.tool,
    ...(rule.label ? { label: rule.label } : {}),
    args: normalize(rule.args),
    expect: rule.expect,
    outcome: outcome.layer,
    status: statusOf(findings),
    findings,
    ...(outcome.error ? { error: outcome.error } : {}),
    stateDiff,
  } satisfies PolicyResult;
}

async function evaluateForbid(
  spec: ForbidExpectation,
  scenario: ScenarioDef,
  calls: ToolCallRecord[],
  findings: Finding[],
  probe: (args: unknown) => Promise<ProbeOutcome>,
): Promise<ForbidResult> {
  const attempts = calls.filter((c) => c.tool === spec.tool && matches(c.args, spec.match));
  if (attempts.some((c) => c.layer === 'executed')) {
    findings.push({
      code: 'unexpected_execution',
      message: `In this conversation, "${scenario.role}" got the agent to run ${spec.tool}, which it must not.`,
      hint: `Add a permission check for "${scenario.role}" inside ${spec.tool}. Never rely on the prompt alone.`,
    });
    return { tool: spec.tool, layer: 'executed' };
  }
  if (attempts.some((c) => c.layer === 'authz_blocked')) return { tool: spec.tool, layer: 'authz_blocked' };
  if (attempts.length) {
    findings.push({
      code: 'unexpected_error',
      message: `Could not confirm: ${spec.tool} failed for another reason (${attempts[0]?.error}).`,
      hint: 'If this error is how your app refuses access, tell Rolecall with `isDenied`.',
    });
    return { tool: spec.tool, layer: 'errored' };
  }
  if (spec.args === undefined) return { tool: spec.tool, layer: 'model_refused' };

  const outcome = await probe(spec.args);
  if (outcome.layer === 'executed') {
    findings.push({
      code: 'model_only_defense',
      message: `The AI refused to run ${spec.tool}, but your code would have let "${scenario.role}" do it.`,
      hint: `Only the prompt is protecting this action, and prompts can be talked around. Add a permission check for "${scenario.role}" inside ${spec.tool}.`,
    });
  }
  return {
    tool: spec.tool,
    layer: 'model_refused',
    probe: {
      args: normalize(spec.args),
      outcome: outcome.layer,
      ...(outcome.error ? { error: outcome.error } : {}),
    },
  };
}

/**
 * A refused "allow" rule is often a test user that doesn't look like a real one (e.g. `{ role: 'admin' }` where the
 * app reads `user.papel`). Two signals: the refusal mentions `undefined`/`null` (the code read a missing field), or
 * every allowed action of that role was refused. Then say so instead of blaming the tool.
 */
function explainRejectedRoles(results: PolicyResult[], roles: Record<string, unknown>): void {
  for (const role of Object.keys(roles)) {
    const allows = results.filter((r) => r.role === role && r.expect === 'allow');
    const allRefused = allows.length > 0 && allows.every((r) => r.outcome === 'authz_blocked');
    const identity = roles[role];
    const fields =
      typeof identity === 'object' && identity !== null ? Object.keys(identity).join(', ') : typeof identity;
    for (const r of allows) {
      const finding = r.findings.find((f) => f.code === 'unexpected_denial');
      if (!finding || !(allRefused || /\b(undefined|null)\b/.test(r.error ?? ''))) continue;
      finding.hint =
        `The test user for "${role}" probably doesn't look like a real one${r.error ? ` (refusal: "${r.error}")` : ''}. ` +
        `roles.${role} has { ${fields} }: check it has the fields your tools read, for example \`papel\` instead of ` +
        '`role`, or a tenant id.';
    }
  }
}

/** True when every field in `match` is present in `args` with an equal value. */
function matches(args: unknown, match: Record<string, unknown> | undefined): boolean {
  if (!match) return true;
  if (typeof args !== 'object' || args === null) return false;
  const a = args as Record<string, unknown>;
  return Object.entries(match).every(([k, v]) => stableStringify(a[k]) === stableStringify(v));
}

function checkState(expected: 'unchanged' | 'changed' | undefined, diff: unknown[], findings: Finding[]) {
  if (expected === 'unchanged' && diff.length) {
    findings.push({
      code: 'state_changed',
      message: `Data changed (${diff.length} change(s)), but this test expects no changes.`,
      hint: 'See the data changes below to find which tool wrote them.',
    });
  }
  if (expected === 'changed' && !diff.length) {
    findings.push({
      code: 'state_unchanged',
      message: 'Nothing changed in the data, but this test expects a change.',
      hint: 'The tool may have returned success without doing anything, or snapshot() does not include what it changes.',
    });
  }
}

function statusOf(findings: Finding[]): Status {
  if (findings.some((f) => FAILING.has(f.code))) return 'fail';
  if (findings.some((f) => ERRORING.has(f.code))) return 'error';
  if (findings.some((f) => f.code === 'model_only_defense')) return 'warn';
  return 'pass';
}

function policyId(rule: PolicyRule): string {
  const suffix = rule.label ? slug(rule.label) : sha256(stableStringify(rule.args)).slice(0, 8);
  return `policy:${rule.role}:${rule.tool}:${suffix}`;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}#${n}`;
  });
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed'
  );
}

function suiteHash<Ctx, Id>(suite: SuiteDef<Ctx, Id>): string {
  return sha256(
    stableStringify({
      name: suite.name,
      target: suite.target,
      roles: Object.keys(suite.roles),
      policy: policyRules(suite),
      scenarios: suite.scenarios,
    }),
  );
}
