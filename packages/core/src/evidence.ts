import { execFileSync } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256, stableStringify } from './hash.js';
import type { RunOutput } from './runner.js';
import type { RunResult } from './types.js';

export const RESULTS_FILE = 'results.json';
export const EVENTS_FILE = 'events.jsonl';
export const MANIFEST_FILE = 'manifest.json';
export const SIGNATURE_FILE = 'signature.json';

export interface Manifest {
  schemaVersion: 1;
  producer: { name: 'rolecall'; version: string };
  runId: string;
  createdAt: string;
  suite: { name: string; hash: string; file?: string };
  mode: RunResult['mode'];
  target: RunResult['target'];
  summary: RunResult['summary'];
  git: { sha: string; branch: string; dirty: boolean } | null;
  environment: { node: string; platform: string; arch: string; ci: boolean };
  models: RunOutput['models'];
  cassettes: Array<{ path: string; sha256: string }>;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  /** sha256 of the canonical manifest without this field. Covers every file hash above. */
  rootHash: string;
}

export interface SignatureFile {
  algorithm: 'ed25519';
  keyId: string;
  publicKey: string;
  signature: string;
}

export interface WriteBundleOptions {
  outDir: string;
  producerVersion: string;
  suiteFile?: string;
  /** PEM-encoded Ed25519 private key. When present the bundle is signed. */
  signingKey?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface Bundle {
  dir: string;
  manifest: Manifest;
  signed: boolean;
}

/** Writes results, events, a hashed manifest and an optional signature to `<outDir>/<runId>/`. */
export function writeBundle(run: RunOutput, opts: WriteBundleOptions): Bundle {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const runId = `${now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomBytes(3).toString('hex')}`;
  const dir = join(opts.outDir, runId);
  mkdirSync(dir, { recursive: true });

  const files: Manifest['files'] = [];
  const put = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    files.push({ path: name, sha256: sha256(content), bytes: Buffer.byteLength(content) });
  };
  put(RESULTS_FILE, `${JSON.stringify(JSON.parse(stableStringify(run.result)), null, 2)}\n`);
  put(EVENTS_FILE, run.events.map((e) => JSON.stringify(e)).join('\n') + (run.events.length ? '\n' : ''));

  const body: Omit<Manifest, 'rootHash'> = {
    schemaVersion: 1,
    producer: { name: 'rolecall', version: opts.producerVersion },
    runId,
    createdAt: now.toISOString(),
    suite: { ...run.result.suite, ...(opts.suiteFile ? { file: relative(cwd, opts.suiteFile) } : {}) },
    mode: run.result.mode,
    target: run.result.target,
    summary: run.result.summary,
    git: gitInfo(cwd),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ci: Boolean(env.CI),
    },
    models: run.models,
    cassettes: run.cassettes
      .filter((f) => existsSync(f))
      .map((f) => ({ path: relative(cwd, f), sha256: sha256(readFileSync(f)) })),
    files,
  };
  const manifest: Manifest = { ...body, rootHash: sha256(stableStringify(body)) };
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  if (opts.signingKey) {
    writeFileSync(
      join(dir, SIGNATURE_FILE),
      `${JSON.stringify(signRootHash(manifest.rootHash, opts.signingKey), null, 2)}\n`,
    );
  }
  return { dir, manifest, signed: Boolean(opts.signingKey) };
}

export interface VerifyReport {
  ok: boolean;
  signed: boolean;
  keyId?: string;
  /** True when the signature was checked against a caller-supplied trusted key rather than the embedded one. */
  trustedKey: boolean;
  rootHash?: string;
  problems: string[];
}

/** Recomputes every file hash and the root hash, then checks the signature if one is present. */
export function verifyBundle(dir: string, opts: { publicKey?: string } = {}): VerifyReport {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath))
    return {
      ok: false,
      signed: false,
      trustedKey: false,
      problems: [`${MANIFEST_FILE} not found in ${dir}`],
    };
  const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : undefined);
  const manifestText = readFileSync(manifestPath, 'utf8');
  let listed: string[] = [];
  try {
    listed = ((JSON.parse(manifestText) as Manifest).files ?? []).map((f) => f.path);
  } catch {
    // reported by verifyBundleFiles
  }
  const files: Record<string, Uint8Array | string> = {};
  for (const name of listed) {
    if (!/^[\w.-]+$/.test(name)) continue;
    const content = read(name);
    if (content) files[name] = content;
  }
  const signature = read(SIGNATURE_FILE);
  return verifyBundleFiles(
    { manifest: manifestText, files, ...(signature ? { signature: signature.toString('utf8') } : {}) },
    opts,
  );
}

/**
 * Verifies a bundle held in memory (e.g. an upload). `files` maps manifest paths to their exact contents.
 * Same checks as `verifyBundle`: file hashes, root hash, and signature when present.
 */
export function verifyBundleFiles(
  bundle: { manifest: string; files: Record<string, Uint8Array | string>; signature?: string },
  opts: { publicKey?: string } = {},
): VerifyReport {
  const problems: string[] = [];
  let manifest: Manifest;
  try {
    manifest = JSON.parse(bundle.manifest) as Manifest;
  } catch (e) {
    return {
      ok: false,
      signed: false,
      trustedKey: false,
      problems: [`${MANIFEST_FILE} is not valid JSON: ${String(e)}`],
    };
  }
  if (!Array.isArray(manifest.files) || typeof manifest.rootHash !== 'string') {
    return {
      ok: false,
      signed: false,
      trustedKey: false,
      problems: [`${MANIFEST_FILE}: missing files or rootHash`],
    };
  }

  for (const f of manifest.files) {
    const content = bundle.files[f.path];
    if (content === undefined) {
      problems.push(`${f.path}: missing`);
      continue;
    }
    const actual = sha256(content);
    if (actual !== f.sha256)
      problems.push(
        `${f.path}: hash mismatch (expected ${f.sha256.slice(0, 12)}, got ${actual.slice(0, 12)})`,
      );
  }
  for (const required of [RESULTS_FILE, EVENTS_FILE]) {
    if (!manifest.files.some((f) => f.path === required))
      problems.push(`${required}: not listed in manifest`);
  }

  const { rootHash, ...body } = manifest;
  if (sha256(stableStringify(body)) !== rootHash)
    problems.push('manifest: root hash mismatch (the manifest was modified)');

  const signed = bundle.signature !== undefined;
  let keyId: string | undefined;
  if (bundle.signature !== undefined) {
    try {
      const sig = JSON.parse(bundle.signature) as SignatureFile;
      keyId = sig.keyId;
      const key = opts.publicKey
        ? createPublicKey(opts.publicKey)
        : createPublicKey({ key: Buffer.from(sig.publicKey, 'base64'), format: 'der', type: 'spki' });
      if (opts.publicKey && fingerprint(key) !== sig.keyId)
        problems.push('signature: signed by a different key than the trusted one');
      if (!verify(null, Buffer.from(rootHash), key, Buffer.from(sig.signature, 'base64')))
        problems.push('signature: invalid');
    } catch (e) {
      problems.push(`signature: could not be verified (${String(e)})`);
    }
  } else if (opts.publicKey) {
    problems.push('signature: missing, but a trusted public key was supplied');
  }

  return {
    ok: problems.length === 0,
    signed,
    ...(keyId ? { keyId } : {}),
    trustedKey: Boolean(opts.publicKey),
    rootHash,
    problems,
  };
}

export function readBundle(dir: string): { manifest: Manifest; result: RunResult } {
  return {
    manifest: JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')) as Manifest,
    result: JSON.parse(readFileSync(join(dir, RESULTS_FILE), 'utf8')) as RunResult,
  };
}

export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: fingerprint(publicKey),
  };
}

function signRootHash(rootHash: string, privateKeyPem: string): SignatureFile {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return {
    algorithm: 'ed25519',
    keyId: fingerprint(publicKey),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    signature: sign(null, Buffer.from(rootHash), privateKey).toString('base64'),
  };
}

function fingerprint(key: ReturnType<typeof createPublicKey>): string {
  return sha256(key.export({ type: 'spki', format: 'der' })).slice(0, 16);
}

function gitInfo(cwd: string): Manifest['git'] {
  try {
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    return {
      sha: run('rev-parse', 'HEAD'),
      branch: run('rev-parse', '--abbrev-ref', 'HEAD'),
      dirty: run('status', '--porcelain').length > 0,
    };
  } catch {
    return null;
  }
}
