import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineSuite, runSuite } from '@rolecall/core';
import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aiSdkAgent, scriptedModel } from '../src/index.js';

class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

type Ctx = { notes: string[] };
type User = { role: 'guest' | 'owner' };

const tools = (ctx: Ctx, user: User) => ({
  addNote: tool({
    description: 'Add a note',
    inputSchema: z.object({ text: z.string() }),
    execute: async ({ text }) => {
      if (user.role !== 'owner') throw new ForbiddenError('guests cannot write');
      ctx.notes.push(text);
      return { count: ctx.notes.length };
    },
  }),
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** A mock "remote" model: first step calls addNote, then answers. Counts real calls. */
function countingModel() {
  let step = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      step++;
      if (step % 2 === 1) {
        return {
          content: [
            { type: 'tool-call', toolCallId: `c${step}`, toolName: 'addNote', input: '{"text":"hi"}' },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text', text: 'saved' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return model;
}

const makeSuite = (model: ReturnType<typeof countingModel> | ReturnType<typeof scriptedModel>) =>
  defineSuite<Ctx, User>({
    name: 'notes',
    target: { kind: 'memory', name: 'mem' },
    roles: { guest: { role: 'guest' }, owner: { role: 'owner' } },
    setup: () => ({ notes: [] }),
    snapshot: (ctx) => ctx.notes,
    agent: aiSdkAgent({ model, tools }),
    policy: [
      { role: 'guest', tool: 'addNote', args: { text: 'x' }, expect: 'deny' },
      { role: 'owner', tool: 'addNote', args: { text: 'x' }, expect: 'allow', state: 'changed' },
    ],
    scenarios: [
      {
        name: 'guest tries to write',
        role: 'guest',
        turns: ['note hi'],
        forbid: ['addNote'],
        state: 'unchanged',
      },
      { name: 'owner writes', role: 'owner', turns: ['note hi'], require: ['addNote'], state: 'changed' },
    ],
  });

describe('aiSdkAgent', () => {
  it('probes real tool handlers and classifies scenario tool calls by layer', async () => {
    const { result } = await runSuite(makeSuite(countingModel()), { mode: 'live' });
    expect(result.summary).toMatchObject({ total: 4, pass: 4 });
    const guest = result.scenarios.find((s) => s.role === 'guest');
    expect(guest?.forbidden[0]).toEqual({ tool: 'addNote', layer: 'authz_blocked' });
    expect(guest?.timeline.map((t) => t.type)).toEqual(['user', 'tool', 'assistant']);
  });

  it('records model calls once, then replays them offline without calling the model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolecall-cassettes-'));
    const recorder = countingModel();
    await runSuite(makeSuite(recorder), { mode: 'record', cassetteDir: dir });
    expect(recorder.doGenerateCalls.length).toBe(4);
    expect(readdirSync(dir).sort()).toEqual(['guest-tries-to-write.json', 'owner-writes.json']);

    const replayer = countingModel();
    const replay = await runSuite(makeSuite(replayer), { mode: 'replay', cassetteDir: dir });
    expect(replayer.doGenerateCalls.length).toBe(0);
    expect(replay.result.summary.pass).toBe(4);
    expect(replay.cassettes).toHaveLength(2);
  });

  it('reports a replay miss as an agent error with a re-record hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rolecall-empty-'));
    const { result } = await runSuite(makeSuite(countingModel()), { mode: 'replay', cassetteDir: dir });
    const s = result.scenarios[0];
    expect(s?.status).toBe('error');
    expect(s?.findings[0]?.message).toMatch(/--mode record/);
  });

  it('scriptedModel runs without cassettes and sees tool errors', async () => {
    const seen: boolean[] = [];
    const model = scriptedModel(({ toolResults }) => {
      if (toolResults.length) {
        seen.push(toolResults[0]?.isError ?? false);
        return { text: 'done' };
      }
      return { toolCalls: [{ tool: 'addNote', args: { text: 'hi' } }] };
    });
    const { result } = await runSuite(makeSuite(model), { mode: 'replay', cassetteDir: '/nonexistent' });
    expect(result.summary.pass).toBe(4);
    expect(seen).toEqual([true, false]);
  });

  it('rejects probe args that do not match the tool input schema', async () => {
    const s = makeSuite(countingModel());
    s.policy = [{ role: 'owner', tool: 'addNote', args: { wrong: 1 }, expect: 'allow' }];
    s.scenarios = [];
    const { result } = await runSuite(s, { mode: 'live' });
    expect(result.policy[0]?.error).toMatch(/do not match its inputSchema/);
  });
});
