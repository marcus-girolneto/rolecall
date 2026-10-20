import type { RunListItem } from '@rolecall/core';
import { GitBranch, Moon, ShieldCheck, ShieldOff, ShieldX, Sun } from 'lucide-react';
import { absoluteTime, relativeTime, shortSha } from '../lib/format';
import { summaryStatus } from '../lib/model';
import { runHref } from '../router';
import { LogoMark, StatusDot } from './ui';

export function IntegrityIcon({
  run,
  size = 14,
}: {
  run: Pick<RunListItem, 'signed' | 'verified'>;
  size?: number;
}) {
  if (!run.verified)
    return (
      <ShieldX size={size} style={{ color: 'var(--fail)' }} aria-label="Integrity check failed" role="img" />
    );
  if (run.signed)
    return (
      <ShieldCheck size={size} style={{ color: 'var(--pass)' }} aria-label="Signed and verified" role="img" />
    );
  return <ShieldOff size={size} className="text-fg-3" aria-label="Hashes verified, unsigned" role="img" />;
}

export function Brand() {
  return (
    <a href="#/" className="flex items-center gap-2.5 rounded-md" aria-label="Rolecall home">
      <LogoMark size={28} />
      <span className="text-[17px] font-semibold tracking-tight text-fg">rolecall</span>
    </a>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: 'dark' | 'light'; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function RunList({
  runs,
  activeId,
  onNavigate,
}: {
  runs: RunListItem[];
  activeId: string | undefined;
  onNavigate?: () => void;
}) {
  return (
    <ol className="space-y-1" aria-label="Runs, newest first">
      {runs.map((r) => {
        const active = r.id === activeId;
        const status = summaryStatus(r.summary);
        return (
          <li key={r.id}>
            <a
              href={runHref(r.id)}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-lg border px-3 py-2.5 transition-colors ${
                active ? 'border-line-strong bg-surface-3' : 'border-transparent hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={status} />
                <span
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg"
                  title={r.suite.name}
                >
                  {r.suite.name}
                </span>
                <IntegrityIcon run={r} size={13} />
              </div>
              <div className="mt-1 flex items-center gap-2 pl-4 text-xs text-fg-3">
                <time dateTime={r.createdAt} title={absoluteTime(r.createdAt)} className="shrink-0">
                  {relativeTime(r.createdAt)}
                </time>
                {r.git && (
                  <span
                    className="flex min-w-0 items-center gap-1 truncate font-mono text-[11px]"
                    title={`${r.git.branch}@${r.git.sha}${r.git.dirty ? ' (uncommitted changes)' : ''}`}
                  >
                    <GitBranch size={11} className="shrink-0" aria-hidden />
                    <span className="truncate">
                      {r.git.branch}@{shortSha(r.git.sha)}
                      {r.git.dirty ? '*' : ''}
                    </span>
                  </span>
                )}
              </div>
              <div className="tnum mt-1.5 flex items-center gap-3 pl-4 text-xs text-fg-2">
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: 'var(--pass)' }} aria-hidden />
                  {r.summary.pass} passed
                </span>
                {r.summary.fail > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: 'var(--fail)' }}
                      aria-hidden
                    />
                    {r.summary.fail} failed
                  </span>
                )}
                {r.summary.warn > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: 'var(--warn)' }}
                      aria-hidden
                    />
                    {r.summary.warn} warn
                  </span>
                )}
                {r.summary.error > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: 'var(--error)' }}
                      aria-hidden
                    />
                    {r.summary.error} error
                  </span>
                )}
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
