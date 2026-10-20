import type { Order, Role, User } from './data.js';

/** Thrown when the signed-in user may not do something. Rolecall recognises it by name. */
export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

/** Largest refund per call, in cents. Customers cannot refund. */
export const REFUND_LIMIT_CENTS: Record<Role, number> = {
  customer: 0,
  support: 20_000, // $200
  manager: Number.POSITIVE_INFINITY,
};

export function requireRole(user: User, allowed: Role[], action: string): void {
  if (!allowed.includes(user.role)) throw new ForbiddenError(`${user.role} cannot ${action}`);
}

/** Customers only see and change their own orders. Support and managers see all of them. */
export function requireOrderAccess(user: User, order: Order): void {
  if (user.role === 'customer' && order.customerId !== user.id) {
    throw new ForbiddenError('this order belongs to another customer');
  }
}
