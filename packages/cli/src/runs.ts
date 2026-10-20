import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareRuns,
  MANIFEST_FILE,
  type RunDetail,
  type RunListItem,
  readBundle,
  verifyBundle,
} from '@rolecall/core';

/** Bundles under `runsDir`, newest first. Directories without a manifest are skipped. */
export function listRuns(runsDir: string): RunListItem[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(runsDir, d.name, MANIFEST_FILE)))
    .map((d) => {
      const dir = join(runsDir, d.name);
      const { manifest } = readBundle(dir);
      const verify = verifyBundle(dir);
      return {
        id: manifest.runId,
        createdAt: manifest.createdAt,
        suite: { name: manifest.suite.name, hash: manifest.suite.hash },
        mode: manifest.mode,
        summary: manifest.summary,
        git: manifest.git,
        signed: verify.signed,
        verified: verify.ok,
      } satisfies RunListItem;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Full detail for one run, compared with the previous run of the same suite. */
export function loadRunDetail(runsDir: string, runId: string): RunDetail | undefined {
  const dir = join(runsDir, runId);
  if (!/^[\w-]+$/.test(runId) || !existsSync(join(dir, MANIFEST_FILE))) return undefined;
  const { manifest, result } = readBundle(dir);
  const detail: RunDetail = { manifest, result, verify: verifyBundle(dir) };
  const previous = listRuns(runsDir).find(
    (r) => r.suite.name === manifest.suite.name && r.createdAt < manifest.createdAt,
  );
  if (previous) {
    detail.baseline = {
      runId: previous.id,
      comparison: compareRuns(result, readBundle(join(runsDir, previous.id)).result),
    };
  }
  return detail;
}
