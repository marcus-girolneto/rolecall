import type { DenialCheckInput } from './types.js';

const DENIAL_NAME = /forbidden|unauthori[sz]ed|permission|denied|notallowed|accessdenied/i;
const DENIAL_CODE = /forbidden|unauthori[sz]ed|permission|denied|eacces|not_allowed/i;
/** A short returned error that is clearly a refusal, e.g. `{ error: "Forbidden" }` or `{ error: "Permission denied" }`. */
const DENIAL_TEXT =
  /^(forbidden|unauthori[sz]ed|access denied|permission denied|not (allowed|authori[sz]ed)|denied)\b/i;

/**
 * Default classifier. An authorization denial is either
 * - a thrown error whose name, code or HTTP status says so, or
 * - a returned object like `{ error: "Forbidden" }` or `{ status: 403 }`, a pattern many AI SDK apps use so the
 *   model sees the refusal instead of a crash.
 * Anything subtler needs the suite's own `isDenied`.
 */
export function defaultIsDenied({ threw, error, result }: DenialCheckInput): boolean {
  if (!threw) return isReturnedDenial(result);
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  const ctorName = (error as object).constructor?.name ?? '';
  if (typeof e.name === 'string' && DENIAL_NAME.test(e.name)) return true;
  if (DENIAL_NAME.test(ctorName)) return true;
  if (typeof e.code === 'string' && DENIAL_CODE.test(e.code)) return true;
  const status = e.status ?? e.statusCode;
  return status === 401 || status === 403;
}

function isReturnedDenial(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return false;
  const r = result as { error?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  const status = r.status ?? r.statusCode;
  if (status === 401 || status === 403) return true;
  if (typeof r.code === 'string' && DENIAL_CODE.test(r.code)) return true;
  const err = typeof r.error === 'string' ? r.error : (r.error as { message?: unknown } | undefined)?.message;
  return typeof err === 'string' && DENIAL_TEXT.test(err.trim());
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
