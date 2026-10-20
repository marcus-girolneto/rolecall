import type { AuthContext } from '../../shared/auth.js';
import { billingPeriod, type Clock } from '../../shared/clock.js';
import { AppError, notFound } from '../../shared/errors.js';
import type { OrganizationsRepository } from '../organizations/repository.js';
import type { ProjectsRepository } from '../projects/repository.js';
import type { BillingEvent, BillingGateway } from './gateway.js';
import { isPlanId, PLANS, type PlanId, planOf } from './plans.js';
import type { ProcessedEventsRepository, UsageRepository } from './repository.js';
import type { BillingOverview, CheckoutInput } from './schemas.js';

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export class BillingService {
  constructor(
    private readonly deps: {
      orgs: OrganizationsRepository;
      projects: ProjectsRepository;
      usage: UsageRepository;
      events: ProcessedEventsRepository;
      gateway: BillingGateway;
      clock: Clock;
      publicUrl: string;
    },
  ) {}

  async overview(auth: AuthContext): Promise<BillingOverview> {
    const { orgs, projects, usage, gateway, clock } = this.deps;
    const org = await orgs.findById(auth.orgId);
    if (!org) throw notFound('Organization');
    const plan = planOf(org.plan);
    const period = billingPeriod(clock.now());
    const [runs, projectCount] = await Promise.all([
      usage.get(auth.orgId, period),
      projects.count(auth.orgId),
    ]);
    return {
      plan,
      period,
      usage: { runs, projects: projectCount },
      limits: {
        runsPerMonth: plan.runsPerMonth,
        maxProjects: plan.maxProjects,
        retentionDays: plan.retentionDays,
      },
      checkoutEnabled: gateway.checkoutEnabled,
      plans: Object.values(PLANS),
    };
  }

  async checkout(auth: AuthContext, input: CheckoutInput): Promise<{ url: string }> {
    const { orgs, gateway, publicUrl } = this.deps;
    const org = await orgs.findById(auth.orgId);
    if (!org) throw notFound('Organization');
    // A second checkout would start a second subscription and leave the first one billing.
    if (org.stripeSubscriptionId) {
      throw new AppError(
        'conflict',
        'This organization already has a subscription. Change or cancel it in Stripe before starting a new checkout.',
      );
    }
    const url = await gateway.createCheckoutSession({
      orgId: org.id,
      plan: input.plan,
      email: org.email,
      customerId: org.stripeCustomerId,
      successUrl: `${publicUrl}/billing?checkout=success`,
      cancelUrl: `${publicUrl}/billing?checkout=cancelled`,
    });
    return { url };
  }

  /**
   * Verifies and applies a webhook. Idempotent: an event id is applied at most once.
   * The id is recorded only after the change is applied, so a crash mid-way lets Stripe's retry finish the job;
   * the handlers themselves are idempotent (they set state, never increment).
   */
  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true; duplicate?: boolean }> {
    const { gateway, events } = this.deps;
    const event = gateway.parseWebhook(rawBody, signature);
    if (await events.has(event.id)) return { received: true, duplicate: true };
    await this.apply(event);
    const fresh = await events.record(event.id, event.type === 'ignored' ? event.originalType : event.type);
    return fresh ? { received: true } : { received: true, duplicate: true };
  }

  private async apply(event: BillingEvent): Promise<void> {
    const { orgs, gateway } = this.deps;
    switch (event.type) {
      case 'checkout.session.completed': {
        if (!event.orgId || !isPlanId(event.plan)) return;
        // Delayed payment methods complete checkout before the money arrives. The plan is then applied by
        // customer.subscription.updated once the subscription becomes active.
        if (event.paymentStatus !== 'paid' && event.paymentStatus !== 'no_payment_required') return;
        const org = await orgs.findById(event.orgId);
        if (!org) return;
        await orgs.updateBilling(org.id, {
          plan: event.plan,
          stripeCustomerId: event.customerId ?? org.stripeCustomerId,
          stripeSubscriptionId: event.subscriptionId ?? org.stripeSubscriptionId,
        });
        return;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        if (!event.customerId) return;
        const org = await orgs.findByStripeCustomerId(event.customerId);
        if (!org) return;
        // Ignore stale events about a subscription the org has since replaced.
        if (org.stripeSubscriptionId && org.stripeSubscriptionId !== event.subscriptionId) return;
        let plan: PlanId = 'free';
        if (event.type === 'customer.subscription.updated' && ACTIVE_STATUSES.has(event.status)) {
          const fromMeta = isPlanId(event.plan) ? event.plan : null;
          const fromPrice =
            event.priceIds.map((p) => gateway.planForPrice(p)).find((p) => p !== null) ?? null;
          // The price actually billed wins over metadata, so a plan change made in Stripe is respected.
          plan = fromPrice ?? fromMeta ?? planOf(org.plan).id;
        }
        await orgs.updateBilling(org.id, {
          plan,
          stripeSubscriptionId: event.type === 'customer.subscription.deleted' ? null : event.subscriptionId,
        });
        return;
      }
      case 'ignored':
        return;
    }
  }
}
