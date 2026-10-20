import { tool } from 'ai';
import { z } from 'zod';
import type { Loja, Usuario } from './dados.js';
import { exigirAcessoAoPedido, exigirPapel, ForbiddenError, LIMITE_REEMBOLSO } from './permissoes.js';

const reais = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

/**
 * As ferramentas que o chatbot pode chamar, montadas para o usuário que está logado.
 * A checagem de permissão fica AQUI, no código, e não no prompt. É isso que o Rolecall testa.
 */
export function createTools(loja: Loja, usuario: Usuario) {
  const buscarPedido = (pedidoId: string) => {
    const pedido = loja.pedidos.get(pedidoId);
    if (!pedido) throw new Error(`Pedido ${pedidoId} não encontrado`);
    return pedido;
  };

  return {
    listarMeusPedidos: tool({
      description: 'Lista os pedidos do usuário logado.',
      inputSchema: z.object({}),
      execute: async () => [...loja.pedidos.values()].filter((p) => p.clienteId === usuario.id),
    }),

    verPedido: tool({
      description: 'Mostra os detalhes de um pedido pelo número (ex.: P-100).',
      inputSchema: z.object({ pedidoId: z.string() }),
      execute: async ({ pedidoId }) => {
        const pedido = buscarPedido(pedidoId);
        exigirAcessoAoPedido(usuario, pedido);
        return pedido;
      },
    }),

    cancelarPedido: tool({
      description: 'Cancela um pedido que ainda não foi reembolsado.',
      inputSchema: z.object({ pedidoId: z.string(), motivo: z.string().optional() }),
      execute: async ({ pedidoId }) => {
        const pedido = buscarPedido(pedidoId);
        // BUG DE PROPÓSITO (tutorial): falta exigirAcessoAoPedido aqui, então um cliente consegue cancelar o pedido
        // de OUTRO cliente. Rode com LOJA_CORRIGIDA=1 para usar a versão corrigida.
        if (process.env.LOJA_CORRIGIDA === '1') exigirAcessoAoPedido(usuario, pedido);
        if (pedido.status !== 'pago')
          throw new Error(`Pedido ${pedidoId} não pode ser cancelado (status: ${pedido.status})`);
        pedido.status = 'cancelado';
        return { pedidoId, status: pedido.status };
      },
    }),

    reembolsar: tool({
      description: 'Reembolsa um pedido inteiro, ou parte dele quando "valor" (em reais) é informado.',
      inputSchema: z.object({ pedidoId: z.string(), valor: z.number().positive().optional() }),
      execute: async ({ pedidoId, valor }) => {
        exigirPapel(usuario, ['atendente', 'gerente'], 'reembolsar pedidos');
        const pedido = buscarPedido(pedidoId);
        const restante = pedido.valorCentavos - pedido.reembolsadoCentavos;
        const centavos = valor === undefined ? restante : Math.round(valor * 100);
        const limite = LIMITE_REEMBOLSO[usuario.papel];
        if (centavos > limite)
          throw new ForbiddenError(`${usuario.papel} pode reembolsar no máximo ${reais(limite)}`);
        if (centavos > restante) throw new Error(`O reembolso passa do valor restante de ${reais(restante)}`);
        pedido.reembolsadoCentavos += centavos;
        pedido.status =
          pedido.reembolsadoCentavos === pedido.valorCentavos ? 'reembolsado' : 'parcialmente_reembolsado';
        return { pedidoId, reembolsado: reais(centavos), status: pedido.status };
      },
    }),

    apagarConta: tool({
      description: 'Apaga a conta de um cliente e todos os pedidos dele. Irreversível.',
      inputSchema: z.object({ clienteId: z.string() }),
      execute: async ({ clienteId }) => {
        exigirPapel(usuario, ['gerente'], 'apagar contas');
        if (!loja.clientes.delete(clienteId)) throw new Error(`Cliente ${clienteId} não encontrado`);
        for (const [id, p] of loja.pedidos) if (p.clienteId === clienteId) loja.pedidos.delete(id);
        return { apagado: clienteId };
      },
    }),
  };
}
