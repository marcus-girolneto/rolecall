import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: createdAt(),
});

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('projects_org_slug_uq').on(t.orgId, t.slug)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** When set, the key can only touch this project (typical CI ingest key). */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('api_keys_org_idx').on(t.orgId)],
);

export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `runId` from the manifest (local id assigned by the CLI). */
    bundleRunId: text('bundle_run_id').notNull(),
    rootHash: text('root_hash').notNull(),
    suiteName: text('suite_name').notNull(),
    suiteHash: text('suite_hash').notNull(),
    gitBranch: text('git_branch'),
    gitSha: text('git_sha'),
    gitDirty: boolean('git_dirty'),
    mode: text('mode').notNull(),
    total: integer('total').notNull(),
    pass: integer('pass').notNull(),
    fail: integer('fail').notNull(),
    warn: integer('warn').notNull(),
    error: integer('error').notNull(),
    signed: boolean('signed').notNull(),
    verified: boolean('verified').notNull(),
    manifest: text('manifest').notNull(),
    results: text('results').notNull(),
    events: text('events').notNull(),
    signature: text('signature'),
    /** From the manifest: when the run happened. */
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** When the Cloud accepted the upload. */
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('runs_project_root_hash_uq').on(t.projectId, t.rootHash),
    index('runs_org_created_idx').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('runs_baseline_idx').on(t.projectId, t.suiteName, t.gitBranch, t.createdAt.desc()),
  ],
);

/** Accepted uploads per org per UTC month. Deleting a run does not refund quota. */
export const usageCounters = pgTable(
  'usage_counters',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    runs: integer('runs').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.period] })],
);

/** Stripe event ids already handled; makes webhook delivery idempotent. */
export const processedEvents = pgTable('processed_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull().default(sql`now()`),
});

export const schema = { organizations, projects, apiKeys, runs, usageCounters, processedEvents };
