import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { policyRules } from './define.js';
import { sha256 } from './hash.js';
import type { Attack, AttackFile, ScenarioDef, SuiteDef } from './types.js';

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

export function attackId(a: Omit<Attack, 'id'>): string {
  return sha256(`${a.role}\u0000${a.tool}\u0000${a.message}`).slice(0, 10);
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
      name: `Attack ${a.id}: ${a.role} → ${a.tool} (${a.technique})`,
      role: a.role,
      turns: [a.message],
      forbid: [a.tool],
      technique: a.technique,
    }));
}
