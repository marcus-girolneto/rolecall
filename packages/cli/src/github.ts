import { readFileSync } from 'node:fs';
import { COMMENT_MARKER } from './markdown.js';

export interface PullRequestRef {
  repo: string;
  number: number;
}

/** The pull request this GitHub Actions job runs for, if any. */
export function detectPullRequest(env: NodeJS.ProcessEnv = process.env): PullRequestRef | undefined {
  const repo = env.GITHUB_REPOSITORY;
  if (!repo || !env.GITHUB_EVENT_PATH) return undefined;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
      pull_request?: { number?: number };
    };
    const number = event.pull_request?.number;
    return typeof number === 'number' ? { repo, number } : undefined;
  } catch {
    return undefined;
  }
}

/** Creates the Rolecall comment on the PR, or updates the previous one so each PR has a single, current report. */
export async function upsertPrComment(opts: {
  pr: PullRequestRef;
  token: string;
  body: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ action: 'created' | 'updated'; url?: string }> {
  const api = (opts.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = {
    authorization: `Bearer ${opts.token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await doFetch(`${api}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const hint = res.status === 403 ? ' (give the workflow `permissions: pull-requests: write`)' : '';
      throw new Error(`GitHub ${method} ${path} failed: ${res.status}${hint}`);
    }
    return res.json() as Promise<unknown>;
  };

  const { repo, number } = opts.pr;
  // Look through every page, and only reuse a comment that starts with our marker (never a person's comment
  // that happens to quote it).
  let existing: { id: number } | undefined;
  for (let page = 1; page <= 30 && !existing; page++) {
    const comments = (await call(
      'GET',
      `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
    )) as Array<{
      id: number;
      body?: string;
    }>;
    existing = comments.find((c) => c.body?.trimStart().startsWith(COMMENT_MARKER));
    if (comments.length < 100) break;
  }
  const saved = (
    existing
      ? await call('PATCH', `/repos/${repo}/issues/comments/${existing.id}`, { body: opts.body })
      : await call('POST', `/repos/${repo}/issues/${number}/comments`, { body: opts.body })
  ) as { html_url?: string };
  return { action: existing ? 'updated' : 'created', ...(saved.html_url ? { url: saved.html_url } : {}) };
}
