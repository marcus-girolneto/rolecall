import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DashboardPage } from '../src/modules/dashboard/page.js';
import { createTestApp, makeBundle, type TestContext } from './helpers.js';

const TEMPLATE =
  '<!doctype html><html><head><!--rolecall:bootstrap--><script type="module">console.log("app")</script></head><body></body></html>';

describe('hosted dashboard', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp({}, { dashboard: new DashboardPage(() => TEMPLATE) });
  });
  afterAll(async () => t?.close());

  it('serves the dashboard in cloud mode with a hash-based CSP and no data', async () => {
    const res = await t.app.inject('/app');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('window.__ROLECALL__={"mode":"cloud","apiBase":"/v1"}');
    expect(res.body).not.toContain('<!--rolecall:bootstrap-->');

    const csp = String(res.headers['content-security-policy']);
    expect(csp).not.toContain("'unsafe-inline' 'sha256"); // scripts are allowed by hash, not unsafe-inline
    expect(csp).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+'){2}/);
    const bootstrap = res.body.match(/<script>(window\.__ROLECALL__=[^<]*)<\/script>/)?.[1] ?? '';
    expect(csp).toContain(`'sha256-${createHash('sha256').update(bootstrap).digest('base64')}'`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('redirects run links from `rolecall push` into the dashboard', async () => {
    const res = await t.app.inject('/runs/run_abc123');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/app#/runs/run_abc123');
    expect((await t.app.inject('/runs/..%2Fetc')).statusCode).toBe(400);
  });

  it('returns 503 when the dashboard assets are missing', async () => {
    const bare = await createTestApp({}, { dashboard: new DashboardPage(() => null) });
    try {
      const res = await bare.app.inject('/app');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'dashboard_unavailable' } });
    } finally {
      await bare.close();
    }
  });
});

describe('plan retention', () => {
  it('deletes runs older than the plan allows when a new run arrives', async () => {
    let now = new Date('2026-10-01T12:00:00Z');
    const t = await createTestApp({}, { clock: { now: () => now } });
    try {
      const signup = await t.app.inject({
        method: 'POST',
        url: '/v1/signup',
        payload: { orgName: 'Keeper', email: 'keeper@example.com' },
      });
      const key = { authorization: `Bearer ${signup.json().apiKey.key}` };
      const upload = async (buggy: boolean) =>
        t.app.inject({ method: 'POST', url: '/v1/runs', headers: key, payload: await makeBundle({ buggy }) });
      const first = (await upload(false)).json().id;

      now = new Date('2026-10-20T12:00:00Z'); // 19 days later; the free plan keeps 14
      expect((await upload(true)).statusCode).toBe(201);

      const ids = (await t.app.inject({ method: 'GET', url: '/v1/runs', headers: key }))
        .json()
        .runs.map((r: { id: string }) => r.id);
      expect(ids).toHaveLength(1);
      expect(ids).not.toContain(first);
    } finally {
      await t.close();
    }
  });
});
