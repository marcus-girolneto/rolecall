// Copies the built dashboard (apps/ui) into dist so the API can serve it at /app.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const src = new URL('../../ui/dist/index.html', import.meta.url);
const destDir = new URL('../dist/dashboard/', import.meta.url);
mkdirSync(destDir, { recursive: true });
if (existsSync(src)) copyFileSync(src, new URL('index.html', destDir));
else console.warn('copy-ui: apps/ui/dist/index.html not found; /app will return 503 until the UI is built');
