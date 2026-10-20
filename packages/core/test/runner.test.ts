import { describe, expect, it } from 'vitest';
import {
  defineSuite,
  LiveTargetRefusedError,
  NetworkBlockedError,
  runSuite,
  SuiteValidationError,
  stableStringify,
} from '../src/index.js';
import { handlers, plainAdapter, suite } from './helpers.js';

const byId = <T extends { id: string }>(xs: T[], part: string) => {
  const found = xs.find((x) => x.id.includes(part));
  if (!found) throw new Error(`no test matching ${part}`);
  return found;
};

describe('runSuite', () => {
  it('passes a correct app: denials blocked by authorization, allows executed', async () => {
    const { result } = await runSuite(suite());
    expect(result.summary).toMatchObject({ total: 5, pass: 5, fail: 0, warn: 0, error: 0 });
    expect(byId(result.policy, 'reader:remove').outcome).toBe('authz_blocked');
    expect(byId(result.policy, 'editor:remove').outcome).toBe('executed');
    const scenario = byId(result.scenarios, 'reader-asks-to-delete');
    expect(scenario.forbidden[0]).toEqual({ tool: 'remove', layer: 'authz_blocked' });
    expect(scenario.timeline.map((t) => t.type)).toEqual(['user', 'tool', 'assistant']);
  });

  it('fails a deny rule whose handler executes, with the state diff attached', async () => {
    const { result } = await runSuite(suite({}, { weak: true }));
    const cell = byId(result.policy, 'reader:remove');
    expect(cell.status).toBe('fail');
    expect(cell.findings.map((f) => f.code)).toEqual(['unexpected_execution']);
    expect(cell.findings[0]?.message).toBe('"reader" can run remove, but your rules say it must not.');
    expect(cell.findings[0]?.hint).toContain('Add a permission check for "reader" inside remove');
    expect(cell.stateDiff).toEqual([{ path: 'd1', kind: 'removed', before: 'hello' }]);
    expect(byId(result.scenarios, 'reader-asks-to-delete').status).toBe('fail');
  });

  it('warns with model_only_defense when the model refuses but authorization would allow', async () => {
    const { result } = await runSuite(suite({}, { weak: true }));
    const s = byId(result.scenarios, 'refused-by-the-model');
    expect(s.status).toBe('warn');
    expect(s.findings[0]?.code).toBe('model_only_defense');
    expect(s.forbidden[0]).toMatchObject({ layer: 'model_refused', probe: { outcome: 'executed' } });
    expect(s.stateDiff).toEqual([]);
  });

  it('confirms enforcement with a probe when the model refuses and authorization holds', async () => {
    const { result } = await runSuite(suite());
    const s = byId(result.scenarios, 'refused-by-the-model');
    expect(s.status).toBe('pass');
    expect(s.forbidden[0]).toMatchObject({ layer: 'model_refused', probe: { outcome: 'authz_blocked' } });
  });

  it('flags a denied call that still wrote state', async () => {
    const { result } = await runSuite(suite({}, { partialWrite: true }));
    const cell = byId(result.policy, 'reader:remove');
    expect(cell.outcome).toBe('authz_blocked');
    expect(cell.status).toBe('fail');
    expect(cell.findings[0]?.code).toBe('state_changed');
  });

  it('reports non-authorization errors as unconfirmed, not as a pass', async () => {
    const s = suite({
      policy: [{ role: 'reader', tool: 'crash', args: { id: 'x' }, expect: 'deny' }],
      scenarios: [],
    });
    const { result } = await runSuite(s);
    expect(result.policy[0]).toMatchObject({ outcome: 'errored', status: 'error' });
    expect(result.policy[0]?.findings[0]?.message).toContain('failed for another reason (TypeError: boom)');
    expect(result.policy[0]?.findings[0]?.hint).toContain('isDenied');
  });

  it('honours a custom isDenied classifier for returned denials', async () => {
    const h = { ...handlers(), remove: () => ({ ok: false, reason: 'FORBIDDEN' }) };
    const s = suite({
      agent: plainAdapter(h, () => []),
      isDenied: ({ threw, result }) => !threw && (result as { reason?: string })?.reason === 'FORBIDDEN',
      scenarios: [],
    });
    const { result } = await runSuite(s);
    expect(byId(result.policy, 'reader:remove').outcome).toBe('authz_blocked');
  });

  it('is deterministic: two replay runs give identical results', async () => {
    const a = await runSuite(suite({}, { weak: true }));
    const b = await runSuite(suite({}, { weak: true }));
    expect(stableStringify(a.result)).toBe(stableStringify(b.result));
  });

  it('refuses non-memory targets without ROLECALL_ALLOW_LIVE=1', async () => {
    const s = suite({ target: { kind: 'staging', name: 'staging-eu' } });
    await expect(runSuite(s, { env: {} })).rejects.toBeInstanceOf(LiveTargetRefusedError);
    const ok = await runSuite(s, { env: { ROLECALL_ALLOW_LIVE: '1' } });
    expect(ok.result.summary.fail).toBe(0);
  });

  it('rejects production targets and unknown roles at definition time', () => {
    expect(() => suite({ target: { kind: 'sandbox', name: 'prod-db' } })).toThrow(SuiteValidationError);
    expect(() =>
      defineSuite({ ...suite(), policy: [{ role: 'ghost', tool: 'read', args: {}, expect: 'allow' }] }),
    ).toThrow(/unknown role "ghost"/);
  });

  it('blocks network in replay mode and restores it afterwards', async () => {
    const h = {
      ...handlers(),
      read: async () => {
        await fetch('https://example.com/');
        return 'x';
      },
    };
    const s = suite({ agent: plainAdapter(h, () => []), scenarios: [] });
    const { result } = await runSuite(s, { mode: 'replay' });
    expect(byId(result.policy, 'reader:read').error).toContain(NetworkBlockedError.name);
    expect(globalThis.fetch.name).not.toBe('');
  });

  it('expands a permissions table with one example per tool', async () => {
    const s = suite({
      policy: [],
      scenarios: [],
      permissions: {
        reader: { read: 'allow', remove: 'deny' },
        editor: { read: 'allow', remove: 'allow' },
      },
      examples: { read: { id: 'd1' }, remove: { id: 'd2' } },
    });
    const { result } = await runSuite(s);
    expect(result.policy.map((p) => `${p.role}:${p.tool}:${p.expect}:${p.status}`)).toEqual([
      'reader:read:allow:pass',
      'reader:remove:deny:pass',
      'editor:read:allow:pass',
      'editor:remove:allow:pass',
    ]);
    expect(byId(result.policy, 'reader:remove').args).toEqual({ id: 'd2' });
  });

  it('probes forbidden tools with their example, so model-only defenses need no extra config', async () => {
    const s = suite(
      {
        examples: { remove: { id: 'd1' } },
        scenarios: [{ name: 'model refuses', role: 'reader', turns: ['wipe it'], forbid: ['remove'] }],
      },
      { weak: true },
    );
    const { result } = await runSuite(s, { filter: 'scenario:' });
    expect(result.scenarios[0]).toMatchObject({
      status: 'warn',
      forbidden: [{ probe: { outcome: 'executed' } }],
    });
    expect(result.scenarios[0]?.findings[0]?.hint).toContain('Only the prompt is protecting this action');
  });

  it('rejects unknown roles in the permissions table', () => {
    expect(() => suite({ permissions: { ghost: { read: 'allow' } } })).toThrow(
      /permissions.ghost: unknown role/,
    );
  });

  it('with match, only calls on the targeted record count', async () => {
    const s = suite({
      policy: [],
      agent: plainAdapter(handlers({ weak: true }), () => [{ tool: 'remove', args: { id: 'd2' } }]),
      scenarios: [
        {
          name: 'targets d1',
          role: 'reader',
          turns: ['go'],
          forbid: [{ tool: 'remove', args: { id: 'd1' }, match: { id: 'd1' } }],
        },
      ],
    });
    const { result } = await runSuite(s);
    // The agent removed d2, not the targeted d1, so the forbid is judged by the probe on d1 instead.
    expect(result.scenarios[0]?.forbidden[0]).toMatchObject({
      layer: 'model_refused',
      probe: { outcome: 'executed' },
    });
    expect(result.scenarios[0]?.status).toBe('warn');
  });

  it('filters tests by id', async () => {
    const { result } = await runSuite(suite(), { filter: 'scenario:' });
    expect(result.policy).toHaveLength(0);
    expect(result.scenarios).toHaveLength(2);
  });
});

describe('defaultIsDenied', () => {
  it('recognises refusals returned as values, as AI SDK apps often do', async () => {
    const { defaultIsDenied } = await import('../src/index.js');
    const returned = (result: unknown) => defaultIsDenied({ threw: false, result });
    expect(returned({ error: 'Forbidden' })).toBe(true);
    expect(returned({ error: 'Permission denied for document' })).toBe(true);
    expect(returned({ error: { message: 'Unauthorized' } })).toBe(true);
    expect(returned({ status: 403 })).toBe(true);
    expect(returned({ error: 'Document not found' })).toBe(false);
    expect(returned({ ok: true, note: 'forbidden fruit' })).toBe(false);
    expect(returned('Forbidden')).toBe(false);
  });
});
