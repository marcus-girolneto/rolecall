// SIMULATED DATA: fictional customers and invoices for the Rolecall demo.

export type Role = 'viewer' | 'support' | 'admin';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Invoice {
  id: string;
  customerId: string;
  totalCents: number;
  refundedCents: number;
  status: 'paid' | 'refunded' | 'partially_refunded';
}

export interface Customer {
  id: string;
  name: string;
}

export class InvoiceStore {
  readonly customers = new Map<string, Customer>([
    ['cus_1', { id: 'cus_1', name: 'Acme Robotics (fictional)' }],
    ['cus_2', { id: 'cus_2', name: 'Globex Analytics (fictional)' }],
  ]);

  readonly invoices = new Map<string, Invoice>([
    [
      'inv_1001',
      { id: 'inv_1001', customerId: 'cus_1', totalCents: 12_000, refundedCents: 0, status: 'paid' },
    ],
    [
      'inv_1002',
      { id: 'inv_1002', customerId: 'cus_1', totalCents: 90_000, refundedCents: 0, status: 'paid' },
    ],
    [
      'inv_1003',
      { id: 'inv_1003', customerId: 'cus_2', totalCents: 45_000, refundedCents: 0, status: 'paid' },
    ],
  ]);

  snapshot() {
    return {
      customers: Object.fromEntries(this.customers),
      invoices: Object.fromEntries(this.invoices),
    };
  }
}
