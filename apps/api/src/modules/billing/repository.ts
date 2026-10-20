import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { processedEvents, usageCounters } from '../../db/schema.js';

export interface UsageRepository {
  /** Runs accepted for the org in `period` (YYYY-MM). */
  get(orgId: string, period: string): Promise<number>;
  /**
   * Atomically increments the counter only while it is below `limit`.
   * Returns false when the quota is exhausted. Safe under concurrent uploads.
   */
  tryConsume(orgId: string, period: string, limit: number): Promise<boolean>;
  /** Gives back one unit (used when an upload turns out to be a concurrent duplicate). */
  release(orgId: string, period: string): Promise<void>;
}

export interface ProcessedEventsRepository {
  has(id: string): Promise<boolean>;
  /** Returns false when the event was already recorded. */
  record(id: string, type: string): Promise<boolean>;
}

export class DrizzleUsageRepository implements UsageRepository {
  constructor(private readonly db: Database) {}

  async get(orgId: string, period: string): Promise<number> {
    const [row] = await this.db
      .select({ runs: usageCounters.runs })
      .from(usageCounters)
      .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.period, period)))
      .limit(1);
    return row?.runs ?? 0;
  }

  async tryConsume(orgId: string, period: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const rows = await this.db
      .insert(usageCounters)
      .values({ orgId, period, runs: 1 })
      .onConflictDoUpdate({
        target: [usageCounters.orgId, usageCounters.period],
        set: { runs: sql`${usageCounters.runs} + 1` },
        setWhere: sql`${usageCounters.runs} < ${limit}`,
      })
      .returning({ runs: usageCounters.runs });
    return rows.length > 0;
  }

  async release(orgId: string, period: string): Promise<void> {
    await this.db
      .update(usageCounters)
      .set({ runs: sql`greatest(${usageCounters.runs} - 1, 0)` })
      .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.period, period)));
  }
}

export class DrizzleProcessedEventsRepository implements ProcessedEventsRepository {
  constructor(private readonly db: Database) {}

  async has(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: processedEvents.id })
      .from(processedEvents)
      .where(eq(processedEvents.id, id))
      .limit(1);
    return Boolean(row);
  }

  async record(id: string, type: string): Promise<boolean> {
    const rows = await this.db
      .insert(processedEvents)
      .values({ id, type })
      .onConflictDoNothing()
      .returning({ id: processedEvents.id });
    return rows.length > 0;
  }
}
