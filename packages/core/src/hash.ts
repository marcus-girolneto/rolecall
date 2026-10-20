import { createHash } from 'node:crypto';

/** JSON with sorted object keys, so equal values always serialize to equal strings. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map((v) => normalize(v) ?? null);
  if (value instanceof Map) return normalize(Object.fromEntries(value));
  if (value instanceof Set) return normalize([...value]);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = normalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
