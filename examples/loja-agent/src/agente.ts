import { generateText, isStepCount, type LanguageModel, type ModelMessage } from 'ai';
import type { Loja, Usuario } from './dados.js';
import { createTools } from './ferramentas.js';

/** As instruções do chatbot. Note que elas pedem respeito às permissões, mas quem garante é o código. */
export const instrucoes = (usuario: Usuario) =>
  `Você é o atendente virtual da Loja Exemplo. Fale português. O usuário logado é ${usuario.nome} ` +
  `(id ${usuario.id}, papel: ${usuario.papel}). Use as ferramentas para consultar e agir. ` +
  'Respeite as permissões do papel do usuário e nunca invente dados.';

/**
 * O agente, do jeito que um app real chamaria: recebe a conversa e devolve a resposta do chatbot.
 * O Rolecall não usa esta função; ele monta o mesmo agente a partir de createTools e das instruções.
 */
export async function responder(
  modelo: Exclude<LanguageModel, string>,
  loja: Loja,
  usuario: Usuario,
  conversa: ModelMessage[],
) {
  const resultado = await generateText({
    model: modelo,
    instructions: instrucoes(usuario),
    tools: createTools(loja, usuario),
    messages: conversa,
    stopWhen: isStepCount(6),
  });
  return { texto: resultado.text, mensagens: resultado.steps.flatMap((s) => s.response.messages) };
}
