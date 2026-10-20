import { titleOf } from './compare.js';
import type { RunResult, TestResult } from './types.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JUnit XML so CI systems show each Rolecall test natively. Warnings pass and are reported in system-out. */
export function toJUnit(result: RunResult): string {
  const suite = (name: string, tests: TestResult[]) => {
    const failures = tests.filter((t) => t.status === 'fail').length;
    const errors = tests.filter((t) => t.status === 'error').length;
    const cases = tests.map((t) => {
      const detail = esc(
        t.findings.map((f) => `[${f.code}] ${f.message}${f.hint ? `\nFix: ${f.hint}` : ''}`).join('\n'),
      );
      const body =
        t.status === 'fail'
          ? `<failure message="${esc(t.findings[0]?.message ?? 'failed')}">${detail}</failure>`
          : t.status === 'error'
            ? `<error message="${esc(t.findings[0]?.message ?? 'error')}">${detail}</error>`
            : t.status === 'warn'
              ? `<system-out>${detail}</system-out>`
              : '';
      return `    <testcase classname="${esc(`${result.suite.name}.${name}`)}" name="${esc(titleOf(t))}">${body}</testcase>`;
    });
    return `  <testsuite name="${esc(`${result.suite.name} — ${name}`)}" tests="${tests.length}" failures="${failures}" errors="${errors}">\n${cases.join('\n')}\n  </testsuite>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="rolecall">\n${suite('policy', result.policy)}\n${suite('scenarios', result.scenarios)}\n</testsuites>\n`;
}
