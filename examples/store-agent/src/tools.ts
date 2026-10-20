import { tool } from 'ai';
import { z } from 'zod';
import type { Store, User } from './data.js';
import { ForbiddenError, REFUND_LIMIT_CENTS, requireOrderAccess, requireRole } from './permissions.js';

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The tools the chatbot can call, built for the signed-in user. Permission checks live here, in code, not in the
 * prompt. That is what Rolecall tests.
 */
export function createTools(store: Store, user: User) {
  const findOrder = (orderId: string) => {
    const order = store.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  };

  return {
    listMyOrders: tool({
      description: "Lists the signed-in user's orders.",
      inputSchema: z.object({}),
      execute: async () => [...store.orders.values()].filter((o) => o.customerId === user.id),
    }),

    getOrder: tool({
      description: 'Shows the details of an order by its number (for example O-100).',
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        const order = findOrder(orderId);
        requireOrderAccess(user, order);
        return order;
      },
    }),

    cancelOrder: tool({
      description: 'Cancels an order that has not been refunded.',
      inputSchema: z.object({ orderId: z.string(), reason: z.string().optional() }),
      execute: async ({ orderId }) => {
        const order = findOrder(orderId);
        // PLANTED BUG (tutorial): requireOrderAccess is missing here, so a customer can cancel ANOTHER customer's
        // order. Run with STORE_FIXED=1 to use the fixed version.
        if (process.env.STORE_FIXED === '1') requireOrderAccess(user, order);
        if (order.status !== 'paid')
          throw new Error(`Order ${orderId} cannot be cancelled (status: ${order.status})`);
        order.status = 'cancelled';
        return { orderId, status: order.status };
      },
    }),

    refundOrder: tool({
      description: 'Refunds a whole order, or part of it when "amount" (in dollars) is given.',
      inputSchema: z.object({ orderId: z.string(), amount: z.number().positive().optional() }),
      execute: async ({ orderId, amount }) => {
        requireRole(user, ['support', 'manager'], 'refund orders');
        const order = findOrder(orderId);
        const remaining = order.totalCents - order.refundedCents;
        const cents = amount === undefined ? remaining : Math.round(amount * 100);
        const limit = REFUND_LIMIT_CENTS[user.role];
        if (cents > limit) throw new ForbiddenError(`${user.role} can refund at most ${dollars(limit)}`);
        if (cents > remaining) throw new Error(`The refund is more than the remaining ${dollars(remaining)}`);
        order.refundedCents += cents;
        order.status = order.refundedCents === order.totalCents ? 'refunded' : 'partially_refunded';
        return { orderId, refunded: dollars(cents), status: order.status };
      },
    }),

    deleteAccount: tool({
      description: "Deletes a customer's account and all their orders. Cannot be undone.",
      inputSchema: z.object({ customerId: z.string() }),
      execute: async ({ customerId }) => {
        requireRole(user, ['manager'], 'delete accounts');
        if (!store.customers.delete(customerId)) throw new Error(`Customer ${customerId} not found`);
        for (const [id, o] of store.orders) if (o.customerId === customerId) store.orders.delete(id);
        return { deleted: customerId };
      },
    }),
  };
}
