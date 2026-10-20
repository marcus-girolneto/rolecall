import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Manifest, runSuite, type SuiteDef, sha256, stableStringify, writeBundle } from '@rolecall/core';
import type { FastifyInstance } from 'fastify';
import { type AppDeps, buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const WEBHOOK_SECRET = 'whsec_test_secret';

export interface TestContext {
  app: FastifyInstance;
  database: DatabaseHandle;
  close(): Promise<void>;
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  deps: Partial<Pick<AppDeps, 'dashboard' | 'clock'>> = {},
): Promise<TestContext> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite://memory',
    PUBLIC_URL: 'https://cloud.rolecall.test',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SIGNUP_RATE_LIMIT_MAX: '1000',
    RATE_LIMIT_MAX: '10000',
    ...overrides,
  });
  const database = createDatabase(env.DATABASE_URL);
  await runMigrations(database);
  const app = await buildApp({ env, database, logger: false, ...deps });
  await app.ready();
  return {
    app,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

export async function signup(app: FastifyInstance, orgName = 'Acme') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/signup',
    payload: { orgName, email: `${orgName.toLowerCase()}@example.com` },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return res.json() as {
    organization: { id: string; plan: string };
    project: { id: string; defaultBranch: string };
    apiKey: { id: string; key: string };
  };
}

export interface UploadBody {
  manifest: string;
  results: string;
  events: string;
  signature?: string;
}

interface Ctx {
  refunds: number;
}
type Identity = { role: string };

/** A tiny real suite: viewers must not be able to refund. `buggy` makes the app forget that check. */
function refundSuite(buggy: boolean): SuiteDef<Ctx, Identity> {
  return {
    name: 'refund-permissions',
    target: { kind: 'memory', name: 'in-memory' },
    roles: { admin: { role: 'admin' }, viewer: { role: 'viewer' } },
    setup: () => ({ refunds: 0 }),
    snapshot: (ctx) => ({ refunds: ctx.refunds }),
    agent: {
      kind: 'plain-object',
      async invokeTool({ ctx, identity, tool }) {
        if (tool !== 'refund') throw new Error(`unknown tool ${tool}`);
        if (!buggy && identity.role !== 'admin') {
          const e = new Error('viewers cannot refund');
          e.name = 'ForbiddenError';
          throw e;
        }
        ctx.refunds += 1;
        return { ok: true };
      },
      async run() {
        return {};
      },
    },
    policy: [
      { role: 'admin', tool: 'refund', args: { amount: 10 }, expect: 'allow', state: 'changed' },
      { role: 'viewer', tool: 'refund', args: { amount: 10 }, expect: 'deny' },
    ],
  };
}

/**
 * Generates a real evidence bundle with @rolecall/core (runSuite + writeBundle) and returns the upload body.
 * `git` re-seals the manifest with git metadata using the same canonical hashing as writeBundle.
 */
export async function makeBundle(
  opts: { buggy?: boolean; at?: Date; git?: Manifest['git'] } = {},
): Promise<UploadBody> {
  const dir = mkdtempSync(join(tmpdir(), 'rolecall-api-test-'));
  try {
    const run = await runSuite(refundSuite(opts.buggy ?? false), {
      mode: 'replay',
      cassetteDir: join(dir, 'cassettes'),
      env: {},
    });
    const bundle = writeBundle(run, {
      outDir: dir,
      producerVersion: '0.1.0-test',
      cwd: dir,
      env: {},
      now: opts.at ?? new Date(),
    });
    const read = (name: string) => readFileSync(join(bundle.dir, name), 'utf8');
    let manifest = read('manifest.json');
    if (opts.git !== undefined) {
      const { rootHash: _old, ...body } = JSON.parse(manifest) as Manifest;
      const next = { ...body, git: opts.git };
      manifest = `${JSON.stringify({ ...next, rootHash: sha256(stableStringify(next)) }, null, 2)}\n`;
    }
    const signaturePath = join(bundle.dir, 'signature.json');
    return {
      manifest,
      results: read('results.json'),
      events: read('events.jsonl'),
      ...(existsSync(signaturePath) ? { signature: readFileSync(signaturePath, 'utf8') } : {}),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
