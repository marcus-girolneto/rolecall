import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type Attack,
  type AttackFile,
  type AttackTarget,
  attackTargets,
  DEFAULT_ATTACKS_FILE,
  type SuiteDef,
  type ToolInfo,
} from '@rolecall/core';
import { createJiti } from 'jiti';

/** The parts of @rolecall/ai-sdk the attacks command needs, loaded from the user's project. */
export interface AttackGenerator {
  generateAttacks(opts: {
    model: unknown;
    cells: AttackTarget[];
    tools: ToolInfo[];
    examples?: Record<string, unknown>;
    perCell?: number;
    appContext?: string;
    onProgress?: (done: number, total: number, cell: AttackTarget) => void;
  }): Promise<{ attacks: Attack[]; failures: Array<AttackTarget & { error: string }> }>;
  openRouterModel(modelId: string): unknown;
}

export async function loadGenerator(cwd: string): Promise<AttackGenerator> {
  const jiti = createJiti(join(cwd, 'rolecall.suite.ts'));
  try {
    return await jiti.import<AttackGenerator>('@rolecall/ai-sdk');
  } catch {
    throw new Error('`rolecall attacks` needs @rolecall/ai-sdk in this project: npm i -D @rolecall/ai-sdk');
  }
}

export interface AttackRunOptions {
  cwd: string;
  suite: SuiteDef<unknown, unknown>;
  generator: AttackGenerator;
  model: unknown;
  modelId: string;
  perCell: number;
  out?: string;
  appContext?: string;
  log: (line: string) => void;
}

/** Generates attacks for every denied cell of the suite and writes them where `rolecall run` picks them up. */
export async function generateAttackFile(
  opts: AttackRunOptions,
): Promise<{ file: string; count: number; failed: number }> {
  const { suite } = opts;
  const cells = attackTargets(suite);
  if (!cells.length)
    throw new Error('Nothing to attack: the suite has no "deny" cells in `permissions` or `policy`.');

  const ctx = await suite.setup();
  let tools: ToolInfo[] = [];
  try {
    const firstRole = Object.keys(suite.roles)[0] as string;
    const raw = suite.roles[firstRole];
    const identity = typeof raw === 'function' ? (raw as () => unknown)() : raw;
    tools = (await suite.agent.describeTools?.({ ctx, identity })) ?? [];
  } finally {
    await suite.teardown?.(ctx);
  }
  if (!tools.length) tools = [...new Set(cells.map((c) => c.tool))].map((name) => ({ name }));

  opts.log(
    `Writing ${opts.perCell} attacks for each of ${cells.length} blocked actions with ${opts.modelId}…`,
  );
  const result = await opts.generator.generateAttacks({
    model: opts.model,
    cells,
    tools,
    ...(suite.examples ? { examples: suite.examples } : {}),
    perCell: opts.perCell,
    ...(opts.appContext ? { appContext: opts.appContext } : {}),
    onProgress: (done, total, cell) => {
      if (done < total)
        opts.log(
          `  [${done + 1}/${total}] ${cell.role} → ${cell.tool}${cell.label ? ` (${cell.label})` : ''}`,
        );
    },
  });
  for (const f of result.failures) opts.log(`  ✖ ${f.role} → ${f.tool}: ${f.error}`);

  const file = resolve(
    opts.cwd,
    opts.out ?? (typeof suite.attacks === 'string' ? suite.attacks : DEFAULT_ATTACKS_FILE),
  );
  const body: AttackFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: opts.modelId,
    attacks: result.attacks,
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { file, count: result.attacks.length, failed: result.failures.length };
}
