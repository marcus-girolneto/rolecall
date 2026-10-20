import { type PolicyResult, type RunComparison, type RunResult, type Status, titleOf } from '@rolecall/core';

const RANK: Record<Status, number> = { pass: 0, warn: 1, error: 2, fail: 3 };
export const COMMENT_MARKER = '<!-- rolecall:report -->';

const cell = (tests: PolicyResult[]) => {
  const worst = tests.reduce((w, t) => (RANK[t.status] > RANK[w] ? t.status : w), 'pass' as Status);
  if (worst === 'fail') return '❌ **problem**';
  if (worst === 'error') return '🟣 not checked';
  if (worst === 'warn') return '⚠️ AI only';
  return tests.every((t) => t.expect === 'deny') ? '✅ blocked' : '✅ allowed';
};
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Plain-language report for a PR comment or job summary. */
export function toMarkdown(
  result: RunResult,
  opts: { comparison?: RunComparison; bundleDir?: string; marker?: boolean } = {},
): string {
  const s = result.summary;
  const verdict = s.fail
    ? `❌ **${s.fail} permission problem${s.fail > 1 ? 's' : ''}**: a user can make the agent do something your rules forbid.`
    : s.error
      ? `🟣 **${s.error} check${s.error > 1 ? 's' : ''} could not run.** Fix the test setup to get a verdict.`
      : s.warn
        ? `⚠️ **No violations, ${s.warn} warning${s.warn > 1 ? 's' : ''}**: some actions are protected only by the AI's judgement.`
        : '✅ **Every role holds.** No user can make the agent do something your rules forbid.';

  const lines = [opts.marker ? COMMENT_MARKER : '', `### Rolecall · ${result.suite.name}`, '', verdict, ''];

  if (result.policy.length) {
    const tools = [...new Set(result.policy.map((p) => p.tool))];
    lines.push(
      `| Who can do what | ${tools.map((t) => `\`${t}\``).join(' | ')} |`,
      `|---|${tools.map(() => '---').join('|')}|`,
    );
    for (const role of result.roles) {
      const row = tools.map((tool) => {
        const tests = result.policy.filter((p) => p.role === role && p.tool === tool);
        return tests.length ? cell(tests) : '·';
      });
      lines.push(`| **${role}** | ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  const failing = [...result.policy, ...result.scenarios]
    .filter((t) => t.status !== 'pass')
    .sort((a, b) => RANK[b.status] - RANK[a.status]);
  if (failing.length) {
    lines.push('**To look at**', '');
    for (const t of failing.slice(0, 15)) {
      const f = t.findings[0];
      lines.push(`- **${esc(titleOf(t))}**  `);
      if (f) lines.push(`  ${esc(f.message)}  `);
      const change = t.stateDiff[0];
      if (change) {
        lines.push(
          `  Data changed: \`${change.path}\` ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}  `,
        );
      }
      if (f?.hint) lines.push(`  _How to fix:_ ${esc(f.hint)}`);
    }
    if (failing.length > 15) lines.push(`- …and ${failing.length - 15} more in the evidence bundle.`);
    lines.push('');
  }

  if (opts.comparison?.regressions.length) {
    lines.push('**Got worse since the baseline**', '');
    for (const r of opts.comparison.regressions)
      lines.push(`- ${esc(r.title)} (\`${r.from}\` → \`${r.to}\`)`);
    lines.push('');
  }
  lines.push(
    `<sub>${s.total} checks · ${s.pass} passed · ${s.fail} failed · ${s.warn} warnings · ${s.error} not checked` +
      `${opts.bundleDir ? ` · full details in the \`rolecall-evidence\` artifact` : ''}</sub>`,
  );
  return `${lines.filter((l, i) => i > 0 || l).join('\n')}\n`;
}
