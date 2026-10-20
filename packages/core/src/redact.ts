const BUILTIN_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{16,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
];
const SECRET_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;

export interface Redactor {
  string(value: string): string;
  deep<T>(value: T): T;
}

/** Builds a redactor from explicit values, secret-looking environment variables and known token formats. */
export function createRedactor(
  opts: { values?: string[]; patterns?: RegExp[]; env?: NodeJS.ProcessEnv } = {},
): Redactor {
  const env = opts.env ?? process.env;
  const values = new Set((opts.values ?? []).filter((v) => v.length >= 4));
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_ENV_NAME.test(name)) values.add(value);
  }
  const sorted = [...values].sort((a, b) => b.length - a.length);
  const patterns = [...BUILTIN_PATTERNS, ...(opts.patterns ?? [])].map((p) =>
    p.global ? p : new RegExp(p.source, `${p.flags}g`),
  );

  const string = (input: string): string => {
    let out = input;
    for (const v of sorted) out = out.split(v).join('[REDACTED]');
    for (const p of patterns) out = out.replace(p, '[REDACTED]');
    return out;
  };
  const deep = <T>(value: T): T => {
    if (typeof value === 'string') return string(value) as T;
    if (Array.isArray(value)) return value.map(deep) as T;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = deep(v);
      return out as T;
    }
    return value;
  };
  return { string, deep };
}
