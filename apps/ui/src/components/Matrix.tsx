import type { Layer, RunResult } from '@rolecall/core';
import { Ban, Check, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildMatrix, cellKey, LAYER_LABEL, type MatrixCell } from '../lib/model';
import { ExpectBadge, InfoPopover, LAYER_ICON, LayersExplainer, STATUS_META, StatusIcon, tint } from './ui';

const CELL_WORD = { pass: 'OK', warn: 'AI only', error: 'Not checked', fail: 'Problem' } as const;

function outcomeCounts(cell: MatrixCell): Array<[Layer, number]> {
  const m = new Map<Layer, number>();
  for (const t of cell.tests) m.set(t.outcome, (m.get(t.outcome) ?? 0) + 1);
  return [...m.entries()];
}

function cellLabel(c: MatrixCell): string {
  if (!c.status) return `${c.role} → ${c.tool}: not tested`;
  const n = c.tests.length;
  return `${c.role} → ${c.tool}: ${CELL_WORD[c.status]}. ${n} test${n === 1 ? '' : 's'}, should be ${c.expect === 'deny' ? 'blocked' : c.expect === 'allow' ? 'allowed' : 'mixed'}${
    c.failing ? `, ${c.failing} not passing` : ''
  }. Open details.`;
}

interface Hover {
  cell: MatrixCell;
  x: number;
  top: number;
  bottom: number;
}

export function PermissionMatrix({
  result,
  onOpenCell,
}: {
  result: RunResult;
  onOpenCell: (role: string, tool: string) => void;
}) {
  const m = useMemo(() => buildMatrix(result), [result]);
  const [hover, setHover] = useState<Hover | null>(null);

  if (!m.roles.length || !m.tools.length || !result.policy.length) {
    return (
      <p className="px-5 py-8 text-center text-sm text-fg-3">
        This suite has no policy rules, so there is no matrix to draw.
      </p>
    );
  }

  const show = (cell: MatrixCell, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHover({ cell, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };

  return (
    <div>
      <div className="scroll-thin overflow-x-auto px-4 pt-4 pb-2 sm:px-5" onScroll={() => setHover(null)}>
        <table
          className="w-full border-separate"
          style={{ borderSpacing: 8 }}
          aria-label="Who can do what: users by tools"
        >
          <thead>
            <tr>
              <th scope="col" className="w-20 text-left sm:w-28 align-bottom">
                <span className="eyebrow">Role</span>
              </th>
              {m.tools.map((tool) => (
                <th
                  key={tool}
                  scope="col"
                  className="min-w-[136px] px-1 sm:min-w-[148px] pb-1 text-left align-bottom"
                >
                  <span className="block truncate font-mono text-[12.5px] font-medium text-fg-2" title={tool}>
                    {tool}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.roles.map((role) => (
              <tr key={role}>
                <th scope="row" className="pr-2 text-left align-middle">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                    <User size={13} className="shrink-0 text-fg-3" aria-hidden />
                    <span className="truncate" title={role}>
                      {role}
                    </span>
                  </span>
                </th>
                {m.tools.map((tool) => {
                  const c = m.cells.get(cellKey(role, tool));
                  if (!c?.status)
                    return (
                      <td
                        key={tool}
                        className="h-[92px] rounded-[10px] border border-dashed border-line align-middle"
                      >
                        <span className="block text-center text-xs text-fg-3">Not tested</span>
                      </td>
                    );
                  const color = STATUS_META[c.status].color;
                  return (
                    <td key={tool} className="h-[92px] p-0 align-top">
                      <button
                        type="button"
                        className="group flex h-full min-h-[92px] w-full flex-col justify-between rounded-[10px] border px-3 py-2.5 text-left transition-[transform,box-shadow] duration-150 hover:-translate-y-px"
                        style={{
                          ...tint(color, c.status === 'pass' ? 9 : 16, c.status === 'pass' ? 26 : 50),
                        }}
                        aria-label={cellLabel(c)}
                        onClick={() => onOpenCell(role, tool)}
                        onMouseEnter={(e) => show(c, e.currentTarget)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={(e) => show(c, e.currentTarget)}
                        onBlur={() => setHover(null)}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                            <StatusIcon status={c.status} size={15} />
                            {CELL_WORD[c.status]}
                          </span>
                          <span className="tnum text-xs whitespace-nowrap text-fg-3">
                            {c.failing
                              ? `${c.failing} of ${c.tests.length}`
                              : `${c.tests.length} test${c.tests.length === 1 ? '' : 's'}`}
                          </span>
                        </span>
                        <span className="flex w-full items-end justify-between gap-2">
                          {c.expect === 'mixed' ? (
                            <MixedExpect cell={c} />
                          ) : (
                            <ExpectBadge expect={c.expect ?? 'deny'} />
                          )}
                          <span className="flex items-center gap-1.5">
                            {outcomeCounts(c).map(([layer, n]) => {
                              const Icon = LAYER_ICON[layer];
                              return (
                                <span
                                  key={layer}
                                  className="tnum inline-flex items-center gap-0.5 text-[11px] text-fg-3"
                                  aria-hidden
                                >
                                  <Icon size={11} />
                                  {n > 1 ? n : ''}
                                </span>
                              );
                            })}
                          </span>
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && <CellTooltip hover={hover} />}
      <MatrixLegend />
    </div>
  );
}

function CellTooltip({ hover }: { hover: Hover }) {
  const { cell, x } = hover;
  const left = Math.max(16, Math.min(x - 140, window.innerWidth - 296));
  const estHeight = 72 + cell.tests.length * 22;
  const below = hover.bottom + 8 + estHeight < window.innerHeight;
  const pos = below ? { top: hover.bottom + 8 } : { bottom: window.innerHeight - hover.top + 8 };
  return (
    <div
      role="tooltip"
      className="anim-pop pointer-events-none fixed z-50 w-[280px] rounded-lg border border-line-strong bg-surface p-3 text-xs"
      style={{ left, ...pos, boxShadow: 'var(--shadow)' }}
    >
      <p className="mb-2 font-mono text-[11.5px] text-fg-2">
        {cell.role} → {cell.tool}
      </p>
      <ul className="space-y-1.5">
        {cell.tests.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <StatusIcon status={t.status} size={12} />
            <span className="min-w-0 flex-1 truncate text-fg">{t.label ?? 'default probe'}</span>
            <span className="shrink-0 text-fg-3">
              {t.expect} → {LAYER_LABEL[t.outcome]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-line pt-2 text-fg-3">Click or press Enter for details</p>
    </div>
  );
}

function MatrixLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 text-xs text-fg-2 sm:px-5">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {(['pass', 'warn', 'error', 'fail'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <StatusIcon status={s} size={13} />
            {CELL_WORD[s]}
          </span>
        ))}
      </span>
      <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
      <span className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <Check size={13} aria-hidden /> should be allowed
        </span>
        <span className="inline-flex items-center gap-1">
          <Ban size={13} aria-hidden /> should be blocked
        </span>
      </span>
      <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
      <span className="flex flex-wrap items-center gap-3">
        {(['authz_blocked', 'executed', 'errored'] as const).map((l) => {
          const Icon = LAYER_ICON[l];
          return (
            <span key={l} className="inline-flex items-center gap-1">
              <Icon size={12} aria-hidden /> {LAYER_LABEL[l]}
            </span>
          );
        })}
      </span>
      <span className="ml-auto">
        <InfoPopover label="How layers work" align="right">
          <LayersExplainer />
          <p className="mt-3 text-fg-3">
            Matrix cells are direct probes: each calls the tool handler as that role, bypassing the model. A
            cell with several labelled probes (e.g. within and above a refund limit) can mix allow and deny
            expectations.
          </p>
        </InfoPopover>
      </span>
    </div>
  );
}

function MixedExpect({ cell }: { cell: MatrixCell }) {
  const allow = cell.tests.filter((t) => t.expect === 'allow').length;
  const deny = cell.tests.length - allow;
  return (
    <span className="tnum inline-flex items-center gap-2 text-xs font-medium text-fg-2">
      <span className="inline-flex items-center gap-0.5">
        <Check size={13} strokeWidth={2.25} aria-hidden /> {allow}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <Ban size={13} strokeWidth={2.25} aria-hidden /> {deny}
      </span>
    </span>
  );
}
