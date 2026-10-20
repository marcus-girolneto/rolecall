import {
  type ForbidResult,
  type PolicyResult,
  type RunComparison,
  type RunResult,
  type Status,
  type TestResult,
  titleOf,
  type VerifyReport,
} from '@rolecall/core';

const tty = !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  magenta: paint(35),
  cyan: paint(36),
};

const ICON: Record<Status, string> = {
  pass: c.green('✔'),
  fail: c.red('✖'),
  warn: c.yellow('▲'),
  error: c.magenta('◆'),
};
const RANK: Record<Status, number> = { pass: 0, warn: 1, error: 2, fail: 3 };

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes to measure visible width
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - visible(s)));
const show = (v: unknown) => (v === undefined ? '∅' : JSON.stringify(v));

/** One-line, plain-language outcome of a forbidden tool in a conversation. */
export function forbidPhrase(f: ForbidResult): string {
  if (f.layer === 'executed') return c.red(`${f.tool} ran`);
  if (f.layer === 'authz_blocked') return c.green('blocked by your code');
  if (f.layer === 'errored') return c.magenta(`${f.tool} failed for another reason (unconfirmed)`);
  if (!f.probe) return c.dim(`the AI refused (add examples.${f.tool} to double-check your code)`);
  if (f.probe.outcome === 'executed') return c.yellow('only the AI refused, your code would allow it');
  if (f.probe.outcome === 'authz_blocked') return c.green('the AI refused, and your code blocks it too');
  return c.dim('the AI refused (code check unconfirmed)');
}

function cellText(tests: PolicyResult[]): string {
  const worst = tests.reduce((w, t) => (RANK[t.status] > RANK[w] ? t.status : w), 'pass' as Status);
  const problems = tests.filter((t) => t.status !== 'pass').length;
  if (worst === 'fail') return c.red(`✖ ${problems} problem${problems > 1 ? 's' : ''}`);
  if (worst === 'error') return c.magenta('◆ unconfirmed');
  if (worst === 'warn') return c.yellow('▲ AI only');
  if (tests.every((t) => t.expect === 'allow')) return c.green('✔ allowed');
  if (tests.every((t) => t.expect === 'deny')) return c.green('✔ blocked');
  return c.green('✔ limited');
}

export function printRun(result: RunResult, opts: { comparison?: RunComparison } = {}): void {
  const out: string[] = [];
  const s = result.summary;
  out.push('', `${c.bold('rolecall')} ${c.dim('·')} ${result.suite.name}`, '');
  if (s.fail) {
    const couldNotRun = s.error ? `, ${s.error} could not run` : '';
    out.push(
      `  ${c.red(c.bold(`✖ ${s.fail} permission problem${s.fail > 1 ? 's' : ''} found`))}  ${c.dim(`${s.pass} of ${s.total} checks passed${couldNotRun}`)}`,
    );
  } else if (s.error) {
    out.push(
      `  ${c.magenta(c.bold(`◆ ${s.error} of ${s.total} checks could not run`))}  ${c.dim('see why below')}`,
    );
  } else if (s.warn) {
    out.push(
      `  ${c.yellow(c.bold(`▲ ${s.warn} warning${s.warn > 1 ? 's' : ''}`))}  ${c.dim(`no violations, ${s.pass} of ${s.total} checks passed`)}`,
    );
  } else {
    out.push(
      `  ${c.green(c.bold('✔ Every role holds'))}  ${c.dim(`${s.total} of ${s.total} checks passed`)}`,
    );
  }
  out.push('');

  if (result.policy.length) {
    out.push(c.bold('Who can do what'));
    const tools = [...new Set(result.policy.map((p) => p.tool))];
    const roleW = Math.max(8, ...result.roles.map((r) => r.length)) + 2;
    const colW = tools.map((t) => Math.max(t.length, 14) + 2);
    out.push(`  ${' '.repeat(roleW)}${tools.map((t, i) => c.dim(pad(t, colW[i] ?? 0))).join('')}`);
    for (const role of result.roles) {
      const cells = tools.map((tool, i) => {
        const tests = result.policy.filter((p) => p.role === role && p.tool === tool);
        return pad(tests.length ? cellText(tests) : c.dim('·'), colW[i] ?? 0);
      });
      out.push(`  ${pad(role, roleW)}${cells.join('')}`);
    }
    out.push('');
  }

  const conversations = result.scenarios.filter((sc) => !sc.technique);
  const attacks = result.scenarios.filter((sc) => sc.technique);
  if (conversations.length) {
    out.push(c.bold('Conversations'));
    for (const sc of conversations) {
      const phrases = sc.forbidden.map(forbidPhrase);
      out.push(
        `  ${ICON[sc.status]} ${sc.name} ${c.dim(`(${sc.role})`)}${phrases.length ? `${c.dim(':')} ${phrases.join('; ')}` : ''}`,
      );
    }
    out.push('');
  }
  if (attacks.length) {
    const count = (st: Status) => attacks.filter((a) => a.status === st).length;
    const parts = [
      c.green(`${count('pass')} held`),
      count('fail') ? c.red(`${count('fail')} got through`) : '',
      count('warn') ? c.yellow(`${count('warn')} held only because the AI refused`) : '',
      count('error') ? c.magenta(`${count('error')} could not run`) : '',
    ].filter(Boolean);
    out.push(`${c.bold(`AI-generated attacks (${attacks.length})`)}  ${parts.join(c.dim(' · '))}`);
    const byTechnique = new Map<string, number>();
    for (const a of attacks)
      byTechnique.set(a.technique ?? '', (byTechnique.get(a.technique ?? '') ?? 0) + 1);
    out.push(c.dim(`  techniques: ${[...byTechnique].map(([t, n]) => `${t} ×${n}`).join(', ')}`));
    out.push('');
  }

  const failing = [...result.policy, ...result.scenarios]
    .filter((t) => t.status !== 'pass')
    .sort((a, b) => RANK[b.status] - RANK[a.status]);
  // Identical "could not run" errors (usually an unfinished setup) are shown once, not once per role.
  const groups = new Map<string, TestResult[]>();
  for (const t of failing) {
    const first = t.findings[0];
    const key = t.status === 'error' && t.kind === 'policy' && first ? `${t.tool}|${first.message}` : t.id;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const items = [...groups.values()];
  if (items.length) {
    out.push(c.bold(`To look at (${items.length})`));
    items.forEach((group, i) => {
      const t = group[0] as TestResult;
      if (group.length > 1 && t.kind === 'policy') {
        const roles = group.map((g) => (g.kind === 'policy' ? g.role : '')).join(', ');
        out.push(`  ${ICON.error} ${c.bold(`${i + 1}. ${t.tool} could not be checked (${roles})`)}`);
        const f = t.findings[0];
        if (f) out.push(`     ${f.message}`);
        if (f?.hint) out.push(`     ${c.cyan('How to fix:')} ${f.hint}`);
        out.push('');
        return;
      }
      out.push(`  ${ICON[t.status]} ${c.bold(`${i + 1}. ${titleOf(t)}`)}`);
      if (t.kind === 'scenario' && t.technique) {
        const said = t.timeline.find((e) => e.type === 'user');
        if (said?.type === 'user') out.push(`     ${c.dim('Attack message:')} "${said.text}"`);
      }
      for (const f of t.findings) {
        out.push(`     ${f.message}`);
        if (f.hint) out.push(`     ${c.cyan('How to fix:')} ${f.hint}`);
      }
      for (const d of t.stateDiff.slice(0, 4)) {
        out.push(
          `     ${c.dim('Data changed:')} ${d.path}: ${c.red(show(d.before))} → ${c.green(show(d.after))}`,
        );
      }
      if (t.stateDiff.length > 4) out.push(c.dim(`     … ${t.stateDiff.length - 4} more data changes`));
      out.push('');
    });
  }

  if (opts.comparison) {
    const { regressions, fixes, newlyAttempted } = opts.comparison;
    out.push(c.bold('Since the last run'));
    if (!regressions.length && !fixes.length && !newlyAttempted.length) out.push(c.dim('  nothing changed'));
    for (const r of regressions)
      out.push(`  ${c.red('got worse')}  ${r.title} ${c.dim(`(${r.from} → ${r.to})`)}`);
    for (const r of fixes)
      out.push(`  ${c.green('fixed')}      ${r.title} ${c.dim(`(${r.from} → ${r.to})`)}`);
    for (const n of newlyAttempted) out.push(`  ${c.yellow('new tools')}  ${n.id}: ${n.tools.join(', ')}`);
    out.push('');
  }

  out.push(
    c.dim(
      `${s.total} checks · ${s.pass} passed · ${s.fail} failed · ${s.warn} warnings · ${s.error} unconfirmed`,
    ),
  );
  console.log(out.join('\n'));
}

export function printVerify(dir: string, report: VerifyReport): void {
  if (report.ok) {
    const how = report.signed
      ? `signed by key ${report.keyId}${report.trustedKey ? ' (trusted key)' : ' (embedded key, pass --public-key to pin it)'}`
      : 'unsigned: detects accidental changes only; set ROLECALL_SIGNING_KEY for tamper evidence';
    console.log(`${c.green('✔ verified')} ${dir}\n  root ${c.dim(report.rootHash ?? '')}\n  ${how}`);
  } else {
    console.log(`${c.red('✖ verification failed')} ${dir}`);
    for (const p of report.problems) console.log(`  - ${p}`);
  }
}
