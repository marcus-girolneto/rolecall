// Chat with the store's chatbot in your terminal:  pnpm chat customer | support | manager
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { openRouterModel } from '@rolecall/ai-sdk';
import type { ModelMessage } from 'ai';
import { reply } from './agent.js';
import { type Role, Store, type User } from './data.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.OPENROUTER_API_KEY) {
  console.error('Missing API key: copy .env.example to .env and set OPENROUTER_API_KEY.');
  process.exit(1);
}

const USERS: Record<Role, User> = {
  customer: { id: 'C-1', name: 'Alice Moreno', role: 'customer' },
  support: { id: 'S-1', name: 'Sam (support)', role: 'support' },
  manager: { id: 'M-1', name: 'Maria (manager)', role: 'manager' },
};
const user = USERS[(process.argv[2] ?? 'customer') as Role];
if (!user) {
  console.error('Usage: pnpm chat customer | support | manager');
  process.exit(1);
}

const model = openRouterModel(
  process.env.STORE_MODEL ?? 'google/gemini-2.5-flash-lite,deepseek/deepseek-v4.1-flash,openai/gpt-oss-120b',
);
const store = new Store();
const conversation: ModelMessage[] = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log(
  `\nSigned in as ${user.name} (${user.role}). Fictional data: orders O-100, O-101 (Alice's) and O-200 (Bob's).`,
);
console.log('Type a message for the chatbot, or "exit" to quit.\n');

for (;;) {
  let text: string;
  try {
    text = (await rl.question('you > ')).trim();
  } catch {
    break; // input closed (Ctrl+D or piped text)
  }
  if (!text || text === 'exit') break;
  conversation.push({ role: 'user', content: text });
  try {
    const { text: answer, messages } = await reply(model, store, user, conversation);
    for (const m of messages) {
      if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
      for (const part of m.content) {
        if (part.type !== 'tool-result') continue;
        const failed = part.output.type.startsWith('error');
        const value = 'value' in part.output ? part.output.value : part.output;
        console.log(`   ${failed ? '⛔' : '🔧'} ${part.toolName} → ${JSON.stringify(value)}`);
      }
    }
    conversation.push(...messages);
    console.log(`bot > ${answer}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(
      /rate.?limit|429|too many requests/i.test(msg)
        ? '(the model provider is busy right now; wait a few seconds and send it again, or add fallbacks to STORE_MODEL)\n'
        : `(error: ${msg})\n`,
    );
  }
}
rl.close();
