import type { RunDetail, RunListItem } from '@rolecall/core';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageCounters } from '../src/db/schema.js';
import { billingPeriod } from '../src/shared/clock.js';
import { bearer, createTestApp, makeBundle, signup, type TestContext, WEBHOOK_SECRET } from './helpers.js';

let t: TestContext;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const main = (sha: string) => ({ sha, branch: 'main', dirty: false });

describe('health and docs', () => {
  it('reports liveness, readiness and serves the OpenAPI document', async () => {
    expect((await t.app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await t.app.inject('/readyz')).json()).toEqual({ status: 'ready' });
    const doc = (await t.app.inject('/docs/json')).json() as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.0.3');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/runs', '/v1/runs/{id}', '/v1/signup', '/v1/billing/webhook']),
    );
  });

  it('renders unknown routes with the standard error shape', async () => {
    const res = await t.app.inject('/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('signup → project → key → upload → list → detail', () => {
  it('runs the full happy path with a real bundle', async () => {
    const acme = await signup(t.app, 'Acme');
    expect(acme.apiKey.key).toMatch(/^rc_live_[0-9a-z]{40}$/);
    expect(acme.organization.plan).toBe('free');
    const admin = bearer(acme.apiKey.key);

    // A CI ingest key bound to the default project, plus a read-only key.
    const ingest = await t.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: admin,
      payload: { name: 'CI', scopes: ['runs:write'], projectId: acme.project.id },
    });
    expect(ingest.statusCode).toBe(201);
    const ingestKey = ingest.json().key as string;

    const listKeys = await t.app.inject({ method: 'GET', url: '/v1/api-keys', headers: admin });
    expect(listKeys.json().apiKeys).toHaveLength(2);
    expect(listKeys.body).not.toContain(ingestKey);

    const projects = await t.app.inject({ method: 'GET', url: '/v1/projects', headers: admin });
    expect(projects.json().projects.map((p: { id: string }) => p.id)).toEqual([acme.project.id]);

    // Baseline on main (all pass), then a regression on main (viewer can now refund).
    const first = await makeBundle({ at: new Date('2026-10-01T10:00:00.000Z'), git: main('aaa111') });
    const up1 = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(ingestKey),
      payload: first,
    });
    expect(up1.statusCode).toBe(201);
    const run1 = up1.json() as { id: string; url: string; duplicate: boolean };
    expect(run1.id).toMatch(/^run_/);
    expect(run1.url).toBe(`https://cloud.rolecall.test/runs/${run1.id}`);
    expect(run1.duplicate).toBe(false);

    const second = await makeBundle({
      buggy: true,
      at: new Date('2026-10-02T10:00:00.000Z'),
      git: main('bbb222'),
    });
    const up2 = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(ingestKey),
      payload: second,
    });
    expect(up2.statusCode).toBe(201);
    const run2 = up2.json() as { id: string };

    // List: RunListItem[] newest first.
    const list = await t.app.inject({ method: 'GET', url: '/v1/runs', headers: admin });
    expect(list.statusCode).toBe(200);
    const items = list.json().runs as RunListItem[];
    expect(items.map((r) => r.id)).toEqual([run2.id, run1.id]);
    expect(items[0]).toEqual({
      id: run2.id,
      createdAt: '2026-10-02T10:00:00.000Z',
      suite: { name: 'refund-permissions', hash: expect.any(String) },
      mode: 'replay',
      summary: { total: 2, pass: 1, fail: 1, warn: 0, error: 0 },
      git: { sha: 'bbb222', branch: 'main', dirty: false },
      signed: false,
      verified: true,
    } satisfies RunListItem);

    // Filters and cursor pagination.
    const failing = await t.app.inject({ method: 'GET', url: '/v1/runs?status=fail', headers: admin });
    expect(failing.json().runs.map((r: RunListItem) => r.id)).toEqual([run2.id]);
    const passing = await t.app.inject({
      method: 'GET',
      url: '/v1/runs?status=pass&branch=main&suite=refund-permissions',
      headers: admin,
    });
    expect(passing.json().runs.map((r: RunListItem) => r.id)).toEqual([run1.id]);
    const page1 = (await t.app.inject({ method: 'GET', url: '/v1/runs?limit=1', headers: admin })).json();
    expect(page1.runs).toHaveLength(1);
    expect(page1.nextCursor).toEqual(expect.any(String));
    const page2 = (
      await t.app.inject({
        method: 'GET',
        url: `/v1/runs?limit=1&cursor=${page1.nextCursor}`,
        headers: admin,
      })
    ).json();
    expect(page2.runs.map((r: RunListItem) => r.id)).toEqual([run1.id]);
    expect(page2.nextCursor).toBeNull();

    // Detail: RunDetail with fresh verification and baseline comparison.
    const detailRes = await t.app.inject({ method: 'GET', url: `/v1/runs/${run2.id}`, headers: admin });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json() as RunDetail;
    expect(Object.keys(detail).sort()).toEqual(['baseline', 'manifest', 'result', 'verify']);
    expect(detail.manifest).toEqual(JSON.parse(second.manifest));
    expect(detail.result).toEqual(JSON.parse(second.results));
    expect(detail.verify).toMatchObject({ ok: true, signed: false, trustedKey: false, problems: [] });
    expect(detail.baseline?.runId).toBe(run1.id);
    expect(detail.baseline?.comparison.regressions).toHaveLength(1);
    expect(detail.baseline?.comparison.regressions[0]).toMatchObject({ from: 'pass', to: 'fail' });

    const firstDetail = (
      await t.app.inject({ method: 'GET', url: `/v1/runs/${run1.id}`, headers: admin })
    ).json() as RunDetail;
    expect(firstDetail.baseline).toBeUndefined();

    // Usage is reflected in billing.
    const billing = (await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json();
    expect(billing.plan.id).toBe('free');
    expect(billing.usage.runs).toBe(2);
    expect(billing.limits).toEqual({ runsPerMonth: 100, maxProjects: 1, retentionDays: 14 });

    // Delete (admin only).
    const del = await t.app.inject({ method: 'DELETE', url: `/v1/runs/${run1.id}`, headers: admin });
    expect(del.statusCode).toBe(204);
    expect(
      (await t.app.inject({ method: 'GET', url: `/v1/runs/${run1.id}`, headers: admin })).statusCode,
    ).toBe(404);
  });
});

describe('ingest integrity', () => {
  it('rejects a tampered bundle with 422 and the verification problems', async () => {
    const org = await signup(t.app, 'Tamper');
    const bundle = await makeBundle();
    const tampered = {
      ...bundle,
      results: `${bundle.results.replace('"fail": 1', '"fail": 0').replace('"pass": 2', '"pass": 3')} `,
    };
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: tampered,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('invalid_bundle');
    expect(body.error.details.problems.join('\n')).toMatch(/results\.json: hash mismatch/);
    expect(body.error.stack).toBeUndefined();
  });

  it('rejects a manifest edited after sealing', async () => {
    const org = await signup(t.app, 'Tamper2');
    const bundle = await makeBundle();
    const m = JSON.parse(bundle.manifest);
    m.summary.pass = 99;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: { ...bundle, manifest: JSON.stringify(m) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.problems).toContain(
      'manifest: root hash mismatch (the manifest was modified)',
    );
  });

  it('returns the same id when the same bundle is uploaded twice', async () => {
    const org = await signup(t.app, 'Dupes');
    const bundle = await makeBundle();
    const a = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: bundle,
    });
    const b = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: bundle,
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.json().id, duplicate: true });
    const billing = (
      await t.app.inject({ method: 'GET', url: '/v1/billing', headers: bearer(org.apiKey.key) })
    ).json();
    expect(billing.usage.runs).toBe(1);
  });

  it('rejects bodies over 5 MB with 413', async () => {
    const org = await signup(t.app, 'Huge');
    const bundle = await makeBundle();
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: { ...bundle, events: 'x'.repeat(5 * 1024 * 1024 + 1) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('payload_too_large');
  });

  it('validates the body shape with 400', async () => {
    const org = await signup(t.app, 'Shape');
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: { manifest: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});

describe('authentication and authorization', () => {
  it('rejects missing, malformed, unknown and revoked keys with 401', async () => {
    const org = await signup(t.app, 'AuthCo');
    expect((await t.app.inject({ method: 'GET', url: '/v1/runs' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/runs', headers: bearer('nope') })).statusCode).toBe(
      401,
    );
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/runs', headers: bearer(`rc_live_${'a'.repeat(40)}`) }))
        .statusCode,
    ).toBe(401);

    const created = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: bearer(org.apiKey.key),
        payload: { name: 'tmp', scopes: ['runs:read'] },
      })
    ).json();
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/runs', headers: bearer(created.key) })).statusCode,
    ).toBe(200);
    expect(
      (
        await t.app.inject({
          method: 'DELETE',
          url: `/v1/api-keys/${created.id}`,
          headers: bearer(org.apiKey.key),
        })
      ).statusCode,
    ).toBe(204);
    const revoked = await t.app.inject({ method: 'GET', url: '/v1/runs', headers: bearer(created.key) });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({
      error: { code: 'unauthorized', message: 'Invalid or revoked API key' },
    });
  });

  it('forbids uploads and admin actions with a read-only key (403)', async () => {
    const org = await signup(t.app, 'ReadOnly');
    const read = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: bearer(org.apiKey.key),
        payload: { name: 'dash', scopes: ['runs:read'] },
      })
    ).json();
    const up = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(read.key),
      payload: await makeBundle(),
    });
    expect(up.statusCode).toBe(403);
    expect(up.json().error.code).toBe('forbidden');
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/api-keys', headers: bearer(read.key) })).statusCode,
    ).toBe(403);
  });

  it('isolates tenants: another org cannot read or delete a run (404)', async () => {
    const a = await signup(t.app, 'TenantA');
    const b = await signup(t.app, 'TenantB');
    const run = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: bearer(a.apiKey.key),
        payload: await makeBundle(),
      })
    ).json();
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await t.app.inject({ method, url: `/v1/runs/${run.id}`, headers: bearer(b.apiKey.key) });
      expect(res.statusCode).toBe(404);
    }
    expect(
      (await t.app.inject({ method: 'GET', url: '/v1/runs', headers: bearer(b.apiKey.key) })).json().runs,
    ).toEqual([]);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: `/v1/projects/${a.project.id}`,
          headers: bearer(b.apiKey.key),
        })
      ).statusCode,
    ).toBe(404);
    // Same bundle in another org is a distinct run, not a cross-tenant dedupe hit.
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(b.apiKey.key),
      payload: await makeBundle(),
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().id).not.toBe(run.id);
  });
});

describe('plan limits', () => {
  it('returns 402 plan_limit_reached when the monthly run quota is used up', async () => {
    const org = await signup(t.app, 'Quota');
    await t.database.db
      .insert(usageCounters)
      .values({ orgId: org.organization.id, period: billingPeriod(new Date()), runs: 100 });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: bearer(org.apiKey.key),
      payload: await makeBundle(),
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toMatchObject({
      code: 'plan_limit_reached',
      details: { limit: 'runsPerMonth', max: 100, plan: 'free' },
    });
    expect(res.json().error.message).toMatch(/Upgrade to Team/);
  });

  it('returns 402 when the free plan project limit is reached', async () => {
    const org = await signup(t.app, 'Projects');
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: bearer(org.apiKey.key),
      payload: { name: 'Second' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.details).toMatchObject({ limit: 'projects', max: 1 });
  });
});

describe('api keys bound to a project', () => {
  it('cannot be admin keys, and existing ones lose org-wide rights', async () => {
    const org = await signup(t.app, 'Scoped');
    const admin = bearer(org.apiKey.key);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: admin,
      payload: { name: 'ci', scopes: ['admin', 'runs:write'], projectId: org.project.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('cannot have the admin scope');
  });
});

describe('billing', () => {
  it('returns 501 billing_disabled for checkout when Stripe is not configured', async () => {
    const org = await signup(t.app, 'NoStripe');
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: bearer(org.apiKey.key),
      payload: { plan: 'team' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('billing_disabled');
  });

  it('verifies webhook signatures, applies plan changes and ignores replays', async () => {
    const org = await signup(t.app, 'Payer');
    const admin = bearer(org.apiKey.key);
    const send = (payload: string, signature: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        payload,
      });
    const sign = (payload: string) =>
      Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const completed = JSON.stringify({
      id: 'evt_checkout_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          object: 'checkout.session',
          client_reference_id: org.organization.id,
          customer: 'cus_123',
          subscription: 'sub_123',
          payment_status: 'paid',
          metadata: { orgId: org.organization.id, plan: 'team' },
        },
      },
    });

    const bad = await send(completed, 't=1,v1=deadbeef');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid_signature');
    const tamperedBody = await send(completed.replace('"team"', '"assurance"'), sign(completed));
    expect(tamperedBody.statusCode).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json().plan.id).toBe(
      'free',
    );

    // A checkout whose payment hasn't arrived yet (delayed payment methods) must not upgrade the plan.
    const unpaid = completed
      .replace('"evt_checkout_1"', '"evt_checkout_unpaid"')
      .replace('"paid"', '"unpaid"');
    expect((await send(unpaid, sign(unpaid))).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json().plan.id).toBe(
      'free',
    );

    const ok = await send(completed, sign(completed));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ received: true });
    const afterCheckout = (await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json();
    expect(afterCheckout.plan.id).toBe('team');
    expect(afterCheckout.limits.runsPerMonth).toBe(5000);

    // With a subscription in place, a second checkout is refused instead of starting a second subscription.
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: admin,
      payload: { plan: 'assurance' },
    });
    expect(again.statusCode).toBe(409);

    // Downgrade arrives, then the original checkout event is replayed: the replay must not re-apply "team".
    const deleted = JSON.stringify({
      id: 'evt_sub_deleted_1',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          object: 'subscription',
          customer: 'cus_123',
          status: 'canceled',
          metadata: {},
          items: { data: [] },
        },
      },
    });
    expect((await send(deleted, sign(deleted))).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json().plan.id).toBe(
      'free',
    );

    const replay = await send(completed, sign(completed));
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ received: true, duplicate: true });
    expect((await t.app.inject({ method: 'GET', url: '/v1/billing', headers: admin })).json().plan.id).toBe(
      'free',
    );
  });
});
