import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { sha256, stableStringify } from './hash.js';
import type { CassetteHandle, RunMode } from './types.js';

export class CassetteMissError extends Error {
  override name = 'CassetteMissError';
}

interface CassetteFile {
  version: 1;
  entries: Record<string, unknown>;
}

/** A per-scenario recording of model responses, keyed by a hash of the normalized request. */
export class Cassette implements CassetteHandle {
  private entries: Record<string, unknown> = {};
  private dirty = false;

  constructor(
    readonly file: string,
    readonly mode: RunMode,
  ) {
    if (mode === 'replay' && existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as CassetteFile;
      this.entries = parsed.entries ?? {};
    }
  }

  static key(request: unknown): string {
    return sha256(stableStringify(request));
  }

  lookup(request: unknown): unknown | undefined {
    if (this.mode !== 'replay') return undefined;
    const key = Cassette.key(request);
    if (!(key in this.entries)) {
      throw new CassetteMissError(
        existsSync(this.file)
          ? `No recorded model response in ${basename(this.file)} for request ${key.slice(0, 12)}: the prompt, tools, ` +
              'code or settings changed since it was recorded. Record again with `rolecall run --mode record`.'
          : `This conversation has not been recorded yet (${basename(this.file)}). ` +
              'Record it with `rolecall run --mode record-missing`.',
      );
    }
    return this.entries[key];
  }

  store(request: unknown, response: unknown): void {
    if (this.mode !== 'record') return;
    this.entries[Cassette.key(request)] = response;
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(this.entries).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      this.file,
      `${JSON.stringify({ version: 1, entries: sorted } satisfies CassetteFile, null, 2)}\n`,
    );
  }
}
