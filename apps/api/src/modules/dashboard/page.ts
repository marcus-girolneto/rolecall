import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { DashboardBootstrap } from '@rolecall/core';

// dist/dashboard/index.html when built; ../../../dist/dashboard/index.html when running from src (tsx, tests).
const CANDIDATES = [
  new URL('../../dashboard/index.html', import.meta.url),
  new URL('../../../dist/dashboard/index.html', import.meta.url),
];

export interface RenderedPage {
  html: string;
  /** CSP that allows exactly the inline scripts in `html`, by hash. */
  csp: string;
}

/** The single-file dashboard (apps/ui) rendered in cloud mode. */
export class DashboardPage {
  private template: string | null | undefined;

  constructor(private readonly loadTemplate: () => string | null = defaultTemplate) {}

  render(bootstrap: DashboardBootstrap): RenderedPage | null {
    if (this.template === undefined) this.template = this.loadTemplate();
    if (!this.template) return null;
    const json = JSON.stringify(bootstrap).replace(
      /[<\u2028\u2029]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    // A function replacement: run data may contain $&, $' or $` which a string replacement would expand.
    const html = this.template.replace(
      '<!--rolecall:bootstrap-->',
      () => `<script>window.__ROLECALL__=${json}</script>`,
    );
    return { html, csp: cspFor(html) };
  }
}

function defaultTemplate(): string | null {
  const file = CANDIDATES.find((u) => existsSync(u));
  return file ? readFileSync(file, 'utf8') : null;
}

function cspFor(html: string): string {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '')
        .digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    // React sets style attributes; Tailwind output is inlined.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}
