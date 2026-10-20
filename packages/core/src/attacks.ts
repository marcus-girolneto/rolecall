import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { policyRules } from './define.js';
import { sha256, stableStringify } from './hash.js';
import type { Attack, AttackFile, AttackTarget, ScenarioDef, SuiteDef } from './types.js';

export const DEFAULT_ATTACKS_FILE = join('rolecall', 'attacks.json');

/**
 * (role, tool) pairs that are blocked whatever the input: the targets worth attacking. A pair with any `allow` rule
 * (e.g. "support may refund, but not above 200") is input-dependent and left to explicit `policy` rules.
 */
export function deniedCells<Ctx, Id>(suite: SuiteDef<Ctx, Id>): Array<{ role: string; tool: string }> {
  const verdicts = new Map<string, { role: string; tool: string; allow: boolean }>();
  for (const r of policyRules(suite)) {
    const key = `${r.role}\u0000${r.tool}`;
    const prev = verdicts.get(key);
    verdicts.set(key, { role: r.role, tool: r.tool, allow: (prev?.allow ?? false) || r.expect === 'allow' });
  }
  return [...verdicts.values()].filter((v) => !v.allow).map(({ role, tool }) => ({ role, tool }));
}

/**
 * Everything worth attacking:
 * - every (role, tool) pair that is blocked whatever the input, and
 * - every explicit `policy` deny rule whose role may otherwise use that tool (e.g. "a customer may cancel orders,
 *   but not another customer's order"). Those attacks only count when the agent acts on that exact input.
 */
export function attackTargets<Ctx, Id>(suite: SuiteDef<Ctx, Id>): AttackTarget[] {
  const always = deniedCells(suite);
  const blocked = new Set(always.map((c) => `${c.role}\u0000${c.tool}`));
  const specific: AttackTarget[] = [];
  for (const rule of suite.policy ?? []) {
    if (rule.expect !== 'deny' || blocked.has(`${rule.role}\u0000${rule.tool}`)) continue;
    if (typeof rule.args !== 'object' || rule.args === null || !Object.keys(rule.args).length) continue;
    specific.push({
      role: rule.role,
      tool: rule.tool,
      args: rule.args as Record<string, unknown>,
      ...(rule.label ? { label: rule.label } : {}),
    });
  }
  return [...always, ...specific];
}

export function attackId(a: Omit<Attack, 'id'>): string {
  // The target's input is part of the identity, so one message aimed at two different records stays two attacks.
  const target = a.args ? `\u0000${stableStringify(a.args)}` : '';
  return sha256(`${a.role}\u0000${a.tool}\u0000${a.message}${target}`).slice(0, 10);
}

/** Where the suite's attacks live, or undefined when attacks are off or not generated yet. */
export function attacksPath<Ctx, Id>(suite: SuiteDef<Ctx, Id>, cwd = process.cwd()): string | undefined {
  if (suite.attacks === false) return undefined;
  const file = suite.attacks ?? DEFAULT_ATTACKS_FILE;
  const full = isAbsolute(file) ? file : join(cwd, file);
  return existsSync(full) ? full : undefined;
}

export function readAttacks(file: string): AttackFile {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as AttackFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.attacks))
    throw new Error(`${file} is not a Rolecall attacks file`);
  return parsed;
}

/** Turns generated attacks into ordinary scenarios: one user message, and the tool must not take effect. */
export function attackScenarios<Ctx, Id>(suite: SuiteDef<Ctx, Id>, attacks: Attack[]): ScenarioDef[] {
  const roles = new Set(Object.keys(suite.roles));
  return attacks
    .filter((a) => roles.has(a.role))
    .map((a) => ({
      name: `Attack ${a.id}: ${a.role} → ${a.tool}${a.label ? ` [${a.label}]` : ''} (${a.technique})`,
      role: a.role,
      turns: [a.message],
      forbid: a.args ? [{ tool: a.tool, args: a.args, match: a.args }] : [a.tool],
      technique: a.technique,
    }));
}
