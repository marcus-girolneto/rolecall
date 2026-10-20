import type {
  DiffEntry,
  Expectation,
  Finding,
  ForbidResult,
  Layer,
  PolicyResult,
  RunResult,
  RunSummary,
  ScenarioResult,
  Status,
  TestResult,
} from '@rolecall/core';

/** Severity order used across the UI (mirrors core's compare ranking). */
export const RANK: Record<Status, number> = { pass: 0, warn: 1, error: 2, fail: 3 };

export function worst(statuses: Iterable<Status>): Status {
  let w: Status = 'pass';
  for (const s of statuses) if (RANK[s] > RANK[w]) w = s;
  return w;
}

export function summaryStatus(s: RunSummary): Status {
  if (s.fail > 0) return 'fail';
  if (s.error > 0) return 'error';
  if (s.warn > 0) return 'warn';
  return 'pass';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Headline for a run, e.g. "3 violations · 1 warning" or "All roles held". */
export function verdict(s: RunSummary): { status: Status; text: string } {
  const parts: string[] = [];
  if (s.fail) parts.push(plural(s.fail, 'permission problem', 'permission problems'));
  if (s.error) parts.push(`${s.error} not checked`);
  if (s.warn) parts.push(`${s.warn} protected only by the AI`);
  if (s.total === 0) return { status: 'pass', text: 'No checks' };
  return { status: summaryStatus(s), text: parts.length ? parts.join(' · ') : 'Every role holds' };
}

/** Local mirror of core's `titleOf` (the UI imports types only). */
export function titleOf(t: TestResult): string {
  return t.kind === 'policy'
    ? `${t.role} → ${t.tool}${t.label ? ` (${t.label})` : ''}: should be ${t.expect === 'deny' ? 'blocked' : 'allowed'}`
    : t.name;
}

export function allTests(r: RunResult): TestResult[] {
  return [...r.policy, ...r.scenarios];
}

export function findTest(r: RunResult, id: string): TestResult | undefined {
  return allTests(r).find((t) => t.id === id);
}

export interface MatrixCell {
  role: string;
  tool: string;
  tests: PolicyResult[];
  status: Status | null;
  expect: Expectation | 'mixed' | null;
  failing: number;
}

export interface Matrix {
  roles: string[];
  tools: string[];
  cells: Map<string, MatrixCell>;
}

export const cellKey = (role: string, tool: string) => `${role}\u0000${tool}`;

/** Aggregates policy results into a roles × tools grid. */
export function buildMatrix(r: RunResult): Matrix {
  const roles = [...r.roles];
  const tools = [...r.tools];
  for (const p of r.policy) {
    if (!roles.includes(p.role)) roles.push(p.role);
    if (!tools.includes(p.tool)) tools.push(p.tool);
  }
  const cells = new Map<string, MatrixCell>();
  for (const role of roles) {
    for (const tool of tools) {
      const tests = r.policy.filter((p) => p.role === role && p.tool === tool);
      const expects = new Set(tests.map((t) => t.expect));
      cells.set(cellKey(role, tool), {
        role,
        tool,
        tests,
        status: tests.length ? worst(tests.map((t) => t.status)) : null,
        expect: expects.size === 0 ? null : expects.size > 1 ? 'mixed' : (tests[0]?.expect ?? null),
        failing: tests.filter((t) => t.status !== 'pass').length,
      });
    }
  }
  return { roles, tools, cells };
}

/** Non-pass tests, most severe first. */
export function nonPassing(r: RunResult): TestResult[] {
  return allTests(r)
    .filter((t) => t.status !== 'pass')
    .sort((a, b) => RANK[b.status] - RANK[a.status]);
}

export const LAYER_LABEL: Record<Layer, string> = {
  model_refused: 'AI refused',
  authz_blocked: 'blocked by your code',
  executed: 'ran',
  errored: 'could not run',
};

/**
 * Judges a forbidden-tool outcome. A forbidden tool must not take effect:
 * authz blocking it is the real defense; the model refusing is only as good as the probe.
 */
export function forbidStatus(f: ForbidResult): Status {
  if (f.layer === 'executed') return 'fail';
  if (f.layer === 'errored') return 'error';
  if (f.layer === 'model_refused' && f.probe) {
    if (f.probe.outcome === 'executed') return 'warn';
    if (f.probe.outcome === 'errored') return 'error';
  }
  return 'pass';
}

/** Status color for a layer outcome given what was expected (deny / allow / neutral context). */
export function layerStatus(layer: Layer, expect: Expectation | null): Status | null {
  if (layer === 'errored') return 'error';
  if (expect === 'deny') return layer === 'executed' ? 'fail' : 'pass';
  if (expect === 'allow') return layer === 'executed' ? 'pass' : 'fail';
  return null;
}

export function sortFindings(fs: Finding[]): Finding[] {
  const sev = (f: Finding) =>
    f.code === 'model_only_defense' ? 1 : f.code === 'agent_error' || f.code === 'unexpected_error' ? 2 : 3;
  return [...fs].sort((a, b) => sev(b) - sev(a));
}

export const FINDING_LABEL: Record<Finding['code'], string> = {
  unexpected_execution: 'Allowed when it should be blocked',
  unexpected_denial: 'Blocked when it should be allowed',
  unexpected_error: 'Could not be checked',
  state_changed: 'Data changed',
  state_unchanged: 'Nothing changed',
  required_tool_missing: 'Expected action never happened',
  model_only_defense: 'Only the AI is protecting this',
  agent_error: 'The agent crashed',
};

export function forbiddenTools(s: ScenarioResult): Set<string> {
  return new Set(s.forbidden.map((f) => f.tool));
}

export function diffCounts(d: DiffEntry[]) {
  return {
    added: d.filter((e) => e.kind === 'added').length,
    removed: d.filter((e) => e.kind === 'removed').length,
    changed: d.filter((e) => e.kind === 'changed').length,
  };
}
