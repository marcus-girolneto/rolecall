/** Injected wherever "now" matters (quotas, retention) so tests can control time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** `YYYY-MM` in UTC; the unit for monthly run quotas. */
export const billingPeriod = (d: Date): string => d.toISOString().slice(0, 7);
