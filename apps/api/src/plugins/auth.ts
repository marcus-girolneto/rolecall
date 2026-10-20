import type { FastifyInstance, FastifyRequest, onRequestHookHandler } from 'fastify';
import { type AuthContext, hasAnyScope, type Scope } from '../shared/auth.js';
import { forbidden, unauthorized } from '../shared/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** onRequest hook: requires a valid, unrevoked API key with `admin` or one of `scopes`. */
    requireAuth(...scopes: Scope[]): onRequestHookHandler;
  }
}

export type Authenticator = (token: string) => Promise<AuthContext | null>;

/** Narrows `request.auth` for handlers behind `requireAuth`. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

/** Bearer API key authentication. Key lookup is delegated to the api-keys service. */
export function registerAuth(app: FastifyInstance, authenticate: Authenticator): void {
  app.decorateRequest('auth', null);
  app.decorate('requireAuth', (...scopes: Scope[]): onRequestHookHandler => {
    return async (request) => {
      const header = request.headers.authorization;
      const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
      if (!match?.[1]) throw unauthorized('Missing API key. Send `Authorization: Bearer rc_live_…`.');
      const auth = await authenticate(match[1]);
      if (!auth) throw unauthorized('Invalid or revoked API key');
      request.auth = auth;
      if (scopes.length && !hasAnyScope(auth, scopes)) {
        throw forbidden(`This API key needs one of these scopes: ${['admin', ...scopes].join(', ')}`);
      }
    };
  });
}
