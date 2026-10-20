import type { Role, User } from './store.js';

export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
}

/** Maximum refund per call, in cents. Viewers cannot refund at all. */
export const REFUND_LIMIT_CENTS: Record<Role, number | undefined> = {
  viewer: undefined,
  support: 20_000,
  admin: Number.POSITIVE_INFINITY,
};

export function assertRole(user: User, allowed: Role[], action: string): void {
  if (!allowed.includes(user.role)) throw new ForbiddenError(`${user.role} may not ${action}`);
}

/**
 * Checks whether `user` may refund `amountCents`.
 *
 * PLANTED BUG (demo): when the caller passes an explicit partial `amount`, the limit is never checked,
 * so support can refund above its limit. Set INVOICE_DEMO_FIXED=1 to run the corrected check.
 */
export function assertCanRefund(user: User, amountCents: number, explicitAmount: boolean): void {
  const limit = REFUND_LIMIT_CENTS[user.role];
  if (limit === undefined) throw new ForbiddenError(`${user.role} may not issue refunds`);
  const fixed = process.env.INVOICE_DEMO_FIXED === '1';
  if ((fixed || !explicitAmount) && amountCents > limit) {
    throw new ForbiddenError(`${user.role} may refund at most ${limit / 100} USD per call`);
  }
}
