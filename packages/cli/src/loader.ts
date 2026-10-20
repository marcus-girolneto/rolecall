import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createJiti, type Jiti } from 'jiti';

/** Next.js marker packages that throw outside their framework; in a test run they are empty modules. */
const FRAMEWORK_STUBS = ['server-only', 'client-only'];

/** Finds the tsconfig.json that governs `fromDir`, walking up to the filesystem root. */
export function findTsconfig(fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** tsconfig is JSON with comments and trailing commas. */
function parseJsonc(text: string): unknown {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_m, str) => str ?? '');
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'));
}

/** `compilerOptions.paths` (e.g. "@/*": ["./*"]) as module aliases, following one level of `extends`. */
export function tsconfigAliases(tsconfigFile: string): Record<string, string> {
  const read = (
    file: string,
  ): { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }; extends?: string } => {
    try {
      return parseJsonc(readFileSync(file, 'utf8')) as never;
    } catch {
      return {};
    }
  };
  const config = read(tsconfigFile);
  let base: ReturnType<typeof read> = {};
  if (typeof config.extends === 'string' && config.extends.startsWith('.')) {
    base = read(
      resolve(
        dirname(tsconfigFile),
        config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`,
      ),
    );
  }
  const options = { ...base.compilerOptions, ...config.compilerOptions };
  const root = resolve(dirname(tsconfigFile), options.baseUrl ?? '.');
  const aliases: Record<string, string> = {};
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const target = targets[0];
    if (!target) continue;
    if (pattern.endsWith('/*') && target.endsWith('/*')) {
      aliases[pattern.slice(0, -1)] = `${resolve(root, target.slice(0, -2))}/`;
    } else if (!pattern.includes('*')) {
      aliases[pattern] = resolve(root, target);
    }
  }
  return aliases;
}

let stubFile: string | undefined;
function emptyModule(): string {
  if (!stubFile) {
    stubFile = join(tmpdir(), `rolecall-empty-module-${process.pid}.mjs`);
    writeFileSync(stubFile, 'export {};\n');
  }
  return stubFile;
}

/** A TypeScript loader that resolves the project's path aliases and stubs framework-only marker packages. */
export function projectLoader(entryFile: string): Jiti {
  const tsconfig = findTsconfig(dirname(entryFile));
  const alias: Record<string, string> = tsconfig ? tsconfigAliases(tsconfig) : {};
  for (const name of FRAMEWORK_STUBS) alias[name] = emptyModule();
  return createJiti(entryFile, { moduleCache: false, alias });
}
