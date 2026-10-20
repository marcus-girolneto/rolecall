import { createHash, timingSafeEqual } from 'node:crypto';
import { randomToken } from './ids.js';

export const API_KEY_PREFIX = 'rc_live_';
const KEY_PATTERN = /^rc_live_[0-9a-z]{40}$/;

/** A fresh API key. Only the hash and the display prefix are ever stored. */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `${API_KEY_PREFIX}${randomToken(40)}`;
  return { plaintext, hash: hashApiKey(plaintext), prefix: displayPrefix(plaintext) };
}

/** sha256 is appropriate here: keys are 200-bit random secrets, so slow hashing adds nothing but latency. */
export const hashApiKey = (plaintext: string): string => createHash('sha256').update(plaintext).digest('hex');

/** First 8 characters after `rc_live_`, shown in listings so users can tell keys apart. */
export const displayPrefix = (plaintext: string): string =>
  plaintext.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8);

export const looksLikeApiKey = (value: string): boolean => KEY_PATTERN.test(value);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
