import type { LanguageModel } from 'ai';

type ModelObject = Exclude<LanguageModel, string>;

const DETERMINISTIC = Symbol.for('rolecall.deterministic');

export interface ScriptContext {
  /** Text of the most recent user message. */
  userText: string;
  /** Results of tool calls made since that user message, in order. */
  toolResults: Array<{ tool: string; output: unknown; isError: boolean }>;
}

export type ScriptStep =
  | { text: string }
  | { toolCalls: Array<{ tool: string; args: unknown }>; text?: string };

/**
 * A deterministic stand-in for an LLM, driven by your own function. Use it to exercise the tool and
 * authorization layers with zero tokens and zero network. It is a test double, not a model.
 */
export function scriptedModel(script: (ctx: ScriptContext) => ScriptStep, modelId = 'scripted'): ModelObject {
  let callSeq = 0;
  const model = {
    specificationVersion: 'v4',
    provider: 'rolecall',
    modelId,
    supportedUrls: {},
    async doGenerate(options: { prompt: Array<{ role: string; content: unknown }> }) {
      const step = script(readPrompt(options.prompt));
      const content: unknown[] = [];
      if ('text' in step && step.text) content.push({ type: 'text', text: step.text });
      const calls = 'toolCalls' in step ? step.toolCalls : [];
      for (const c of calls) {
        content.push({
          type: 'tool-call',
          toolCallId: `call_${++callSeq}`,
          toolName: c.tool,
          input: JSON.stringify(c.args),
        });
      }
      return {
        content,
        finishReason: { unified: calls.length ? 'tool-calls' : 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('scriptedModel does not support streaming.');
    },
    [DETERMINISTIC]: true,
  };
  return model as unknown as ModelObject;
}

export function isDeterministic(model: unknown): boolean {
  return (
    typeof model === 'object' && model !== null && (model as Record<symbol, unknown>)[DETERMINISTIC] === true
  );
}

function readPrompt(prompt: Array<{ role: string; content: unknown }>): ScriptContext {
  let lastUser = -1;
  prompt.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  const user = prompt[lastUser];
  const userText = Array.isArray(user?.content)
    ? (user.content as Array<{ type: string; text?: string }>)
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
    : String(user?.content ?? '');

  const toolResults: ScriptContext['toolResults'] = [];
  for (const m of prompt.slice(lastUser + 1)) {
    if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<{
      type: string;
      toolName: string;
      output: { type: string; value: unknown };
    }>) {
      if (part.type !== 'tool-result') continue;
      toolResults.push({
        tool: part.toolName,
        output: part.output?.value,
        isError: part.output?.type === 'error-text' || part.output?.type === 'error-json',
      });
    }
  }
  return { userText, toolResults };
}
