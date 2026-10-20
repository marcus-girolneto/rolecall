// DADOS FICTÍCIOS para o tutorial. Nada aqui é real.

export type Papel = 'cliente' | 'atendente' | 'gerente';

export interface Usuario {
  id: string;
  nome: string;
  papel: Papel;
}

export interface Pedido {
  id: string;
  clienteId: string;
  produto: string;
  valorCentavos: number;
  reembolsadoCentavos: number;
  status: 'pago' | 'cancelado' | 'reembolsado' | 'parcialmente_reembolsado';
}

export interface Cliente {
  id: string;
  nome: string;
  email: string;
}

/** Um "banco de dados" em memória. Cada teste começa com uma cópia nova. */
export class Loja {
  readonly clientes = new Map<string, Cliente>([
    ['C-1', { id: 'C-1', nome: 'Ana Souza', email: 'ana@exemplo.test' }],
    ['C-2', { id: 'C-2', nome: 'Diego Lima', email: 'diego@exemplo.test' }],
  ]);

  readonly pedidos = new Map<string, Pedido>([
    [
      'P-100',
      {
        id: 'P-100',
        clienteId: 'C-1',
        produto: 'Fone Bluetooth',
        valorCentavos: 15_000,
        reembolsadoCentavos: 0,
        status: 'pago',
      },
    ],
    [
      'P-101',
      {
        id: 'P-101',
        clienteId: 'C-1',
        produto: 'Notebook',
        valorCentavos: 420_000,
        reembolsadoCentavos: 0,
        status: 'pago',
      },
    ],
    [
      'P-200',
      {
        id: 'P-200',
        clienteId: 'C-2',
        produto: 'Cafeteira',
        valorCentavos: 38_000,
        reembolsadoCentavos: 0,
        status: 'pago',
      },
    ],
  ]);

  /** O que as ferramentas podem mudar. O Rolecall compara isto antes e depois de cada teste. */
  foto() {
    return { clientes: Object.fromEntries(this.clientes), pedidos: Object.fromEntries(this.pedidos) };
  }
}
