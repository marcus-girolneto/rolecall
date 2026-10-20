// Converse com o chatbot da loja no terminal:  pnpm conversar cliente | atendente | gerente
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { openRouterModel } from '@rolecall/ai-sdk';
import type { ModelMessage } from 'ai';
import { responder } from './agente.js';
import { Loja, type Papel, type Usuario } from './dados.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.OPENROUTER_API_KEY) {
  console.error('Falta a chave: copie .env.example para .env e preencha OPENROUTER_API_KEY.');
  process.exit(1);
}

const USUARIOS: Record<Papel, Usuario> = {
  cliente: { id: 'C-1', nome: 'Ana Souza', papel: 'cliente' },
  atendente: { id: 'A-1', nome: 'Bruno (atendimento)', papel: 'atendente' },
  gerente: { id: 'G-1', nome: 'Carla (gerência)', papel: 'gerente' },
};
const papel = (process.argv[2] ?? 'cliente') as Papel;
const usuario = USUARIOS[papel];
if (!usuario) {
  console.error('Use: pnpm conversar cliente | atendente | gerente');
  process.exit(1);
}

const modelo = openRouterModel(
  process.env.LOJA_MODELO ?? 'google/gemini-2.5-flash-lite,deepseek/deepseek-v4.1-flash,openai/gpt-oss-120b',
);
const loja = new Loja();
const conversa: ModelMessage[] = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log(
  `\nVocê está logado como ${usuario.nome} (${usuario.papel}). Dados fictícios: pedidos P-100, P-101 (da Ana) e P-200 (do Diego).`,
);
console.log('Escreva para o chatbot. "sair" para terminar.\n');

for (;;) {
  let texto: string;
  try {
    texto = (await rl.question('você > ')).trim();
  } catch {
    break; // entrada encerrada (Ctrl+D ou texto encaminhado)
  }
  if (!texto || texto === 'sair') break;
  conversa.push({ role: 'user', content: texto });
  try {
    const { texto: resposta, mensagens } = await responder(modelo, loja, usuario, conversa);
    for (const m of mensagens) {
      if (m.role !== 'tool' || !Array.isArray(m.content)) continue;
      for (const parte of m.content) {
        if (parte.type !== 'tool-result') continue;
        const erro = parte.output.type.startsWith('error');
        console.log(
          `   ${erro ? '⛔' : '🔧'} ${parte.toolName} → ${JSON.stringify('value' in parte.output ? parte.output.value : parte.output)}`,
        );
      }
    }
    conversa.push(...mensagens);
    console.log(`bot  > ${resposta}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(
      /rate.?limit|429|too many requests/i.test(msg)
        ? '(o provedor do modelo está congestionado agora; espere alguns segundos e mande de novo, ou ponha um modelo reserva em LOJA_MODELO)\n'
        : `(erro: ${msg})\n`,
    );
  }
}
rl.close();
