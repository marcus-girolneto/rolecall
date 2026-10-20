import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareRuns,
  createRedactor,
  generateSigningKeyPair,
  readBundle,
  runSuite,
  toJUnit,
  verifyBundle,
  writeBundle,
} from '../src/index.js';
import { handlers, plainAdapter, suite } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'rolecall-'));

describe('evidence bundle', () => {
  it('verifies a fresh bundle and fails after a one-byte change to any file or the manifest', async () => {
    const run = await runSuite(suite());
    for (const target of ['results.json', 'events.jsonl', 'manifest.json']) {
      const { dir } = writeBundle(run, { outDir: tmp(), producerVersion: 'test' });
      expect(verifyBundle(dir).ok).toBe(true);
      const file = join(dir, target);
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, target === 'manifest.json' ? text.replace('"test"', '"tesT"') : `${text} `);
      const report = verifyBundle(dir);
      expect(report.ok, target).toBe(false);
      expect(report.problems.join()).toMatch(target === 'manifest.json' ? /root hash/ : new RegExp(target));
    }
  });

  it('signs with Ed25519 and pins a trusted key', async () => {
    const run = await runSuite(suite());
    const keys = generateSigningKeyPair();
    const { dir, signed } = writeBundle(run, {
      outDir: tmp(),
      producerVersion: 'test',
      signingKey: keys.privateKeyPem,
    });
    expect(signed).toBe(true);
    expect(verifyBundle(dir, { publicKey: keys.publicKeyPem })).toMatchObject({
      ok: true,
      signed: true,
      keyId: keys.keyId,
    });
    const other = generateSigningKeyPair();
    expect(verifyBundle(dir, { publicKey: other.publicKeyPem }).ok).toBe(false);

    // Re-hashing a tampered manifest is caught by the signature.
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.rootHash = 'f'.repeat(64);
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    expect(verifyBundle(dir).problems.join()).toMatch(/signature/);
  });

  it('never writes planted secrets to disk', async () => {
    // Fake secrets are assembled at runtime so no secret-shaped literal lives in the repo.
    const planted = ['PLANTED', 'SECRET', 'value', '1234'].join('-');
    const env = { OPENAI_API_KEY: planted };
    const h = {
      ...handlers(),
      read: () => {
        throw new Error(`upstream rejected key ${planted} and token ${'ghp'}_${'a'.repeat(36)}`);
      },
    };
    const s = suite({
      agent: plainAdapter(h, () => []),
      scenarios: [],
      redact: { values: ['hunter2-custom'] },
    });
    s.policy?.push({
      role: 'reader',
      tool: 'read',
      args: { id: 'hunter2-custom' },
      expect: 'allow',
      label: 'secret arg',
    });
    const run = await runSuite(s, { env });
    const { dir } = writeBundle(run, { outDir: tmp(), producerVersion: 'test' });
    const all = ['results.json', 'events.jsonl', 'manifest.json']
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join();
    expect(all).not.toContain(planted);
    expect(all).not.toContain(`${'ghp'}_aaaa`);
    expect(all).not.toContain('hunter2-custom');
    expect(all).toContain('[REDACTED]');
  });

  it('does not treat words ending in "sk-" as secrets', () => {
    const r = createRedactor({ env: {} });
    expect(r.string('risk-assessment-tool-v2-production')).toBe('risk-assessment-tool-v2-production');
  });

  it('redacts common token formats', () => {
    const r = createRedactor({ env: {} });
    expect(r.string('Authorization: Bearer abcdefghijklmnop.qrs')).toBe('Authorization: [REDACTED]');
    const awsLike = `${'AK'}IA${'Q'.repeat(16)}`;
    expect(r.deep({ k: [awsLike] })).toEqual({ k: ['[REDACTED]'] });
  });

  it('detects regressions against a baseline bundle', async () => {
    const out = tmp();
    const good = writeBundle(await runSuite(suite()), { outDir: out, producerVersion: 'test' });
    const bad = await runSuite(suite({}, { weak: true }));
    const cmp = compareRuns(bad.result, readBundle(good.dir).result);
    const changes = cmp.regressions.map((r) => `${r.id.replace(/:[0-9a-f]{8}$/, '')}:${r.to}`).sort();
    expect(changes).toEqual([
      'policy:reader:remove:fail',
      'scenario:reader-asks-to-delete:fail',
      'scenario:reader-is-refused-by-the-model:warn',
    ]);
    expect(cmp.fixes).toEqual([]);
  });

  it('emits JUnit with failures and errors', async () => {
    const { result } = await runSuite(suite({}, { weak: true }));
    const xml = toJUnit(result);
    expect(xml).toContain(
      '<failure message="&quot;reader&quot; can run remove, but your rules say it must not."',
    );
    expect(xml).toContain('Fix: Add a permission check');
    expect((xml.match(/<testcase /g) ?? []).length).toBe(result.summary.total);
    appendFileSync(join(tmp(), 'x.xml'), xml);
  });
});
