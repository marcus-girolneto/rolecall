export const SCOPES = ['runs:write', 'runs:read', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

/** Who is calling. Attached to the request by the auth plugin; passed explicitly into services. */
export interface AuthContext {
  keyId: string;
  orgId: string;
  /** Set when the key is bound to a single project. */
  projectId: string | null;
  scopes: Scope[];
}

/** `admin` implies every scope. Otherwise the key needs at least one of `required`. */
export const hasAnyScope = (auth: AuthContext, required: readonly Scope[]): boolean =>
  auth.scopes.includes('admin') || required.some((s) => auth.scopes.includes(s));
