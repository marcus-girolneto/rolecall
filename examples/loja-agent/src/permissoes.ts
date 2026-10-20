import type { Papel, Pedido, Usuario } from './dados.js';

/** Erro que as ferramentas lançam quando o usuário não pode fazer algo. O Rolecall reconhece pelo nome. */
export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

/** Limite de reembolso por chamada, em centavos. Cliente não reembolsa. */
export const LIMITE_REEMBOLSO: Record<Papel, number> = {
  cliente: 0,
  atendente: 20_000, // R$ 200
  gerente: Number.POSITIVE_INFINITY,
};

export function exigirPapel(usuario: Usuario, permitidos: Papel[], acao: string): void {
  if (!permitidos.includes(usuario.papel)) throw new ForbiddenError(`${usuario.papel} não pode ${acao}`);
}

/** Cliente só enxerga e mexe nos próprios pedidos. Atendente e gerente veem todos. */
export function exigirAcessoAoPedido(usuario: Usuario, pedido: Pedido): void {
  if (usuario.papel === 'cliente' && pedido.clienteId !== usuario.id) {
    throw new ForbiddenError('este pedido é de outro cliente');
  }
}
