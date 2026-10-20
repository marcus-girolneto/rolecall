import Stripe from 'stripe';
import { AppError } from '../../shared/errors.js';
import type { PaidPlanId } from './plans.js';

/** Minimal, provider-neutral view of the payment events we act on. */
export type BillingEvent =
  | {
      id: string;
      type: 'checkout.session.completed';
      orgId: string | null;
      plan: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      /** Stripe's payment_status: 'paid', 'unpaid' or 'no_payment_required'. */
      paymentStatus: string | null;
    }
  | {
      id: string;
      type: 'customer.subscription.updated' | 'customer.subscription.deleted';
      customerId: string | null;
      subscriptionId: string;
      status: string;
      plan: string | null;
      priceIds: string[];
    }
  | { id: string; type: 'ignored'; originalType: string };

export interface CheckoutRequest {
  orgId: string;
  plan: PaidPlanId;
  email: string;
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

/** Port for the payment provider. The Stripe adapter is the only implementation; tests use it with a test secret. */
export interface BillingGateway {
  readonly checkoutEnabled: boolean;
  createCheckoutSession(req: CheckoutRequest): Promise<string>;
  /** Verifies the signature against the exact raw body and returns the parsed event; throws AppError('invalid_signature'). */
  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent;
  /** Price id → plan, for subscription updates that do not carry plan metadata. */
  planForPrice(priceId: string): PaidPlanId | null;
}

export interface StripeGatewayConfig {
  secretKey?: string | undefined;
  webhookSecret?: string | undefined;
  prices: Partial<Record<PaidPlanId, string | undefined>>;
}

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === 'string' ? v : (v?.id ?? null);

export class StripeBillingGateway implements BillingGateway {
  private readonly client: Stripe | null;

  constructor(private readonly config: StripeGatewayConfig) {
    this.client = config.secretKey ? new Stripe(config.secretKey) : null;
  }

  get checkoutEnabled(): boolean {
    return this.client !== null;
  }

  async createCheckoutSession(req: CheckoutRequest): Promise<string> {
    if (!this.client)
      throw new AppError(
        'billing_disabled',
        'Billing is not configured on this server (STRIPE_SECRET_KEY is unset)',
      );
    const price = this.config.prices[req.plan];
    if (!price) throw new AppError('billing_disabled', `No Stripe price configured for plan "${req.plan}"`);
    const session = await this.client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: req.orgId,
      ...(req.customerId ? { customer: req.customerId } : { customer_email: req.email }),
      metadata: { orgId: req.orgId, plan: req.plan },
      subscription_data: { metadata: { orgId: req.orgId, plan: req.plan } },
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
    });
    if (!session.url) throw new AppError('unavailable', 'Stripe did not return a checkout URL');
    return session.url;
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (!this.config.webhookSecret)
      throw new AppError('billing_disabled', 'Webhooks are not configured (STRIPE_WEBHOOK_SECRET is unset)');
    if (!signature) throw new AppError('invalid_signature', 'Missing Stripe-Signature header');
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch {
      throw new AppError('invalid_signature', 'Stripe signature verification failed');
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        return {
          id: event.id,
          type: event.type,
          orgId: s.client_reference_id ?? s.metadata?.orgId ?? null,
          plan: s.metadata?.plan ?? null,
          customerId: idOf(s.customer),
          subscriptionId: idOf(s.subscription),
          paymentStatus: s.payment_status ?? null,
        };
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        return {
          id: event.id,
          type: event.type,
          customerId: idOf(sub.customer),
          subscriptionId: sub.id,
          status: sub.status,
          plan: sub.metadata?.plan ?? null,
          priceIds: sub.items?.data?.map((i) => i.price.id) ?? [],
        };
      }
      default:
        return { id: event.id, type: 'ignored', originalType: event.type };
    }
  }

  planForPrice(priceId: string): PaidPlanId | null {
    for (const [plan, id] of Object.entries(this.config.prices))
      if (id && id === priceId) return plan as PaidPlanId;
    return null;
  }
}
