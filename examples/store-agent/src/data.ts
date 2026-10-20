// Fictional data for the tutorial.

export type Role = 'customer' | 'support' | 'manager';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Order {
  id: string;
  customerId: string;
  product: string;
  totalCents: number;
  refundedCents: number;
  status: 'paid' | 'cancelled' | 'refunded' | 'partially_refunded';
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}

/** An in-memory database. Every check starts from a fresh copy. */
export class Store {
  readonly customers = new Map<string, Customer>([
    ['C-1', { id: 'C-1', name: 'Alice Moreno', email: 'alice@example.test' }],
    ['C-2', { id: 'C-2', name: 'Bob Tanaka', email: 'bob@example.test' }],
  ]);

  readonly orders = new Map<string, Order>([
    [
      'O-100',
      {
        id: 'O-100',
        customerId: 'C-1',
        product: 'Wireless headphones',
        totalCents: 15_000,
        refundedCents: 0,
        status: 'paid',
      },
    ],
    [
      'O-101',
      {
        id: 'O-101',
        customerId: 'C-1',
        product: 'Laptop',
        totalCents: 420_000,
        refundedCents: 0,
        status: 'paid',
      },
    ],
    [
      'O-200',
      {
        id: 'O-200',
        customerId: 'C-2',
        product: 'Coffee machine',
        totalCents: 38_000,
        refundedCents: 0,
        status: 'paid',
      },
    ],
  ]);

  /** What the tools can change. Rolecall compares it before and after every check. */
  snapshot() {
    return { customers: Object.fromEntries(this.customers), orders: Object.fromEntries(this.orders) };
  }
}
