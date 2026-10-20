import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunResult } from '@rolecall/core';
import { describe, expect, it } from 'vitest';
import { detectPullRequest, upsertPrComment } from '../src/github.js';
import { COMMENT_MARKER, toMarkdown } from '../src/markdown.js';

const result: RunResult = {
  schemaVersion: 1,
  suite: { name: 'Invoices', hash: 'h' },
  target: { kind: 'memory', name: 'm' },
  mode: 'replay',
  roles: ['viewer', 'support'],
  tools: ['refund'],
  summary: { total: 2, pass: 1, fail: 1, warn: 0, error: 0 },
  policy: [
    {
      id: 'a',
      kind: 'policy',
      role: 'viewer',
      tool: 'refund',
      args: {},
      expect: 'deny',
      outcome: 'authz_blocked',
      status: 'pass',
      findings: [],
      stateDiff: [],
    },
    {
      id: 'b',
      kind: 'policy',
      role: 'support',
      tool: 'refund',
      args: {},
      expect: 'deny',
      outcome: 'executed',
      status: 'fail',
      findings: [
        {
          code: 'unexpected_execution',
          message: '"support" can run refund, but your rules say it must not.',
          hint: 'Add a check.',
        },
      ],
      stateDiff: [{ path: 'inv.refunded', kind: 'changed', before: 0, after: 450 }],
    },
  ],
  scenarios: [],
};

describe('PR report', () => {
  it('reads as a verdict, a who-can-do-what table and what to fix', () => {
    const md = toMarkdown(result, { marker: true });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain('❌ **1 permission problem**');
    expect(md).toContain('| **viewer** | ✅ blocked |');
    expect(md).toContain('| **support** | ❌ **problem** |');
    expect(md).toContain('Data changed: `inv.refunded` 0 → 450');
    expect(md).toContain('_How to fix:_ Add a check.');
  });
});

describe('GitHub PR comment', () => {
  const pr = { repo: 'acme/app', number: 7 };

  function fakeGitHub(existing: Array<{ id: number; body: string }>) {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(url),
        ...(init?.body ? { body: String(init.body) } : {}),
      });
      const payload =
        init?.method === 'GET' ? existing : { html_url: 'https://github.com/acme/app/pull/7#c' };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('creates the comment the first time', async () => {
    const gh = fakeGitHub([{ id: 1, body: 'unrelated' }]);
    const out = await upsertPrComment({
      pr,
      token: 't',
      body: `${COMMENT_MARKER}\nhi`,
      fetchImpl: gh.fetchImpl,
    });
    expect(out.action).toBe('created');
    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.github.com/repos/acme/app/issues/7/comments?per_page=100&page=1',
      'POST https://api.github.com/repos/acme/app/issues/7/comments',
    ]);
  });

  it('updates its own previous comment instead of piling up new ones', async () => {
    const gh = fakeGitHub([{ id: 42, body: `${COMMENT_MARKER}\nold` }]);
    const out = await upsertPrComment({
      pr,
      token: 't',
      body: `${COMMENT_MARKER}\nnew`,
      fetchImpl: gh.fetchImpl,
    });
    expect(out.action).toBe('updated');
    expect(gh.calls[1]).toMatchObject({
      method: 'PATCH',
      url: 'https://api.github.com/repos/acme/app/issues/comments/42',
    });
  });

  it("never edits a person's comment that quotes the marker", async () => {
    const gh = fakeGitHub([{ id: 5, body: `I saw this: ${COMMENT_MARKER}` }]);
    const out = await upsertPrComment({
      pr,
      token: 't',
      body: `${COMMENT_MARKER}\nnew`,
      fetchImpl: gh.fetchImpl,
    });
    expect(out.action).toBe('created');
  });

  it('explains a missing permission', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    await expect(upsertPrComment({ pr, token: 't', body: 'x', fetchImpl })).rejects.toThrow(
      /pull-requests: write/,
    );
  });

  it('detects the pull request from the Actions event', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh-event-'));
    const event = join(dir, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 12 } }));
    expect(detectPullRequest({ GITHUB_REPOSITORY: 'acme/app', GITHUB_EVENT_PATH: event })).toEqual({
      repo: 'acme/app',
      number: 12,
    });
    writeFileSync(event, JSON.stringify({ push: {} }));
    expect(detectPullRequest({ GITHUB_REPOSITORY: 'acme/app', GITHUB_EVENT_PATH: event })).toBeUndefined();
  });
});
