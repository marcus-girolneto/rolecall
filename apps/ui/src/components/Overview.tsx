import type { RunDetail, RunSummary, ScenarioResult, Status } from '@rolecall/core';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Cpu,
  GitBranch,
  GitCompareArrows,
  Grid3x3,
  ListChecks,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Target,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { absoluteTime, middleTruncate, relativeTime, shortSha } from '../lib/format';
import { FINDING_LABEL, nonPassing, sortFindings, titleOf, verdict } from '../lib/model';
import { runHref, testHref } from '../router';
import { ForbidRow } from './Detail';
import { PermissionMatrix } from './Matrix';
import {
  Card,
  CopyButton,
  InfoPopover,
  LayersExplainer,
  STATUS_META,
  StatusIcon,
  StatusPill,
  tint,
} from './ui';

export function Overview({
  detail,
  onOpenCell,
}: {
  detail: RunDetail;
  onOpenCell: (role: string, tool: string) => void;
}) {
  const { manifest, result } = detail;
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <RunHeader detail={detail} />
      <StatTiles summary={result.summary} />
      <div
        className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 ${detail.baseline ? 'lg:grid-cols-2' : ''}`}
      >
        <IntegrityCard detail={detail} />
        {detail.baseline && <BaselineCard detail={detail} />}
      </div>
      <Card
        id="matrix"
        title="Who can do what"
        icon={<Grid3x3 size={15} className="text-fg-3" aria-hidden />}
        actions={
          <span className="tnum text-xs text-fg-3">
            {result.roles.length} roles × {result.tools.length} tools · {result.policy.length} probes
          </span>
        }
      >
        <PermissionMatrix result={result} onOpenCell={onOpenCell} />
      </Card>
      <ScenarioList runId={manifest.runId} scenarios={result.scenarios} />
      <Findings detail={detail} />
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function RunHeader({ detail }: { detail: RunDetail }) {
  const { manifest, result } = detail;
  const v = verdict(result.summary);
  const models = manifest.models?.map((m) => `${m.provider}/${m.modelId}`).join(', ');
  return (
    <header className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-[24px] leading-tight font-semibold tracking-tight break-words text-fg sm:text-[28px]">
          {result.suite.name}
        </h1>
        <StatusPill status={v.status}>{v.text}</StatusPill>
      </div>
      <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-2">
        <Meta label="Created">
          <time dateTime={manifest.createdAt} title={absoluteTime(manifest.createdAt)}>
            {relativeTime(manifest.createdAt)}
          </time>
        </Meta>
        <Meta label="Mode">
          <span className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[11.5px]">
            {result.mode}
          </span>
        </Meta>
        <Meta label="Target" icon={<Target size={13} aria-hidden />}>
          <span title={`${result.target.kind}: ${result.target.name}`}>
            {result.target.name} <span className="text-fg-3">({result.target.kind})</span>
          </span>
        </Meta>
        {manifest.git && (
          <Meta label="Git" icon={<GitBranch size={13} aria-hidden />}>
            <span
              className="font-mono text-[12px]"
              title={`${manifest.git.branch}@${manifest.git.sha}${manifest.git.dirty ? ' (uncommitted changes)' : ''}`}
            >
              {manifest.git.branch}@{shortSha(manifest.git.sha)}
              {manifest.git.dirty && <span className="ml-1 text-fg-3">dirty</span>}
            </span>
          </Meta>
        )}
        {models && (
          <Meta label="Model" icon={<Cpu size={13} aria-hidden />}>
            <span className="font-mono text-[12px]">{models}</span>
          </Meta>
        )}
      </dl>
    </header>
  );
}

function Meta({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="sr-only">{label}</dt>
      {icon && <span className="text-fg-3">{icon}</span>}
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------- tiles */

function StatTiles({ summary }: { summary: RunSummary }) {
  const tiles: Array<{ label: string; value: number; status?: Status }> = [
    { label: 'Checks', value: summary.total },
    { label: 'Passed', value: summary.pass, status: 'pass' },
    { label: 'Problems', value: summary.fail, status: 'fail' },
    { label: 'AI only', value: summary.warn, status: 'warn' },
    { label: 'Not checked', value: summary.error, status: 'error' },
  ];
  return (
    <ul
      className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-3 lg:grid-cols-5"
      aria-label="Run summary"
    >
      {tiles.map((t, i) => {
        const hot = t.status && t.status !== 'pass' && t.value > 0;
        return (
          <li
            key={t.label}
            className={`card px-4 py-3.5 ${i === 0 ? 'col-span-2 sm:col-span-1' : ''}`}
            style={hot && t.status ? tint(STATUS_META[t.status].color, 8, 40) : undefined}
          >
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2">
              {t.status && (
                <span
                  className="size-2 rounded-full"
                  style={{ background: STATUS_META[t.status].color, opacity: t.value ? 1 : 0.35 }}
                  aria-hidden
                />
              )}
              {t.label}
            </p>
            <p
              className={`mt-1 text-[30px] leading-none font-semibold tracking-tight ${t.value || !t.status ? 'text-fg' : 'text-fg-3'}`}
            >
              {t.value.toLocaleString('en')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- integrity */

function IntegrityCard({ detail }: { detail: RunDetail }) {
  const { verify, manifest } = detail;
  const root = verify.rootHash ?? manifest.rootHash;
  return (
    <Card
      id="integrity"
      title="Evidence integrity"
      icon={
        verify.ok ? (
          <ShieldCheck size={15} style={{ color: 'var(--pass)' }} aria-hidden />
        ) : (
          <ShieldX size={15} style={{ color: 'var(--fail)' }} aria-hidden />
        )
      }
      actions={
        <StatusPill status={verify.ok ? 'pass' : 'fail'} size="sm">
          {verify.ok ? 'Verified' : 'Verification failed'}
        </StatusPill>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-[13px] leading-relaxed text-fg-2">
          {verify.ok
            ? `All ${manifest.files.length} evidence files match the hashes recorded in the manifest.`
            : 'The evidence bundle does not match its manifest. Results on this page may have been altered.'}
        </p>
        {!verify.ok && verify.problems.length > 0 && (
          <ul
            className="space-y-1 rounded-lg border px-3 py-2 text-[12.5px] text-fg"
            style={tint('var(--fail)', 8, 30)}
          >
            {verify.problems.map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        )}
        {root && (
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-3">
            <span className="shrink-0 text-[11px] font-medium text-fg-3">root</span>
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg" title={root}>
              <span className="sm:hidden">{middleTruncate(root, 10, 6)}</span>
              <span className="hidden sm:inline">{middleTruncate(root, 16, 8)}</span>
            </code>
            <CopyButton value={root} label="Copy root hash" />
          </div>
        )}
        {verify.signed ? (
          <p className="text-[13px] text-fg-2">
            Signed with key <code className="font-mono text-fg">{verify.keyId ?? 'unknown'}</code>
            {verify.trustedKey
              ? ', checked against your trusted public key.'
              : '. Checked against the key embedded in the bundle; pass a trusted public key to pin the signer.'}
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-fg-2">
            <span className="font-medium text-fg">Unsigned</span> — detects accidental edits only; sign with{' '}
            <code className="rounded bg-surface-2 px-1 font-mono text-[12px] text-fg">
              ROLECALL_SIGNING_KEY
            </code>{' '}
            for tamper evidence.
          </p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- baseline */

function BaselineCard({ detail }: { detail: RunDetail }) {
  const b = detail.baseline;
  if (!b) return null;
  const c = b.comparison;
  const runId = detail.manifest.runId;
  const empty =
    !c.regressions.length &&
    !c.fixes.length &&
    !c.newlyAttempted.length &&
    !c.added.length &&
    !c.removed.length;
  return (
    <Card
      id="baseline"
      title="Since baseline"
      icon={<GitCompareArrows size={15} className="text-fg-3" aria-hidden />}
      actions={
        <a
          href={runHref(b.runId)}
          className="truncate font-mono text-[11.5px] text-accent-text hover:underline"
          title={`Open baseline run ${b.runId}`}
        >
          {b.runId}
        </a>
      }
    >
      <div className="space-y-4 px-4 py-4 sm:px-5">
        {empty && (
          <p className="text-[13px] text-fg-3">No status changes against the previous run of this suite.</p>
        )}
        {c.regressions.length > 0 && (
          <ChangeGroup
            title={`${c.regressions.length} regression${c.regressions.length === 1 ? '' : 's'}`}
            icon={<ArrowDownRight size={14} style={{ color: 'var(--fail)' }} aria-hidden />}
          >
            {c.regressions.map((r) => (
              <ChangeRow key={r.id} href={testHref(runId, r.id)} title={r.title} from={r.from} to={r.to} />
            ))}
          </ChangeGroup>
        )}
        {c.fixes.length > 0 && (
          <ChangeGroup
            title={`${c.fixes.length} fix${c.fixes.length === 1 ? '' : 'es'}`}
            icon={<ArrowUpRight size={14} style={{ color: 'var(--pass)' }} aria-hidden />}
          >
            {c.fixes.map((r) => (
              <ChangeRow key={r.id} href={testHref(runId, r.id)} title={r.title} from={r.from} to={r.to} />
            ))}
          </ChangeGroup>
        )}
        {c.newlyAttempted.length > 0 && (
          <ChangeGroup
            title="Newly attempted tools"
            icon={<Sparkles size={14} style={{ color: 'var(--warn)' }} aria-hidden />}
          >
            {c.newlyAttempted.map((n) => (
              <li key={n.id}>
                <a
                  href={testHref(runId, n.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                    {n.id.replace(/^scenario:/, '')}
                  </span>
                  <code className="shrink-0 font-mono text-xs text-fg-2">{n.tools.join(', ')}</code>
                </a>
              </li>
            ))}
          </ChangeGroup>
        )}
        {(c.added.length > 0 || c.removed.length > 0) && (
          <p className="tnum text-xs text-fg-3">
            {c.added.length} test{c.added.length === 1 ? '' : 's'} added · {c.removed.length} removed
          </p>
        )}
      </div>
    </Card>
  );
}

function ChangeGroup({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
        {icon}
        {title}
      </p>
      <ul className="-mx-2">{children}</ul>
    </div>
  );
}

function ChangeRow({ href, title, from, to }: { href: string; title: string; from: Status; to: Status }) {
  return (
    <li>
      <a href={href} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg" title={title}>
          {title}
        </span>
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-fg-3"
          role="img"
          aria-label={`${from} to ${to}`}
        >
          <StatusIcon status={from} size={12} />
          <span aria-hidden>→</span>
          <StatusIcon status={to} size={12} />
        </span>
      </a>
    </li>
  );
}

/* --------------------------------------------------------------- scenarios */

function ScenarioList({ runId, scenarios }: { runId: string; scenarios: ScenarioResult[] }) {
  return (
    <Card
      id="scenarios"
      title="Conversations"
      icon={<ListChecks size={15} className="text-fg-3" aria-hidden />}
      actions={
        <InfoPopover label="What stopped it?" align="right">
          <LayersExplainer />
        </InfoPopover>
      }
    >
      {scenarios.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-fg-3">No scenarios in this suite.</p>
      ) : (
        <ul className="divide-y divide-line">
          {scenarios.map((s) => (
            <li key={s.id}>
              <a
                href={testHref(runId, s.id)}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5"
              >
                <StatusIcon status={s.status} size={17} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-[14px] font-medium text-fg" title={s.name}>
                      {s.name}
                    </span>
                    <span className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-fg-2">
                      {s.role}
                    </span>
                  </div>
                  {s.forbidden.length > 0 ? (
                    <ul
                      className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5"
                      aria-label="Defense layers per forbidden tool"
                    >
                      {s.forbidden.map((f) => (
                        <li key={f.tool}>
                          <ForbidRow f={f} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-fg-3">
                      {s.attemptedTools.length ? `Used ${s.attemptedTools.join(', ')}` : 'No tools used'} · no
                      forbidden tools
                    </p>
                  )}
                </div>
                <ChevronRight size={16} className="mt-0.5 text-fg-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- findings */

function Findings({ detail }: { detail: RunDetail }) {
  const tests = nonPassing(detail.result);
  const runId = detail.manifest.runId;
  return (
    <Card
      id="findings"
      title="To look at"
      icon={<StatusIcon status={tests[0]?.status ?? 'pass'} size={15} />}
      actions={<span className="tnum text-xs text-fg-3">{tests.length} not passing</span>}
    >
      {tests.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-fg-2">
          <StatusIcon status="pass" size={16} /> Every role held. Nothing to report.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tests.map((t) => (
            <li key={t.id}>
              <a
                href={testHref(runId, t.id)}
                className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5"
              >
                <StatusIcon status={t.status} size={17} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-[14px] font-medium break-words text-fg">{titleOf(t)}</span>
                    <span className="rounded border border-line px-1.5 text-[10.5px] font-medium text-fg-3">
                      {t.kind === 'policy' ? 'policy' : 'scenario'}
                    </span>
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {sortFindings(t.findings).map((f, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: findings are immutable run output
                      <li key={i} className="text-[13px] leading-relaxed break-words text-fg-2">
                        <span className="font-medium text-fg">{FINDING_LABEL[f.code]}.</span> {f.message}
                        {f.hint && (
                          <span className="mt-0.5 block text-[12.5px] text-fg-3">
                            <span className="font-medium text-[var(--accent-text)]">How to fix:</span>{' '}
                            {f.hint}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
