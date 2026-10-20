import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTsconfig, projectLoader, tsconfigAliases } from '../src/loader.js';

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'rolecall-loader-'));
  const file = (path: string, body: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  file(
    'tsconfig.json',
    '{\n  // a comment\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "~cfg": ["./config.ts"], }, },\n}',
  );
  file('config.ts', 'export const name = "cfg";\n');
  file('src/util/greet.ts', "import 'server-only';\nexport const greet = (n: string) => 'hi ' + n;\n");
  file(
    'suite/entry.ts',
    "import { greet } from '@/util/greet';\nimport { name } from '~cfg';\nexport default greet(name);\n",
  );
  return dir;
}

describe('project loader', () => {
  it('reads tsconfig paths, including comments and trailing commas', () => {
    const dir = project();
    expect(findTsconfig(join(dir, 'suite'))).toBe(join(dir, 'tsconfig.json'));
    expect(tsconfigAliases(join(dir, 'tsconfig.json'))).toEqual({
      '@/': `${join(dir, 'src')}/`,
      '~cfg': join(dir, 'config.ts'),
    });
  });

  it('resolves path aliases and stubs server-only, so Next.js code loads outside Next.js', async () => {
    const dir = project();
    const entry = join(dir, 'suite/entry.ts');
    const mod = await projectLoader(entry).import<{ default: string }>(entry);
    expect(mod.default).toBe('hi cfg');
  });
});
