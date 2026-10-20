import type { RunDetail, RunListItem } from '@rolecall/core';
import { AlertTriangle, KeyRound, Loader2, LogOut, Menu, RefreshCw, Terminal, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { CellDetail, CellHeader, Drawer, TestDetail, TestHeader } from './components/Detail';
import { Overview } from './components/Overview';
import { Brand, RunList, ThemeToggle } from './components/Sidebar';
import { CopyButton, LogoMark } from './components/ui';
import {
  AuthRequiredError,
  type DataSource,
  getCloudKey,
  NoBootstrapError,
  setCloudKey,
  useRunDetail,
  useRuns,
  useSource,
} from './data';
import { buildMatrix, cellKey, findTest } from './lib/model';
import { navigate, runHref, useRoute } from './router';

type Theme = 'dark' | 'light';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('rolecall:theme', next);
      } catch {
        // storage unavailable (file://, private mode): toggle still works for this session
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

export function App() {
  const source = useSource();
  const [theme, toggleTheme] = useTheme();
  // Bumped on sign-in/out so the shell remounts and refetches with the new key.
  const [session, setSession] = useState(0);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const signIn = useCallback((key: string) => {
    setCloudKey(key);
    setAuthMessage(null);
    setSession((n) => n + 1);
  }, []);
  const signOut = useCallback((message: string | null = null) => {
    setCloudKey(null);
    setAuthMessage(message);
    setSession((n) => n + 1);
  }, []);
  if (source.state === 'loading')
    return (
      <FullPage>
        <Spinner label="Loading dashboard" />
      </FullPage>
    );
  if (source.state === 'error')
    return (
      <FullPage>
        <ErrorState
          title={
            source.error instanceof NoBootstrapError
              ? 'No run data in this page'
              : 'Could not start the dashboard'
          }
          message={
            source.error instanceof NoBootstrapError
              ? 'Open the dashboard with `npx rolecall ui`, or generate a report with `npx rolecall report <run> --format html`.'
              : source.error.message
          }
        />
      </FullPage>
    );
  if (source.data.mode === 'cloud' && !getCloudKey())
    return (
      <FullPage>
        <SignIn message={authMessage} onSubmit={signIn} />
      </FullPage>
    );
  return (
    <Shell
      key={session}
      source={source.data}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSignOut={source.data.mode === 'cloud' ? signOut : undefined}
    />
  );
}

function Shell({
  source,
  theme,
  onToggleTheme,
  onSignOut,
}: {
  source: DataSource;
  theme: Theme;
  onToggleTheme: () => void;
  onSignOut?: (message?: string | null) => void;
}) {
  const { runs, reload } = useRuns(source);
  const authError =
    runs.state === 'error' && runs.error instanceof AuthRequiredError ? runs.error.message : null;
  useEffect(() => {
    if (authError) onSignOut?.(authError);
  }, [authError, onSignOut]);
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const list = runs.state === 'ready' ? runs.data : [];
  const activeId = route.runId ?? list[0]?.id;
  const detail = useRunDetail(source, activeId);
  const [cell, setCell] = useState<{ role: string; tool: string } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the cell drawer whenever the user navigates
  useEffect(() => setCell(null), [activeId, route.testId]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  const sidebar = (
    <SidebarBody
      runs={runs.state === 'ready' ? runs.data : null}
      loading={runs.state === 'loading'}
      activeId={activeId}
      mode={source.mode}
      onNavigate={() => setNavOpen(false)}
      onSignOut={onSignOut ? () => onSignOut(null) : undefined}
    />
  );

  let main: ReactNode;
  if (runs.state === 'loading') main = <Spinner label="Loading runs" />;
  else if (runs.state === 'error')
    main = <ErrorState title="Could not load runs" message={runs.error.message} onRetry={reload} />;
  else if (runs.data.length === 0) main = <Onboarding />;
  else if (!detail || detail.state === 'loading') main = <Spinner label="Loading run" />;
  else if (detail.state === 'error')
    main = <ErrorState title="Could not load this run" message={detail.error.message} />;
  else
    main = (
      <Overview
        key={detail.data.manifest.runId}
        detail={detail.data}
        onOpenCell={(role, tool) => setCell({ role, tool })}
      />
    );

  const ready = detail?.state === 'ready' ? detail.data : null;

  return (
    <div className="flex min-h-dvh">
      {/* biome-ignore lint/a11y/useValidAnchor: skip link; keeps hash routing intact by focusing #main directly */}
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-dvh w-[288px] shrink-0 flex-col border-r border-line bg-surface lg:flex"
        aria-label="Runs"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <Brand />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="anim-fade absolute inset-0"
            style={{ background: 'var(--scrim)' }}
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
          <aside
            className="anim-slide absolute inset-y-0 left-0 flex w-[min(320px,88vw)] flex-col border-r border-line bg-surface"
            aria-label="Runs"
          >
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <Brand />
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-3"
                onClick={() => setNavOpen(false)}
                aria-label="Close run list"
                // biome-ignore lint/a11y/noAutofocus: move focus into the opened mobile drawer
                autoFocus
              >
                <X size={18} />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-fg-2 hover:bg-surface-3"
            aria-label="Open run list"
            aria-expanded={navOpen}
          >
            <Menu size={18} /> Runs
          </button>
          <span className="flex items-center gap-2">
            <LogoMark size={22} />
            <span className="text-[15px] font-semibold tracking-tight">rolecall</span>
          </span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {main}
        </main>
      </div>

      {ready && route.testId && <TestDrawer detail={ready} testId={route.testId} />}
      {ready && cell && !route.testId && (
        <CellDrawer detail={ready} cell={cell} onClose={() => setCell(null)} />
      )}
    </div>
  );
}

function SidebarBody({
  runs,
  loading,
  activeId,
  mode,
  onNavigate,
  onSignOut,
}: {
  runs: RunListItem[] | null;
  loading: boolean;
  activeId: string | undefined;
  mode: DataSource['mode'];
  onNavigate: () => void;
  onSignOut?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-2 pb-2">
        <span className="eyebrow">Runs</span>
        <span className="tnum text-[11px] text-fg-3">
          {runs ? `${runs.length} · ` : ''}
          {mode === 'static' ? 'static report' : mode}
        </span>
      </div>
      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Run list">
        {loading && <p className="px-3 py-2 text-xs text-fg-3">Loading…</p>}
        {runs && runs.length === 0 && <p className="px-3 py-2 text-xs text-fg-3">No runs yet.</p>}
        {runs && runs.length > 0 && <RunList runs={runs} activeId={activeId} onNavigate={onNavigate} />}
      </nav>
      {onSignOut && (
        <div className="border-t border-line px-3 py-2">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-fg-3">
        Results describe the probes that ran. They are evidence, not a certification.
      </p>
    </>
  );
}

function TestDrawer({ detail, testId }: { detail: RunDetail; testId: string }) {
  const test = findTest(detail.result, testId);
  const close = useCallback(() => navigate(runHref(detail.manifest.runId)), [detail.manifest.runId]);
  if (!test)
    return (
      <Drawer
        label="Test not found"
        onClose={close}
        header={<h2 className="text-[17px] font-semibold">Test not found</h2>}
      >
        <p className="text-sm text-fg-2">
          This run has no test with id <code className="font-mono">{testId}</code>.
        </p>
      </Drawer>
    );
  return (
    <Drawer
      label={`Test details: ${test.kind === 'policy' ? `${test.role} ${test.tool}` : test.name}`}
      onClose={close}
      header={<TestHeader test={test} />}
    >
      <TestDetail test={test} />
    </Drawer>
  );
}

function CellDrawer({
  detail,
  cell,
  onClose,
}: {
  detail: RunDetail;
  cell: { role: string; tool: string };
  onClose: () => void;
}) {
  const m = useMemo(() => buildMatrix(detail.result), [detail.result]);
  const c = m.cells.get(cellKey(cell.role, cell.tool));
  if (!c) return null;
  return (
    <Drawer
      label={`Matrix cell ${cell.role} ${cell.tool}`}
      onClose={onClose}
      header={<CellHeader cell={c} />}
    >
      <CellDetail cell={c} runId={detail.manifest.runId} />
    </Drawer>
  );
}

/* ------------------------------------------------------------------ states */

function FullPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

function Spinner({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-fg-3"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div
      className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-6 text-center"
      role="alert"
    >
      <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface">
        <AlertTriangle size={20} style={{ color: 'var(--fail)' }} aria-hidden />
      </span>
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed break-words text-fg-2">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-fg hover:bg-surface-3"
        >
          <RefreshCw size={14} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

const KEY_FORMAT = /^rc_live_[0-9a-z]{40}$/;

function SignIn({ message, onSubmit }: { message: string | null; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(message);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!KEY_FORMAT.test(key)) {
      setError(
        'That doesn’t look like a Rolecall API key. Keys start with rc_live_ and have 40 more characters.',
      );
      return;
    }
    onSubmit(key);
  };
  return (
    <form onSubmit={submit} className="card w-full max-w-md p-7" aria-labelledby="signin-title">
      <LogoMark size={40} />
      <h1 id="signin-title" className="mt-5 text-[22px] font-semibold tracking-tight text-fg">
        Sign in to Rolecall Cloud
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">
        Paste an API key with the <code className="font-mono text-fg">runs:read</code> scope. The key stays in
        this browser tab only and is cleared when you close it.
      </p>
      <label htmlFor="api-key" className="mt-6 block text-[12px] font-medium text-fg-2">
        API key
      </label>
      <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 focus-within:border-[var(--accent)]">
        <KeyRound size={15} className="text-fg-3" aria-hidden />
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="rc_live_…"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'api-key-error' : undefined}
          className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
      </div>
      {error && (
        <p id="api-key-error" role="alert" className="mt-2 text-[12.5px]" style={{ color: 'var(--fail)' }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        Open dashboard
      </button>
      <p className="mt-4 text-[12px] leading-relaxed text-fg-3">
        No key yet? Create a read-only key with{' '}
        <code className="font-mono whitespace-nowrap">POST /v1/api-keys</code> using your admin key, then
        upload runs from CI with <code className="font-mono whitespace-nowrap">rolecall run --push</code>.
      </p>
    </form>
  );
}

function Onboarding() {
  const steps = [
    { cmd: 'npx rolecall init', text: 'Scaffold a suite: roles, tools and the policy you expect.' },
    { cmd: 'npx rolecall run', text: 'Probe every role × tool and run your scenarios.' },
    { cmd: 'npx rolecall ui', text: 'Open this dashboard on the results.' },
  ];
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-12">
      <LogoMark size={44} />
      <h1 className="mt-5 text-[24px] font-semibold tracking-tight text-fg">No runs yet</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
        Who can make your agent do what? Rolecall calls every role against every tool and records where each
        denial came from. Three commands to your first matrix:
      </p>
      <ol className="mt-6 space-y-3">
        {steps.map((s, i) => (
          <li key={s.cmd} className="card flex items-center gap-3 px-4 py-3">
            <span className="tnum inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-fg-2">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <code className="flex items-center gap-1.5 font-mono text-[13px] text-fg">
                <Terminal size={13} className="text-fg-3" aria-hidden />
                {s.cmd}
              </code>
              <p className="mt-0.5 text-xs text-fg-3">{s.text}</p>
            </div>
            <CopyButton value={s.cmd} label={`Copy ${s.cmd}`} />
          </li>
        ))}
      </ol>
    </div>
  );
}
