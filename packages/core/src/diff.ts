import { normalize } from './hash.js';
import type { DiffEntry } from './types.js';

/** Structural diff of two JSON-like values, reported as dot paths. */
export function diffState(before: unknown, after: unknown, ignore: string[] = []): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(normalize(before), normalize(after), '', out);
  const matchers = ignore.map(toMatcher);
  return out.filter((d) => !matchers.some((m) => m(d.path)));
}

function walk(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      const child = path ? `${path}.${key}` : key;
      if (!(key in a)) out.push({ path: child, kind: 'added', after: b[key] });
      else if (!(key in b)) out.push({ path: child, kind: 'removed', before: a[key] });
      else walk(a[key], b[key], child, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const child = path ? `${path}.${i}` : String(i);
      if (i >= a.length) out.push({ path: child, kind: 'added', after: b[i] });
      else if (i >= b.length) out.push({ path: child, kind: 'removed', before: a[i] });
      else walk(a[i], b[i], child, out);
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b))
    out.push({ path: path || '$', kind: 'changed', before: a, after: b });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toMatcher(pattern: string): (path: string) => boolean {
  const parts = pattern.split('.');
  return (path) => {
    const segs = path.split('.');
    if (segs.length < parts.length) return false;
    return parts.every((p, i) => p === '*' || p === segs[i]);
  };
}
