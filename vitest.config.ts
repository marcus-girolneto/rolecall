import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@rolecall/core': src('./packages/core/src/index.ts'),
      '@rolecall/ai-sdk': src('./packages/ai-sdk/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
