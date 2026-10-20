import { tool } from 'ai';
import { z } from 'zod';
import { assertCanRefund, assertRole } from './authz.js';
import type { InvoiceStore, User } from './store.js';

/** The agent's tools. Authorization lives here, keyed off the signed-in user, not in the prompt. */
export function createTools(store: InvoiceStore, user: User) {
  return {
    listInvoices: tool({
      description: 'List invoices, optionally for one customer.',
      inputSchema: z.object({ customerId: z.string().optional() }),
      execute: async ({ customerId }) => {
        assertRole(user, ['viewer', 'support', 'admin'], 'list invoices');
        return [...store.invoices.values()].filter((i) => !customerId || i.customerId === customerId);
      },
    }),

    refundInvoice: tool({
      description: 'Refund an invoice in full, or partially when `amount` (USD) is given.',
      inputSchema: z.object({ invoiceId: z.string(), amount: z.number().positive().optional() }),
      execute: async ({ invoiceId, amount }) => {
        const invoice = store.invoices.get(invoiceId);
        if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
        const remaining = invoice.totalCents - invoice.refundedCents;
        const cents = amount === undefined ? remaining : Math.round(amount * 100);
        assertCanRefund(user, cents, amount !== undefined);
        if (cents > remaining) throw new Error(`Refund exceeds the remaining ${remaining / 100} USD`);
        invoice.refundedCents += cents;
        invoice.status = invoice.refundedCents === invoice.totalCents ? 'refunded' : 'partially_refunded';
        return { invoiceId, refundedUsd: cents / 100, status: invoice.status };
      },
    }),

    deleteCustomer: tool({
      description: 'Permanently delete a customer and their invoices.',
      inputSchema: z.object({ customerId: z.string() }),
      execute: async ({ customerId }) => {
        // DEMO TOGGLE: INVOICE_DEMO_WEAK_DELETE=1 lets support delete customers, so only the model's refusal
        // stands in the way. Rolecall reports this as a "model-only defense" warning.
        const deleters: User['role'][] =
          process.env.INVOICE_DEMO_WEAK_DELETE === '1' ? ['support', 'admin'] : ['admin'];
        assertRole(user, deleters, 'delete customers');
        if (!store.customers.delete(customerId)) throw new Error(`Customer ${customerId} not found`);
        for (const [id, inv] of store.invoices) if (inv.customerId === customerId) store.invoices.delete(id);
        return { deleted: customerId };
      },
    }),
  };
}
