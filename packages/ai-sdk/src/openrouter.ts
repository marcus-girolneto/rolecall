import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { type LanguageModel, wrapLanguageModel } from 'ai';

const MISSING_KEY =
  'OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys and put it in .env. ' +
  'Recorded runs (`rolecall run`, the default replay mode) do not need it.';

/**
 * A model served through OpenRouter (https://openrouter.ai), e.g. "deepseek/deepseek-v4.1-flash" or
 * "google/gemini-2.5-flash-lite". Reads OPENROUTER_API_KEY unless `apiKey` is given. Without a key the model can
 * still replay recorded answers; it only fails if it is actually called.
 */
export function openRouterModel(
  modelId: string,
  apiKey = process.env.OPENROUTER_API_KEY,
): Exclude<LanguageModel, string> {
  const model = createOpenRouter({
    apiKey: apiKey ?? 'unset',
    appName: 'Rolecall',
    appUrl: 'https://github.com/marcus-girolneto/rolecall',
  }).languageModel(modelId) as unknown as Exclude<LanguageModel, string>;
  if (apiKey) return model;
  return wrapLanguageModel({
    model: model as never,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async () => {
        throw new Error(MISSING_KEY);
      },
      wrapStream: async () => {
        throw new Error(MISSING_KEY);
      },
    },
  }) as unknown as Exclude<LanguageModel, string>;
}
