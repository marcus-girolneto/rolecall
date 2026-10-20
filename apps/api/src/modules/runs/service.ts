import {
  compareRuns,
  EVENTS_FILE,
  type Manifest,
  RESULTS_FILE,
  type RunDetail,
  type RunListItem,
  type RunResult,
  type VerifyReport,
  verifyBundleFiles,
} from '@rolecall/core';
import type { AuthContext } from '../../shared/auth.js';
import { billingPeriod, type Clock } from '../../shared/clock.js';
import { AppError, forbidden, notFound } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { decodeCursor, encodeCursor, type Page } from '../../shared/pagination.js';
import { planOf, upgradeHint } from '../billing/plans.js';
import type { UsageRepository } from '../billing/repository.js';
import type { OrganizationsRepository } from '../organizations/repository.js';
import type { Project, ProjectsRepository } from '../projects/repository.js';
import type { RunRecord, RunSummaryRecord, RunsRepository } from './repository.js';
import {
  type ListRunsInput,
  manifestShape,
  resultShape,
  type UploadInput,
  type UploadResult,
} from './schemas.js';

export interface RunsServiceDeps {
  runs: RunsRepository;
  projects: ProjectsRepository;
  orgs: OrganizationsRepository;
  usage: UsageRepository;
  clock: Clock;
  publicUrl: string;
}

export const toRunListItem = (r: RunSummaryRecord): RunListItem => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  suite: { name: r.suiteName, hash: r.suiteHash },
  mode: r.mode as RunListItem['mode'],
  summary: { total: r.total, pass: r.pass, fail: r.fail, warn: r.warn, error: r.error },
  git:
    r.gitSha !== null && r.gitBranch !== null
      ? { sha: r.gitSha, branch: r.gitBranch, dirty: Boolean(r.gitDirty) }
      : null,
  signed: r.signed,
  verified: r.verified,
});

const invalid = (message: string, problems: string[]) =>
  new AppError('invalid_bundle', message, { problems });

/** Re-verifies stored texts with the same code the CLI uses, so the Cloud never trusts a cached verdict blindly. */
const verifyStored = (r: Pick<RunRecord, 'manifest' | 'results' | 'events' | 'signature'>): VerifyReport =>
  verifyBundleFiles({
    manifest: r.manifest,
    files: { [RESULTS_FILE]: r.results, [EVENTS_FILE]: r.events },
    ...(r.signature !== null ? { signature: r.signature } : {}),
  });

export class RunsService {
  constructor(private readonly deps: RunsServiceDeps) {}

  /**
   * Ingests an evidence bundle:
   * resolve project → re-verify hashes/signature → check shape → dedupe by root hash → enforce quota → store.
   */
  async ingest(
    auth: AuthContext,
    input: UploadInput,
    projectParam: string | undefined,
  ): Promise<UploadResult & { created: boolean }> {
    const { runs, usage, orgs, clock } = this.deps;
    const project = await this.resolveIngestProject(auth, projectParam);

    const verify = verifyBundleFiles({
      manifest: input.manifest,
      files: { [RESULTS_FILE]: input.results, [EVENTS_FILE]: input.events },
      ...(input.signature !== undefined ? { signature: input.signature } : {}),
    });
    if (!verify.ok) throw invalid('Evidence bundle failed verification', verify.problems);

    const { manifest, result } = this.parseBundle(input);

    const existing = await runs.findByRootHash(auth.orgId, project.id, manifest.rootHash);
    if (existing) return { id: existing.id, url: this.urlFor(existing.id), duplicate: true, created: false };

    const org = await orgs.findById(auth.orgId);
    if (!org) throw notFound('Organization');
    const plan = planOf(org.plan);
    const now = clock.now();
    const period = billingPeriod(now);
    if (!(await usage.tryConsume(auth.orgId, period, plan.runsPerMonth))) {
      throw new AppError(
        'plan_limit_reached',
        `Monthly run limit reached (${plan.runsPerMonth} runs on the ${plan.name} plan). ${upgradeHint(plan.id)}`,
        { limit: 'runsPerMonth', max: plan.runsPerMonth, plan: plan.id, period },
      );
    }

    const id = newId('run');
    const inserted = await runs.insert({
      id,
      orgId: auth.orgId,
      projectId: project.id,
      bundleRunId: manifest.runId,
      rootHash: manifest.rootHash,
      suiteName: manifest.suite.name,
      suiteHash: manifest.suite.hash,
      gitBranch: manifest.git?.branch ?? null,
      gitSha: manifest.git?.sha ?? null,
      gitDirty: manifest.git?.dirty ?? null,
      mode: manifest.mode,
      ...result.summary,
      signed: verify.signed,
      verified: verify.ok,
      manifest: input.manifest,
      results: input.results,
      events: input.events,
      signature: input.signature ?? null,
      createdAt: new Date(manifest.createdAt),
      receivedAt: now,
    });
    if (!inserted) {
      // Lost a race with an identical concurrent upload: hand back the winner and refund the quota unit.
      await usage.release(auth.orgId, period);
      const winner = await runs.findByRootHash(auth.orgId, project.id, manifest.rootHash);
      if (!winner) throw new AppError('conflict', 'Concurrent upload conflict; retry');
      return { id: winner.id, url: this.urlFor(winner.id), duplicate: true, created: false };
    }
    // Plan retention, counted from when the Cloud received each run (the bundle's own date can't be trusted).
    await runs.deleteReceivedBefore(auth.orgId, new Date(now.getTime() - plan.retentionDays * 86_400_000));
    return { id, url: this.urlFor(id), duplicate: false, created: true };
  }

  async list(auth: AuthContext, q: ListRunsInput): Promise<Page<RunListItem>> {
    let projectId = q.project;
    if (auth.projectId) {
      if (projectId && projectId !== auth.projectId) throw notFound('Project');
      projectId = auth.projectId;
    }
    const rows = await this.deps.runs.list(auth.orgId, {
      projectId,
      suite: q.suite,
      branch: q.branch,
      status: q.status,
      cursor: q.cursor ? decodeCursor(q.cursor) : undefined,
      limit: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(toRunListItem),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Full detail plus a comparison with the previous run of the same suite on the project's default branch. */
  async detail(auth: AuthContext, id: string): Promise<RunDetail> {
    const run = await this.requireRun(auth, id);
    const manifest = JSON.parse(run.manifest) as Manifest;
    const result = JSON.parse(run.results) as RunResult;
    const detail: RunDetail = { manifest, result, verify: verifyStored(run) };

    const project = await this.deps.projects.findById(auth.orgId, run.projectId);
    if (project) {
      const baseline = await this.deps.runs.findBaseline(auth.orgId, {
        projectId: run.projectId,
        suiteName: run.suiteName,
        branch: project.defaultBranch,
        before: run.createdAt,
        excludeId: run.id,
      });
      if (baseline)
        detail.baseline = {
          runId: baseline.id,
          comparison: compareRuns(result, JSON.parse(baseline.results) as RunResult),
        };
    }
    return detail;
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    await this.requireRun(auth, id);
    if (!(await this.deps.runs.delete(auth.orgId, id))) throw notFound('Run');
  }

  private async requireRun(auth: AuthContext, id: string): Promise<RunRecord> {
    const run = await this.deps.runs.findById(auth.orgId, id);
    if (!run || (auth.projectId && run.projectId !== auth.projectId)) throw notFound('Run');
    return run;
  }

  private async resolveIngestProject(auth: AuthContext, param: string | undefined): Promise<Project> {
    const { projects } = this.deps;
    if (auth.projectId) {
      if (param && param !== auth.projectId) throw forbidden('This API key is bound to a different project');
      const bound = await projects.findById(auth.orgId, auth.projectId);
      if (!bound) throw notFound('Project');
      return bound;
    }
    if (param) {
      const p =
        (await projects.findById(auth.orgId, param)) ?? (await projects.findBySlug(auth.orgId, param));
      if (!p) throw notFound('Project');
      return p;
    }
    // Org-wide key without ?project=: unambiguous only when the org has a single project.
    const all = await projects.list(auth.orgId);
    if (all.length === 1 && all[0]) return all[0];
    throw new AppError(
      'bad_request',
      'This key is not bound to a project; pass ?project=<project id or slug>',
    );
  }

  private parseBundle(input: UploadInput): { manifest: Manifest; result: RunResult } {
    let manifestJson: unknown;
    let resultJson: unknown;
    try {
      manifestJson = JSON.parse(input.manifest);
      resultJson = JSON.parse(input.results);
    } catch (e) {
      throw invalid('Bundle files are not valid JSON', [String(e)]);
    }
    const m = manifestShape.safeParse(manifestJson);
    const r = resultShape.safeParse(resultJson);
    const problems = [
      ...(m.success ? [] : m.error.issues.map((i) => `manifest.json ${i.path.join('.')}: ${i.message}`)),
      ...(r.success ? [] : r.error.issues.map((i) => `results.json ${i.path.join('.')}: ${i.message}`)),
    ];
    if (m.success && r.success) {
      const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
      if (m.data.suite.hash !== r.data.suite.hash)
        problems.push('manifest.suite.hash does not match results.suite.hash');
      if (!same(m.data.summary, r.data.summary))
        problems.push('manifest.summary does not match results.summary');
    }
    if (problems.length) throw invalid('Evidence bundle is malformed', problems);
    return { manifest: manifestJson as Manifest, result: resultJson as RunResult };
  }

  private urlFor(id: string): string {
    return `${this.deps.publicUrl}/runs/${id}`;
  }
}
