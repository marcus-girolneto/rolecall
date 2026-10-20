import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      // Types only: the UI never imports runtime code from core.
      '@rolecall/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  // Nothing in public/ is needed at runtime; the build is one self-contained file.
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false },
});
