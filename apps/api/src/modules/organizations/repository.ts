import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { apiKeys, organizations, projects } from '../../db/schema.js';
import type { Scope } from '../../shared/auth.js';

export interface Organization {
  id: string;
  name: string;
  email: string;
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
}

export interface NewOrgBundle {
  org: { id: string; name: string; email: string };
  project: { id: string; name: string; slug: string; defaultBranch: string };
  key: { id: string; name: string; prefix: string; hash: string; scopes: Scope[] };
}

export interface BillingUpdate {
  plan: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface OrganizationsRepository {
  /** Creates the org, its default project and its first admin key atomically. */
  createWithDefaults(input: NewOrgBundle): Promise<void>;
  findById(orgId: string): Promise<Organization | null>;
  /** System lookup used only by verified Stripe webhooks. */
  findByStripeCustomerId(customerId: string): Promise<Organization | null>;
  updateBilling(orgId: string, update: BillingUpdate): Promise<void>;
}

export class DrizzleOrganizationsRepository implements OrganizationsRepository {
  constructor(private readonly db: Database) {}

  async createWithDefaults({ org, project, key }: NewOrgBundle): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(organizations).values(org);
      await tx.insert(projects).values({ ...project, orgId: org.id });
      await tx.insert(apiKeys).values({ ...key, orgId: org.id, projectId: null });
    });
  }

  async findById(orgId: string): Promise<Organization | null> {
    const [row] = await this.db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return row ?? null;
  }

  async findByStripeCustomerId(customerId: string): Promise<Organization | null> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.stripeCustomerId, customerId))
      .limit(1);
    return row ?? null;
  }

  async updateBilling(orgId: string, update: BillingUpdate): Promise<void> {
    await this.db.update(organizations).set(update).where(eq(organizations.id, orgId));
  }
}
