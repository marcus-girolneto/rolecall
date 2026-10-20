import type {
  DiffEntry,
  Finding,
  ForbidResult,
  PolicyResult,
  ScenarioResult,
  TestResult,
  TimelineEntry,
} from '@rolecall/core';
import { ArrowRight, Bot, ChevronRight, FileDiff, Minus, Pencil, Plus, User, Wrench, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { inline, isPlainValue, pretty } from '../lib/format';
import {
  FINDING_LABEL,
  forbiddenTools,
  forbidStatus,
  layerStatus,
  type MatrixCell,
  sortFindings,
  titleOf,
} from '../lib/model';
import { testHref } from '../router';
import {
  ExpectBadge,
  InfoPopover,
  JsonBlock,
  LayerChip,
  LayersExplainer,
  STATUS_META,
  StatusIcon,
  StatusPill,
  tint,
} from './ui';

/* ------------------------------------------------------------------ drawer */

export function Drawer({
  label,
  onClose,
  header,
  children,
}: {
  label: string;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), summary',
        );
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="anim-fade absolute inset-0"
        style={{ background: 'var(--scrim)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="anim-slide relative flex h-full w-full max-w-[720px] flex-col border-l border-line bg-bg outline-none"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div className="flex items-start gap-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-3 hover:text-fg"
            aria-label="Close details"
          >
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-7 last:mb-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5">
      <dt className="text-[11px] font-medium text-fg-3">{label}</dt>
      <dd className="mt-1 min-w-0 text-[13px] text-fg">{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------- findings */

export function FindingList({ findings, status }: { findings: Finding[]; status: TestResult['status'] }) {
  if (!findings.length) return <p className="text-[13px] text-fg-3">No findings.</p>;
  return (
    <ul className="space-y-2">
      {sortFindings(findings).map((f, i) => {
        const s =
          f.code === 'model_only_defense'
            ? 'warn'
            : f.code === 'agent_error' || f.code === 'unexpected_error'
              ? 'error'
              : status === 'pass'
                ? 'warn'
                : status;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: findings are immutable run output; the same code can repeat
            key={`${f.code}-${i}`}
            className="flex gap-2.5 rounded-lg border px-3 py-2.5"
            style={tint(STATUS_META[s].color, 8, 28)}
          >
            <StatusIcon status={s} size={15} className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-fg">{FINDING_LABEL[f.code]}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed break-words text-fg-2">{f.message}</p>
              {f.hint && (
                <p className="mt-2 rounded-md border border-line bg-surface px-2.5 py-2 text-[12.5px] leading-relaxed text-fg-2">
                  <span className="font-semibold text-[var(--accent-text)]">How to fix: </span>
                  {f.hint}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------- state diff */

function ValueView({ value, tone }: { value: unknown; tone: 'before' | 'after' }) {
  const cls = tone === 'before' ? 'text-fg-3' : 'text-fg';
  if (value === undefined) return <span className="text-fg-3 italic">absent</span>;
  const text = inline(value);
  if (isPlainValue(value) && text.length <= 48)
    return <code className={`font-mono text-[12.5px] break-all ${cls}`}>{text}</code>;
  return (
    <details className="group min-w-0">
      <summary className={`cursor-pointer truncate font-mono text-[12.5px] ${cls}`} title="Expand">
        {text}
      </summary>
      <pre className="code-block scroll-thin mt-1.5 text-fg-2">{pretty(value)}</pre>
    </details>
  );
}

const DIFF_META = {
  added: { icon: Plus, label: 'added' },
  removed: { icon: Minus, label: 'removed' },
  changed: { icon: Pencil, label: 'changed' },
} as const;

export function StateDiff({ diff, expectUnchanged }: { diff: DiffEntry[]; expectUnchanged?: boolean }) {
  if (!diff.length)
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-3">
        <FileDiff size={14} aria-hidden /> No state changes.
      </p>
    );
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {expectUnchanged && (
        <p className="border-b border-line px-3 py-2 text-xs text-fg-2" style={tint('var(--fail)', 8, 20)}>
          This action should have been denied, so state was expected to stay unchanged.
        </p>
      )}
      <ul className="divide-y divide-line">
        {diff.map((d) => {
          const meta = DIFF_META[d.kind];
          const Icon = meta.icon;
          return (
            <li key={`${d.kind}:${d.path}`} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-2"
                  role="img"
                  aria-label={meta.label}
                >
                  <Icon size={11} aria-hidden />
                  {meta.label}
                </span>
                <code className="min-w-0 truncate font-mono text-[12.5px] text-fg" title={d.path}>
                  {d.path}
                </code>
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 pl-1">
                <ValueView value={d.before} tone="before" />
                <ArrowRight size={13} className="mt-0.5 text-fg-3" aria-label="becomes" />
                <ValueView value={d.after} tone="after" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- headers */

export function TestHeader({ test }: { test: TestResult }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusPill status={test.status} size="sm" />
        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-3">
          {test.kind === 'policy' ? 'Policy probe' : 'Scenario'}
        </span>
      </div>
      <h2 className="text-[17px] leading-snug font-semibold break-words text-fg">
        {test.kind === 'policy' ? (
          <>
            <span className="font-mono">{test.role}</span>
            <span className="text-fg-3"> → </span>
            <span className="font-mono">{test.tool}</span>
            {test.label && <span className="font-normal text-fg-2"> · {test.label}</span>}
          </>
        ) : (
          test.name
        )}
      </h2>
      <p className="mt-1 truncate font-mono text-[11px] text-fg-3" title={test.id}>
        {test.id}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ policy */

export function PolicyDetail({ test }: { test: PolicyResult }) {
  const outcomeStatus = layerStatus(test.outcome, test.expect);
  return (
    <>
      <Section title="Expected vs outcome">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Fact label="Role">
            <span className="font-mono">{test.role}</span>
          </Fact>
          <Fact label="Tool">
            <span className="block truncate font-mono" title={test.tool}>
              {test.tool}
            </span>
          </Fact>
          <Fact label="Expected">
            <ExpectBadge expect={test.expect} />
          </Fact>
          <Fact label="Outcome">
            <LayerChip layer={test.outcome} status={outcomeStatus} />
          </Fact>
        </dl>
        <p className="mt-3 text-[13px] leading-relaxed text-fg-2">
          Rolecall called <code className="font-mono text-fg">{test.tool}</code> directly as{' '}
          <code className="font-mono text-fg">{test.role}</code>, bypassing the model.{' '}
          {test.expect === 'deny'
            ? test.outcome === 'executed'
              ? 'Nothing in the application stopped it.'
              : test.outcome === 'authz_blocked'
                ? 'The application’s authorization rejected it.'
                : 'The handler failed for a non-authorization reason.'
            : test.outcome === 'executed'
              ? 'It executed, as expected.'
              : 'It did not execute, but this role should be allowed.'}
        </p>
      </Section>
      {test.findings.length > 0 && (
        <Section title="What went wrong">
          <FindingList findings={test.findings} status={test.status} />
        </Section>
      )}
      <Section title="Probe arguments">
        <JsonBlock value={test.args} label="arguments" />
      </Section>
      {test.error && (
        <Section title="Error">
          <pre className="code-block scroll-thin whitespace-pre-wrap text-fg-2">{test.error}</pre>
        </Section>
      )}
      <Section title="State diff">
        <StateDiff diff={test.stateDiff} expectUnchanged={test.expect === 'deny'} />
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- scenario */

export function ForbidRow({ f }: { f: ForbidResult }) {
  const s = forbidStatus(f);
  const first = f.layer === 'model_refused' ? (f.probe ? null : 'pass') : s;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <code className="font-mono text-xs text-fg-2">{f.tool}</code>
      <LayerChip layer={f.layer} status={first} />
      {f.probe && (
        <>
          <ArrowRight size={12} className="text-fg-3" aria-label="then" />
          <LayerChip layer={f.probe.outcome} status={s} prefix="then:" />
        </>
      )}
    </span>
  );
}

function forbidExplanation(f: ForbidResult): string {
  if (f.layer === 'executed') return 'The agent executed a forbidden tool. Nothing stopped it.';
  if (f.layer === 'authz_blocked') return 'The agent attempted it; your authorization blocked it.';
  if (f.layer === 'errored') return 'The handler errored for a non-authorization reason.';
  if (!f.probe) return 'The model never attempted the call.';
  if (f.probe.outcome === 'executed')
    return 'The model refused, but a direct call as this role executed. Only the model’s judgement protects this action.';
  if (f.probe.outcome === 'authz_blocked')
    return 'The model refused, and a direct call was also blocked by authorization. Defended in depth.';
  return 'The model refused; the direct probe errored.';
}

function toolLayerStatus(e: Extract<TimelineEntry, { type: 'tool' }>, forbidden: Set<string>) {
  if (e.layer === 'errored') return 'error' as const;
  if (forbidden.has(e.tool)) return e.layer === 'executed' ? ('fail' as const) : ('pass' as const);
  return null;
}

function Timeline({ test }: { test: ScenarioResult }) {
  const forbidden = forbiddenTools(test);
  if (!test.timeline.length) return <p className="text-[13px] text-fg-3">No transcript recorded.</p>;
  return (
    <ol className="space-y-3" aria-label="Conversation timeline">
      {/* Timeline entries are immutable and never reorder, so the index is a stable key. */}
      {test.timeline.map((e, i) => {
        if (e.type === 'user')
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: immutable, ordered timeline
            <li key={i} className="flex justify-end">
              <div className="max-w-[85%]">
                <p className="mb-1 flex items-center justify-end gap-1 text-[11px] font-medium text-fg-3">
                  <User size={11} aria-hidden /> user · {test.role}
                </p>
                <div
                  className="rounded-2xl rounded-tr-md border px-3.5 py-2.5 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-fg"
                  style={tint('var(--accent)', 14, 30)}
                >
                  {e.text}
                </div>
              </div>
            </li>
          );
        if (e.type === 'assistant')
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: immutable, ordered timeline
            <li key={i} className="flex">
              <div className="max-w-[85%] min-w-0">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-fg-3">
                  <Bot size={11} aria-hidden /> assistant
                </p>
                <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-2">
                  {e.text.length > 600 ? <LongText text={e.text} /> : e.text}
                </div>
              </div>
            </li>
          );
        const s = toolLayerStatus(e, forbidden);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: immutable, ordered timeline
          <li key={i} className="pl-0 sm:pl-6">
            <div
              className="overflow-hidden rounded-xl border bg-surface"
              style={s && s !== 'pass' ? tint(STATUS_META[s].color, 6, 45) : undefined}
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <Wrench size={13} className="text-fg-3" aria-hidden />
                <code className="font-mono text-[12.5px] font-semibold text-fg">{e.tool}</code>
                <span className="tnum text-[11px] text-fg-3">#{e.seq}</span>
                {forbidden.has(e.tool) && (
                  <span className="rounded border border-line px-1.5 text-[10.5px] font-semibold tracking-wide text-fg-2 uppercase">
                    forbidden
                  </span>
                )}
                <span className="ml-auto">
                  <LayerChip layer={e.layer} status={s} />
                </span>
              </div>
              <div className="space-y-2 px-3 py-2.5">
                <KV label="args" value={e.args} />
                {e.error !== undefined ? (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-fg-3">error</p>
                    <pre className="code-block scroll-thin whitespace-pre-wrap text-fg-2">{e.error}</pre>
                  </div>
                ) : (
                  e.result !== undefined && <KV label="result" value={e.result} />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function LongText({ text }: { text: string }) {
  return (
    <details>
      <summary className="cursor-pointer list-none">
        {text.slice(0, 400)}…{' '}
        <span className="text-accent-text underline-offset-2 hover:underline">show all</span>
      </summary>
      <span>{text.slice(400)}</span>
    </details>
  );
}

function KV({ label, value }: { label: string; value: unknown }) {
  const text = inline(value);
  if (text.length <= 80)
    return (
      <p className="flex min-w-0 gap-2 text-[12.5px]">
        <span className="w-12 shrink-0 text-[11px] leading-5 font-medium text-fg-3">{label}</span>
        <code className="min-w-0 font-mono break-all text-fg-2">{text}</code>
      </p>
    );
  return (
    <details className="min-w-0">
      <summary className="flex cursor-pointer list-none gap-2 text-[12.5px]">
        <span className="w-12 shrink-0 text-[11px] leading-5 font-medium text-fg-3">{label}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-fg-2">{text}</code>
        <ChevronRight size={14} className="mt-0.5 shrink-0 text-fg-3" aria-label="Expand" />
      </summary>
      <div className="mt-1.5">
        <JsonBlock value={value} label={label} />
      </div>
    </details>
  );
}

export function ScenarioDetail({ test }: { test: ScenarioResult }) {
  return (
    <>
      <Section title="Overview">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Fact label="Role">
            <span className="font-mono">{test.role}</span>
          </Fact>
          <Fact label="Tools attempted">
            {test.attemptedTools.length ? (
              <span className="block truncate font-mono" title={test.attemptedTools.join(', ')}>
                {test.attemptedTools.join(', ')}
              </span>
            ) : (
              <span className="text-fg-3">none</span>
            )}
          </Fact>
          <Fact label="Turns">
            <span className="tnum">{test.timeline.filter((e) => e.type === 'user').length}</span>
          </Fact>
        </dl>
      </Section>
      {test.forbidden.length > 0 && (
        <Section
          title="Forbidden tools"
          aside={
            <InfoPopover label="Layers" align="right">
              <LayersExplainer />
            </InfoPopover>
          }
        >
          <ul className="space-y-2">
            {test.forbidden.map((f) => (
              <li key={f.tool} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                <ForbidRow f={f} />
                <p className="mt-1.5 text-[12.5px] text-fg-2">{forbidExplanation(f)}</p>
                {f.probe && (
                  <p className="mt-1 font-mono text-[11.5px] break-all text-fg-3">
                    probe args {inline(f.probe.args)}
                    {f.probe.error ? ` · ${f.probe.error}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {test.findings.length > 0 && (
        <Section title="What went wrong">
          <FindingList findings={test.findings} status={test.status} />
        </Section>
      )}
      <Section title="Timeline">
        <Timeline test={test} />
      </Section>
      <Section title="State diff">
        <StateDiff diff={test.stateDiff} />
      </Section>
    </>
  );
}

export function TestDetail({ test }: { test: TestResult }) {
  return test.kind === 'policy' ? <PolicyDetail test={test} /> : <ScenarioDetail test={test} />;
}

/* -------------------------------------------------------------------- cell */

export function CellHeader({ cell }: { cell: MatrixCell }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {cell.status && <StatusPill status={cell.status} size="sm" />}
        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-fg-3">
          Matrix cell
        </span>
      </div>
      <h2 className="text-[17px] font-semibold text-fg">
        <span className="font-mono">{cell.role}</span>
        <span className="text-fg-3"> → </span>
        <span className="font-mono">{cell.tool}</span>
      </h2>
      <p className="mt-1 text-xs text-fg-3">
        {cell.tests.length} direct probe{cell.tests.length === 1 ? '' : 's'} for this role and tool
      </p>
    </div>
  );
}

export function CellDetail({ cell, runId }: { cell: MatrixCell; runId: string }) {
  return (
    <ul className="space-y-2">
      {cell.tests.map((t) => (
        <li key={t.id}>
          <a
            href={testHref(runId, t.id)}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <StatusIcon status={t.status} size={18} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-fg" title={titleOf(t)}>
                {t.label ?? 'Default probe'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ExpectBadge expect={t.expect} />
                <ArrowRight size={12} className="text-fg-3" aria-hidden />
                <LayerChip layer={t.outcome} status={layerStatus(t.outcome, t.expect)} />
                {t.findings.length > 0 && (
                  <span className="text-xs text-fg-3">
                    {t.findings.length} finding{t.findings.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}
