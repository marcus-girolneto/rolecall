// Copies the built dashboard (apps/ui) into the CLI's dist. Falls back to a minimal page if the UI is not built.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const src = new URL('../../../apps/ui/dist/index.html', import.meta.url);
const dest = new URL('../dist/ui/index.html', import.meta.url);
mkdirSync(new URL('../dist/ui/', import.meta.url), { recursive: true });
if (existsSync(src)) {
  copyFileSync(src, dest);
} else {
  writeFileSync(
    dest,
    '<!doctype html><meta charset="utf-8"><title>Rolecall</title><!--rolecall:bootstrap--><p>Dashboard not built. Run <code>pnpm --filter @rolecall/ui build</code>.</p>',
  );
  console.warn('copy-ui: apps/ui/dist/index.html not found; wrote a placeholder');
}
