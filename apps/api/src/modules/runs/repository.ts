import { and, desc, eq, gt, lt, ne, or, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { runs } from '../../db/schema.js';
import type { Cursor } from '../../shared/pagination.js';

export type RunStatusFilter = 'pass' | 'fail' | 'warn' | 'error';

export interface RunRecord {
  id: string;
  orgId: string;
  projectId: string;
  bundleRunId: string;
  rootHash: string;
  suiteName: string;
  suiteHash: string;
  gitBranch: string | null;
  gitSha: string | null;
  gitDirty: boolean | null;
  mode: string;
  total: number;
  pass: number;
  fail: number;
  warn: number;
  error: number;
  signed: boolean;
  verified: boolean;
  manifest: string;
  results: string;
  events: string;
  signature: string | null;
  createdAt: Date;
  receivedAt: Date;
}

/** Everything except the (potentially large) bundle texts. */
export type RunSummaryRecord = Omit<RunRecord, 'manifest' | 'results' | 'events' | 'signature'>;

export interface ListRunsQuery {
  projectId?: string | undefined;
  suite?: string | undefined;
  branch?: string | undefined;
  status?: RunStatusFilter | undefined;
  cursor?: Cursor | undefined;
  limit: number;
}

export interface BaselineQuery {
  projectId: string;
  suiteName: string;
  branch: string;
  before: Date;
  excludeId: string;
}

export interface RunsRepository {
  findById(orgId: string, id: string): Promise<RunRecord | null>;
  findByRootHash(orgId: string, projectId: string, rootHash: string): Promise<RunSummaryRecord | null>;
  /** Returns null when (project, rootHash) already exists (concurrent duplicate upload). */
  insert(run: Omit<RunRecord, 'receivedAt'> & { receivedAt: Date }): Promise<RunSummaryRecord | null>;
  /** Newest first, keyset-paginated on (created_at, id). Returns up to `limit` rows. */
  list(orgId: string, query: ListRunsQuery): Promise<RunSummaryRecord[]>;
  findBaseline(orgId: string, query: BaselineQuery): Promise<RunRecord | null>;
  delete(orgId: string, id: string): Promise<boolean>;
}

const summaryColumns = {
  id: runs.id,
  orgId: runs.orgId,
  projectId: runs.projectId,
  bundleRunId: runs.bundleRunId,
  rootHash: runs.rootHash,
  suiteName: runs.suiteName,
  suiteHash: runs.suiteHash,
  gitBranch: runs.gitBranch,
  gitSha: runs.gitSha,
  gitDirty: runs.gitDirty,
  mode: runs.mode,
  total: runs.total,
  pass: runs.pass,
  fail: runs.fail,
  warn: runs.warn,
  error: runs.error,
  signed: runs.signed,
  verified: runs.verified,
  createdAt: runs.createdAt,
  receivedAt: runs.receivedAt,
};

const statusCondition = (status: RunStatusFilter): SQL | undefined => {
  switch (status) {
    case 'fail':
      return gt(runs.fail, 0);
    case 'error':
      return and(eq(runs.fail, 0), gt(runs.error, 0));
    case 'warn':
      return and(eq(runs.fail, 0), eq(runs.error, 0), gt(runs.warn, 0));
    case 'pass':
      return and(eq(runs.fail, 0), eq(runs.error, 0), eq(runs.warn, 0));
  }
};

export class DrizzleRunsRepository implements RunsRepository {
  constructor(private readonly db: Database) {}

  async findById(orgId: string, id: string): Promise<RunRecord | null> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.orgId, orgId), eq(runs.id, id)))
      .limit(1);
    return row ?? null;
  }

  async findByRootHash(orgId: string, projectId: string, rootHash: string): Promise<RunSummaryRecord | null> {
    const [row] = await this.db
      .select(summaryColumns)
      .from(runs)
      .where(and(eq(runs.orgId, orgId), eq(runs.projectId, projectId), eq(runs.rootHash, rootHash)))
      .limit(1);
    return row ?? null;
  }

  async insert(run: RunRecord): Promise<RunSummaryRecord | null> {
    const [row] = await this.db
      .insert(runs)
      .values(run)
      .onConflictDoNothing({ target: [runs.projectId, runs.rootHash] })
      .returning(summaryColumns);
    return row ?? null;
  }

  list(orgId: string, q: ListRunsQuery): Promise<RunSummaryRecord[]> {
    const conditions: Array<SQL | undefined> = [eq(runs.orgId, orgId)];
    if (q.projectId) conditions.push(eq(runs.projectId, q.projectId));
    if (q.suite) conditions.push(eq(runs.suiteName, q.suite));
    if (q.branch) conditions.push(eq(runs.gitBranch, q.branch));
    if (q.status) conditions.push(statusCondition(q.status));
    if (q.cursor) {
      const at = new Date(q.cursor.createdAt);
      conditions.push(or(lt(runs.createdAt, at), and(eq(runs.createdAt, at), lt(runs.id, q.cursor.id))));
    }
    return this.db
      .select(summaryColumns)
      .from(runs)
      .where(and(...conditions))
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(q.limit);
  }

  async findBaseline(orgId: string, q: BaselineQuery): Promise<RunRecord | null> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.orgId, orgId),
          eq(runs.projectId, q.projectId),
          eq(runs.suiteName, q.suiteName),
          eq(runs.gitBranch, q.branch),
          lt(runs.createdAt, q.before),
          ne(runs.id, q.excludeId),
        ),
      )
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(1);
    return row ?? null;
  }

  async delete(orgId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(runs)
      .where(and(eq(runs.orgId, orgId), eq(runs.id, id)))
      .returning({ id: runs.id });
    return rows.length > 0;
  }
}
