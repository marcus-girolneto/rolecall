import type { RunResult, Status, TestResult } from './types.js';

export interface StatusChange {
  id: string;
  title: string;
  from: Status;
  to: Status;
}

export interface RunComparison {
  regressions: StatusChange[];
  fixes: StatusChange[];
  added: string[];
  removed: string[];
  /** Tools a scenario's agent attempted now but not in the baseline. */
  newlyAttempted: Array<{ id: string; tools: string[] }>;
}

const RANK: Record<Status, number> = { pass: 0, warn: 1, error: 2, fail: 3 };

export function compareRuns(current: RunResult, baseline: RunResult): RunComparison {
  const index = (r: RunResult) =>
    new Map<string, TestResult>([...r.policy, ...r.scenarios].map((t) => [t.id, t]));
  const now = index(current);
  const before = index(baseline);
  const out: RunComparison = { regressions: [], fixes: [], added: [], removed: [], newlyAttempted: [] };

  for (const [id, test] of now) {
    const prev = before.get(id);
    if (!prev) {
      out.added.push(id);
      continue;
    }
    const change = { id, title: titleOf(test), from: prev.status, to: test.status };
    if (RANK[test.status] > RANK[prev.status]) out.regressions.push(change);
    else if (RANK[test.status] < RANK[prev.status]) out.fixes.push(change);
    if (test.kind === 'scenario' && prev.kind === 'scenario') {
      const fresh = test.attemptedTools.filter((t) => !prev.attemptedTools.includes(t));
      if (fresh.length) out.newlyAttempted.push({ id, tools: fresh });
    }
  }
  for (const id of before.keys()) if (!now.has(id)) out.removed.push(id);
  return out;
}

export function titleOf(test: TestResult): string {
  return test.kind === 'policy'
    ? `${test.role} → ${test.tool}${test.label ? ` (${test.label})` : ''}: should be ${test.expect === 'deny' ? 'blocked' : 'allowed'}`
    : test.name;
}
