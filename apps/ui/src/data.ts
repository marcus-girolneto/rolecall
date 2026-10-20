import type { DashboardBootstrap, RunDetail, RunListItem } from '@rolecall/core';
import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    __ROLECALL__?: DashboardBootstrap;
  }
}

export interface DataSource {
  mode: DashboardBootstrap['mode'];
  listRuns(): Promise<RunListItem[]>;
  getRun(id: string): Promise<RunDetail>;
}

export class NoBootstrapError extends Error {}

/** Rolecall Cloud rejected (or needs) the API key. */
export class AuthRequiredError extends Error {}

const KEY_STORAGE = 'rolecall:cloud-key';

/** Cloud API key, kept in sessionStorage so it dies with the tab. */
export function getCloudKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setCloudKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable: the user will be asked again
  }
}

/** Injected data wins. In dev only, fall back to the bundled fixture (excluded from production builds). */
export async function loadBootstrap(): Promise<DashboardBootstrap> {
  if (window.__ROLECALL__) return window.__ROLECALL__;
  if (import.meta.env.DEV) {
    const fixture = await import('../fixtures/bootstrap.json');
    return fixture.default as unknown as DashboardBootstrap;
  }
  throw new NoBootstrapError('No dashboard data was injected into this page.');
}

const newestFirst = (runs: RunListItem[]) =>
  [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

async function getJson<T>(url: string, mode: DataSource['mode']): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = mode === 'cloud' ? getCloudKey() : null;
  if (mode === 'cloud' && !key) throw new AuthRequiredError('Sign in with an API key.');
  if (key) headers.authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error(
      mode === 'cloud'
        ? `Could not reach Rolecall Cloud (${url}).`
        : `Could not reach ${url}. Is \`rolecall ui\` still running?`,
    );
  }
  if (res.status === 401 && mode === 'cloud') {
    setCloudKey(null);
    throw new AuthRequiredError('That API key was rejected. It may have been revoked.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      // Local server: { error: string }. Cloud: { error: { code, message } }.
      const body = (await res.json()) as { error?: string | { message?: string } };
      const message = typeof body.error === 'string' ? body.error : body.error?.message;
      detail = message ? `: ${message}` : '';
    } catch {
      // not JSON
    }
    throw new Error(`${res.status} ${res.statusText || 'error'} from ${url}${detail}`);
  }
  return (await res.json()) as T;
}

export function createSource(b: DashboardBootstrap): DataSource {
  if (b.mode === 'static') {
    return {
      mode: b.mode,
      listRuns: async () => newestFirst(b.runs ?? []),
      getRun: async (id) => {
        const d = b.details?.[id];
        if (!d) throw new Error(`Run ${id} is not included in this report.`);
        return d;
      },
    };
  }
  const base = (b.apiBase ?? '/api').replace(/\/+$/, '');
  return {
    mode: b.mode,
    listRuns: async () => {
      // The local server returns an array; Rolecall Cloud returns a page `{ runs, nextCursor }`.
      const body = await getJson<RunListItem[] | { runs: RunListItem[] }>(`${base}/runs`, b.mode);
      return newestFirst(Array.isArray(body) ? body : body.runs);
    },
    getRun: (id) => getJson<RunDetail>(`${base}/runs/${encodeURIComponent(id)}`, b.mode),
  };
}

export type Async<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; error: Error };

export function useSource(): Async<DataSource> {
  const [s, set] = useState<Async<DataSource>>({ state: 'loading' });
  useEffect(() => {
    loadBootstrap().then(
      (b) => set({ state: 'ready', data: createSource(b) }),
      (e: unknown) => set({ state: 'error', error: e instanceof Error ? e : new Error(String(e)) }),
    );
  }, []);
  return s;
}

export function useRuns(src: DataSource | null): { runs: Async<RunListItem[]>; reload: () => void } {
  const [runs, set] = useState<Async<RunListItem[]>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload trigger
  useEffect(() => {
    if (!src) return;
    let live = true;
    set((prev) => (prev.state === 'ready' ? prev : { state: 'loading' }));
    src.listRuns().then(
      (data) => live && set({ state: 'ready', data }),
      (e: unknown) => live && set({ state: 'error', error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
  }, [src, tick]);
  return { runs, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function useRunDetail(src: DataSource | null, id: string | undefined): Async<RunDetail> | null {
  const cache = useRef(new Map<string, RunDetail>());
  const [s, set] = useState<Async<RunDetail> | null>(null);
  useEffect(() => {
    if (!src || !id) {
      set(null);
      return;
    }
    const hit = cache.current.get(id);
    if (hit) {
      set({ state: 'ready', data: hit });
      return;
    }
    let live = true;
    set({ state: 'loading' });
    src.getRun(id).then(
      (data) => {
        cache.current.set(id, data);
        if (live) set({ state: 'ready', data });
      },
      (e: unknown) => live && set({ state: 'error', error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
  }, [src, id]);
  return s;
}
