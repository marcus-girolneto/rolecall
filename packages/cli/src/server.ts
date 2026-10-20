import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { DashboardBootstrap } from '@rolecall/core';
import { listRuns, loadRunDetail } from './runs.js';

// dist/ui/index.html when built; ../dist/ui/index.html when running from src (tests, tsx).
const UI_CANDIDATES = [
  new URL('./ui/index.html', import.meta.url),
  new URL('../dist/ui/index.html', import.meta.url),
];

/** The dashboard page with bootstrap data injected. Script-breaking sequences are escaped. */
export function renderDashboard(bootstrap: DashboardBootstrap): string {
  const file = UI_CANDIDATES.find((u) => existsSync(u));
  if (!file)
    throw new Error(
      'Dashboard HTML not found. Build it with `pnpm --filter @rolecall/ui build && pnpm --filter rolecall build`.',
    );
  const html = readFileSync(file, 'utf8');
  const json = JSON.stringify(bootstrap).replace(
    /[<\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  // A function replacement: run data may contain $&, $' or $` which a string replacement would expand.
  return html.replace('<!--rolecall:bootstrap-->', () => `<script>window.__ROLECALL__=${json}</script>`);
}

/** Local dashboard over the runs directory. Binds to loopback only. */
export function startDashboard(runsDir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    };
    const json = (status: number, body: unknown) => send(status, 'application/json', JSON.stringify(body));
    try {
      // Only answer requests addressed to this machine, so a web page using DNS rebinding cannot read run data.
      const host = (req.headers.host ?? '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        return json(421, { error: 'unexpected host' });
      if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
      if (url.pathname === '/api/runs') return json(200, listRuns(runsDir));
      const match = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
      if (match?.[1]) {
        const detail = loadRunDetail(runsDir, match[1]);
        return detail ? json(200, detail) : json(404, { error: 'run not found' });
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'not found' });
      return send(200, 'text/html; charset=utf-8', renderDashboard({ mode: 'local', apiBase: '/api' }));
    } catch (e) {
      return json(500, { error: String(e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
