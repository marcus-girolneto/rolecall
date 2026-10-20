import type { RunComparison } from './compare.js';
import type { Manifest, VerifyReport } from './evidence.js';
import type { RunResult, RunSummary } from './types.js';

/** One row in a run list. Shared by the local dashboard, static reports and Rolecall Cloud. */
export interface RunListItem {
  id: string;
  createdAt: string;
  suite: { name: string; hash: string };
  mode: RunResult['mode'];
  summary: RunSummary;
  git: Manifest['git'];
  signed: boolean;
  verified: boolean;
}

export interface RunDetail {
  manifest: Manifest;
  result: RunResult;
  verify: VerifyReport;
  /** Comparison against the previous run of the same suite, when one exists. */
  baseline?: { runId: string; comparison: RunComparison };
}

/** Injected into the dashboard HTML as `window.__ROLECALL__`. */
export interface DashboardBootstrap {
  mode: 'local' | 'static' | 'cloud';
  /** Present in static mode: everything the page needs, no API calls. */
  runs?: RunListItem[];
  details?: Record<string, RunDetail>;
  /** Present in local/cloud mode. */
  apiBase?: string;
}
