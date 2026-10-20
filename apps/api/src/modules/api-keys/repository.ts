import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { apiKeys } from '../../db/schema.js';
import type { Scope } from '../../shared/auth.js';

export interface ApiKey {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeysRepository {
  listByOrg(orgId: string): Promise<ApiKey[]>;
  insert(key: Omit<ApiKey, 'createdAt' | 'lastUsedAt' | 'revokedAt'> & { hash: string }): Promise<ApiKey>;
  /** Marks the key revoked; returns false when no such active key exists in the org. */
  revoke(orgId: string, id: string, at: Date): Promise<boolean>;
  /** System lookup for authentication: the hash is the credential, so it is not tenant-scoped. */
  findActiveByHash(hash: string): Promise<ApiKey | null>;
  touch(id: string, at: Date): Promise<void>;
}

const columns = {
  id: apiKeys.id,
  orgId: apiKeys.orgId,
  projectId: apiKeys.projectId,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  scopes: apiKeys.scopes,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
};

const asKey = (row: Omit<ApiKey, 'scopes'> & { scopes: string[] }): ApiKey => ({
  ...row,
  scopes: row.scopes as Scope[],
});

export class DrizzleApiKeysRepository implements ApiKeysRepository {
  constructor(private readonly db: Database) {}

  async listByOrg(orgId: string): Promise<ApiKey[]> {
    const rows = await this.db
      .select(columns)
      .from(apiKeys)
      .where(eq(apiKeys.orgId, orgId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(asKey);
  }

  async insert(
    key: Omit<ApiKey, 'createdAt' | 'lastUsedAt' | 'revokedAt'> & { hash: string },
  ): Promise<ApiKey> {
    const [row] = await this.db.insert(apiKeys).values(key).returning(columns);
    if (!row) throw new Error('insert returned no row');
    return asKey(row);
  }

  async revoke(orgId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(apiKeys)
      .set({ revokedAt: at })
      .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    return rows.length > 0;
  }

  async findActiveByHash(hash: string): Promise<ApiKey | null> {
    const [row] = await this.db
      .select(columns)
      .from(apiKeys)
      .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
      .limit(1);
    return row ? asKey(row) : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
  }
}
