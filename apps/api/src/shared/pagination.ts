import { z } from 'zod';
import { AppError } from './errors.js';

export interface Cursor {
  createdAt: string;
  id: string;
}

export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify([c.createdAt, c.id])).toString('base64url');

export function decodeCursor(raw: string): Cursor {
  try {
    const [createdAt, id] = z
      .tuple([z.iso.datetime(), z.string().min(1)])
      .parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return { createdAt, id };
  } catch {
    throw new AppError('bad_request', 'Invalid cursor');
  }
}

export const limitSchema = z.coerce.number().int().min(1).max(100).default(25);

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
