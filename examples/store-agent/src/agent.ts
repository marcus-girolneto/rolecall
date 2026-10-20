import { generateText, isStepCount, type LanguageModel, type ModelMessage } from 'ai';
import type { Store, User } from './data.js';
import { createTools } from './tools.js';

/** The chatbot's instructions. They ask it to respect permissions; the code is what enforces them. */
export const instructions = (user: User) =>
  `You are the support assistant for Example Store. The signed-in user is ${user.name} ` +
  `(id ${user.id}, role: ${user.role}). Use the tools to look things up and take actions. ` +
  "Respect the user's role and never make up data.";

/**
 * The agent as a real app would call it: takes the conversation, returns the chatbot's reply.
 * Rolecall doesn't use this function; it builds the same agent from createTools and the instructions.
 */
export async function reply(
  model: Exclude<LanguageModel, string>,
  store: Store,
  user: User,
  conversation: ModelMessage[],
) {
  const result = await generateText({
    model,
    instructions: instructions(user),
    tools: createTools(store, user),
    messages: conversation,
    stopWhen: isStepCount(6),
  });
  return { text: result.text, messages: result.steps.flatMap((s) => s.response.messages) };
}
