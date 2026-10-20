import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

/** Random base32 string with `length` characters (5 bits of entropy each). */
export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export type IdPrefix = 'org' | 'prj' | 'run' | 'key';

/** Prefixed public ids such as `run_7m2k…`: self-describing in logs and support tickets, 100 bits of entropy. */
export const newId = (prefix: IdPrefix): string => `${prefix}_${randomToken(20)}`;
