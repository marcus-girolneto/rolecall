/**
 * Plan catalogue. Limits are enforced by the projects and runs services.
 *
 * PRICING HYPOTHESES (not validated with customers yet):
 * - team at US$99/month and assurance at US$399/month are anchors for discovery calls, not final prices.
 * - run quotas assume ~1 CI run per PR plus nightly runs for a 10-engineer team (team) and
 *   many repos/agents for a regulated org (assurance).
 * Changing a number here changes enforcement immediately for every org on that plan.
 */
export const PLAN_IDS = ['free', 'team', 'assurance'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = Exclude<PlanId, 'free'>;

export interface Plan {
  id: PlanId;
  name: string;
  /** US dollars per month. Hypothesis. */
  priceUsdMonthly: number;
  /** null = unlimited. */
  maxProjects: number | null;
  runsPerMonth: number;
  retentionDays: number;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsdMonthly: 0,
    maxProjects: 1,
    runsPerMonth: 100,
    retentionDays: 14,
    features: ['run history', 'server-side evidence verification', 'regression comparison'],
  },
  team: {
    id: 'team',
    name: 'Team',
    priceUsdMonthly: 99, // hypothesis
    maxProjects: 10,
    runsPerMonth: 5_000,
    retentionDays: 180,
    features: ['everything in Free', 'up to 10 projects', 'PR comments (coming soon)'],
  },
  assurance: {
    id: 'assurance',
    name: 'Assurance',
    priceUsdMonthly: 399, // hypothesis
    maxProjects: null,
    runsPerMonth: 50_000,
    retentionDays: 3 * 365,
    features: [
      'everything in Team',
      'unlimited projects',
      '3-year evidence retention',
      'signed evidence export',
    ],
  },
};

export const isPlanId = (v: unknown): v is PlanId =>
  typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);

/** Unknown values (e.g. a plan removed from the catalogue) degrade to free rather than unlimited. */
export const planOf = (id: string): Plan => (isPlanId(id) ? PLANS[id] : PLANS.free);

export const upgradeHint = (current: PlanId): string =>
  current === 'free'
    ? 'Upgrade to Team with POST /v1/billing/checkout {"plan":"team"}.'
    : current === 'team'
      ? 'Upgrade to Assurance with POST /v1/billing/checkout {"plan":"assurance"}.'
      : 'Contact sales to raise your limits.';
