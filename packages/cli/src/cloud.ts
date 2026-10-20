import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_FILE, MANIFEST_FILE, RESULTS_FILE, SIGNATURE_FILE } from '@rolecall/core';

/** Uploads a bundle to Rolecall Cloud. The server re-verifies every hash before accepting it. */
export async function pushBundle(
  dir: string,
  opts: { apiUrl: string; apiKey: string },
): Promise<{ id: string; url?: string }> {
  const read = (name: string) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined;
  const res = await fetch(new URL('/v1/runs', opts.apiUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      manifest: read(MANIFEST_FILE),
      results: read(RESULTS_FILE),
      events: read(EVENTS_FILE),
      signature: read(SIGNATURE_FILE),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.id)
    throw new Error(`Upload failed (${res.status}): ${body.error?.message ?? res.statusText}`);
  return { id: body.id, ...(body.url ? { url: body.url } : {}) };
}
