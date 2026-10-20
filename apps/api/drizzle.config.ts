import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @rolecall/api db:generate` diffs src/db/schema.ts against drizzle/ and writes a new SQL migration.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
