import type { AgentAdapter, CassetteHandle } from '@rolecall/core';
import {
  generateText,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  wrapLanguageModel,
} from 'ai';
import { isDeterministic } from './scripted-model.js';

type ModelObject = Exclude<LanguageModel, string>;

export interface AiSdkAgentOptions<Ctx, Id> {
  /**
   * The model under test, or a factory per run. Pass a provider model object (string ids are not supported).
   * Optional: permission checks call your tools directly and need no model; conversations (scenarios) do.
   */
  model?: ModelObject | ((ctx: Ctx) => ModelObject);
  /** Your application's tool factory. Authorization must live inside the tools (or what they call), keyed off `identity`. */
  tools: (ctx: Ctx, identity: Id) => ToolSet;
  instructions?: string | ((identity: Id) => string);
  /** Maximum model steps per user turn. Default 8. */
  maxSteps?: number;
}

/** Runs a Vercel AI SDK (v7) tool-calling agent under Rolecall. */
export function aiSdkAgent<Ctx, Id>(opts: AiSdkAgentOptions<Ctx, Id>): AgentAdapter<Ctx, Id> {
  return {
    kind: 'ai-sdk',

    async invokeTool({ ctx, identity, tool: name, args }) {
      const tool = opts.tools(ctx, identity)[name];
      if (!tool)
        throw new Error(`Rolecall: tool "${name}" is not in the tool set returned by tools(ctx, identity).`);
      if (typeof tool.execute !== 'function')
        throw new Error(`Rolecall: tool "${name}" has no execute function to probe.`);
      const input = parseInput(tool.inputSchema, args, name);
      return await tool.execute(
        input as never,
        {
          toolCallId: 'rolecall-probe',
          messages: [],
          abortSignal: undefined,
          context: undefined,
        } as never,
      );
    },

    describeTools({ ctx, identity }) {
      return Object.entries(opts.tools(ctx, identity)).map(([name, tool]) => ({
        name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        ...(tool.inputSchema ? { inputSchema: toJsonSchema(tool.inputSchema) } : {}),
      }));
    },

    async run({ ctx, identity, turns, hooks, cassette }) {
      if (!opts.model) {
        throw new Error(
          'Add `model` to aiSdkAgent({ ... }) to run conversations. Permission checks work without a model.',
        );
      }
      const base = typeof opts.model === 'function' ? opts.model(ctx) : opts.model;
      const model = isDeterministic(base) ? base : withCassette(base, cassette);
      const tools: ToolSet = {};
      for (const [name, tool] of Object.entries(opts.tools(ctx, identity))) {
        const execute = tool.execute;
        tools[name] = execute
          ? {
              ...tool,
              execute: (input: unknown, o: unknown) =>
                hooks.call(name, input, () => execute(input as never, o as never)),
            }
          : tool;
      }
      const instructions =
        typeof opts.instructions === 'function' ? opts.instructions(identity) : opts.instructions;

      const messages: ModelMessage[] = [];
      for (const turn of turns) {
        hooks.message('user', turn);
        messages.push({ role: 'user', content: turn });
        const result = await generateText({
          model,
          tools,
          messages,
          stopWhen: isStepCount(opts.maxSteps ?? 8),
          ...(instructions ? { instructions } : {}),
        });
        hooks.message('assistant', result.text);
        messages.push(...result.steps.flatMap((s) => s.response.messages));
      }
      return { model: { provider: base.provider, modelId: base.modelId } };
    },
  };
}

/** JSON schema for a tool's input when it can be derived without running anything (zod v4 or AI SDK jsonSchema()). */
function toJsonSchema(schema: unknown): unknown {
  const s = schema as { toJSONSchema?: () => unknown; jsonSchema?: unknown };
  try {
    if (typeof s.toJSONSchema === 'function') return s.toJSONSchema();
    if (s.jsonSchema && typeof s.jsonSchema === 'object' && !('then' in s.jsonSchema)) return s.jsonSchema;
  } catch {
    // unknown schema type
  }
  return undefined;
}

function parseInput(schema: unknown, args: unknown, name: string): unknown {
  const s = schema as {
    safeParse?: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
  };
  if (typeof s?.safeParse !== 'function') return args;
  const parsed = s.safeParse(args);
  if (!parsed.success)
    throw new Error(
      `Rolecall: probe args for "${name}" do not match its inputSchema: ${parsed.error?.message}`,
    );
  return parsed.data;
}

/** Records or replays model calls through the scenario's cassette. */
function withCassette(model: ModelObject, cassette: CassetteHandle): ModelObject {
  if (cassette.mode === 'live') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate, params }) => {
        const { abortSignal: _a, headers: _h, ...rest } = params;
        const request = { provider: model.provider, modelId: model.modelId, ...rest };
        const hit = cassette.lookup(request) as Awaited<ReturnType<typeof doGenerate>> | undefined;
        if (hit) return revive(hit);
        const result = await doGenerate();
        cassette.store(request, {
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          warnings: result.warnings,
          ...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
          ...(result.response
            ? {
                response: {
                  id: result.response.id,
                  modelId: result.response.modelId,
                  timestamp: result.response.timestamp,
                },
              }
            : {}),
        });
        return result;
      },
      wrapStream: async () => {
        throw new Error(
          'Rolecall: streaming calls are not recorded yet. Use generateText-based agents under test.',
        );
      },
    },
  });
}

/** JSON turned the response timestamp into a string; restore the Date. */
function revive<T extends { response?: { timestamp?: Date } }>(hit: T): T {
  const ts = hit.response?.timestamp as unknown;
  if (hit.response && typeof ts === 'string')
    return { ...hit, response: { ...hit.response, timestamp: new Date(ts) } };
  return hit;
}
