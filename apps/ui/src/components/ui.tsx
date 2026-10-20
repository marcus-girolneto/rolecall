import type { Layer, Status } from '@rolecall/core';
import {
  Ban,
  Bot,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  Info,
  Lock,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { pretty } from '../lib/format';
import { LAYER_LABEL } from '../lib/model';

export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; color: string }> = {
  pass: { label: 'OK', icon: CircleCheck, color: 'var(--pass)' },
  warn: { label: 'AI only', icon: TriangleAlert, color: 'var(--warn)' },
  error: { label: 'Not checked', icon: OctagonAlert, color: 'var(--error)' },
  fail: { label: 'Problem', icon: CircleX, color: 'var(--fail)' },
};

export const LAYER_ICON: Record<Layer, LucideIcon> = {
  model_refused: Bot,
  authz_blocked: Lock,
  executed: Zap,
  errored: OctagonAlert,
};

/** Background/border tint derived from a status color. */
export function tint(color: string, bg = 12, border = 32): CSSProperties {
  return {
    background: `color-mix(in oklab, ${color} ${bg}%, var(--surface))`,
    borderColor: `color-mix(in oklab, ${color} ${border}%, var(--border))`,
  };
}

export function StatusIcon({
  status,
  size = 16,
  className = '',
}: {
  status: Status;
  size?: number;
  className?: string;
}) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Icon
      size={size}
      strokeWidth={2.25}
      className={`status-mark shrink-0 ${className}`}
      style={{ color: m.color }}
      aria-label={m.label}
      role="img"
    />
  );
}

export function StatusDot({ status, label }: { status: Status | null; label?: string }) {
  const color = status ? STATUS_META[status].color : 'var(--text-3)';
  return (
    <span
      className="status-mark inline-block size-2 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 0 3px color-mix(in oklab, ${color} 18%, transparent)` }}
      role="img"
      aria-label={label ?? (status ? STATUS_META[status].label : 'Unknown')}
    />
  );
}

export function StatusPill({
  status,
  children,
  size = 'md',
}: {
  status: Status;
  children?: ReactNode;
  size?: 'sm' | 'md';
}) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-[13px]'
      }`}
      style={tint(m.color, 14, 40)}
    >
      <StatusIcon status={status} size={size === 'sm' ? 12 : 14} />
      <span className="text-fg">{children ?? m.label}</span>
    </span>
  );
}

/** Outcome chip for a defense layer. `status` colors it by whether that outcome was acceptable. */
export function LayerChip({
  layer,
  status,
  prefix,
}: {
  layer: Layer;
  status: Status | null;
  prefix?: string;
}) {
  const Icon = LAYER_ICON[layer];
  const color = status ? STATUS_META[status].color : 'var(--text-3)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-fg"
      style={status ? tint(color, 12, 36) : { background: 'var(--surface-2)', borderColor: 'var(--border)' }}
      title={
        status ? `${LAYER_LABEL[layer]} (${STATUS_META[status].label.toLowerCase()})` : LAYER_LABEL[layer]
      }
    >
      <Icon size={12} strokeWidth={2.25} style={{ color }} aria-hidden />
      {prefix && <span className="text-fg-3">{prefix}</span>}
      {LAYER_LABEL[layer]}
    </span>
  );
}

export function ExpectBadge({ expect }: { expect: 'allow' | 'deny' | 'mixed' }) {
  const Icon = expect === 'allow' ? Check : expect === 'deny' ? Ban : Info;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-fg-2">
      <Icon size={13} strokeWidth={2.25} aria-hidden />
      {expect === 'mixed' ? 'mixed rules' : expect === 'allow' ? 'should be allowed' : 'should be blocked'}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
    } catch {
      // Fallback for file:// or denied clipboard permissions.
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setDone(true);
      } finally {
        ta.remove();
      }
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg"
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
    >
      {done ? <Check size={14} style={{ color: 'var(--pass)' }} /> : <Copy size={14} />}
    </button>
  );
}

export function Card({
  title,
  icon,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      className={`card ${className}`}
      aria-labelledby={title && id ? `${id}-title` : undefined}
      id={id}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2
            id={id ? `${id}-title` : undefined}
            className="flex items-center gap-2 text-sm font-semibold text-fg"
          >
            {icon}
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Small click/Enter popover for in-product explanations. Closes on Escape or outside click. */
export function InfoPopover({
  label,
  children,
  align = 'left',
}: {
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Info size={14} aria-hidden />
        {label}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={`anim-pop absolute top-full z-40 mt-2 w-[min(360px,calc(100vw-32px))] rounded-xl border border-line-strong bg-surface p-4 text-[13px] leading-relaxed text-fg-2 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{ boxShadow: 'var(--shadow)' }}
        >
          <button
            type="button"
            className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-md text-fg-3 hover:bg-surface-3 hover:text-fg"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
          {children}
        </div>
      )}
    </span>
  );
}

export function LayersExplainer() {
  const rows: Array<{ layer: Layer; text: ReactNode }> = [
    {
      layer: 'model_refused',
      text: 'The agent never attempted the call. Only the model’s judgement stopped it.',
    },
    { layer: 'authz_blocked', text: 'The call reached your handler and your authorization rejected it.' },
    { layer: 'executed', text: 'Nothing stopped it: the handler ran to completion.' },
    { layer: 'errored', text: 'The handler failed for a reason that is not an authorization denial.' },
  ];
  return (
    <div className="space-y-3">
      <p className="pr-6 font-semibold text-fg">Where does a denial come from?</p>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const Icon = LAYER_ICON[r.layer];
          return (
            <li key={r.layer} className="flex gap-2.5">
              <Icon size={15} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
              <span>
                <span className="font-medium text-fg">{LAYER_LABEL[r.layer]}:</span> {r.text}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="rounded-lg border p-2.5" style={tint('var(--warn)', 10, 30)}>
        <span className="font-semibold text-fg">Only the AI is protecting this:</span> the AI refused, but
        your code would have let that user do it. One clever prompt away from a breach.
      </p>
    </div>
  );
}

export function JsonBlock({ value, label }: { value: unknown; label?: string }) {
  const text = pretty(value);
  return (
    <div className="group relative">
      <pre className="code-block scroll-thin text-fg-2" title={label}>
        {text}
      </pre>
      <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <CopyButton value={text} label={`Copy ${label ?? 'JSON'}`} />
      </div>
    </div>
  );
}

export function Truncate({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`block min-w-0 truncate ${className}`} title={text}>
      {text}
    </span>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  const cells: Array<[number, number, string, number]> = [
    [11, 11, '#3DDC97', 1],
    [26, 11, '#3DDC97', 0.7],
    [41, 11, '#3DDC97', 0.45],
    [11, 26, '#3DDC97', 0.7],
    [26, 26, '#3DDC97', 1],
    [41, 26, '#FF5A5F', 1],
    [11, 41, '#3DDC97', 0.45],
    [26, 41, '#3DDC97', 0.7],
    [41, 41, '#3DDC97', 1],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="16" fill="#12131A" />
      {cells.map(([x, y, fill, o]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="12" height="12" rx="3.5" fill={fill} fillOpacity={o} />
      ))}
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
      {children}
    </kbd>
  );
}
