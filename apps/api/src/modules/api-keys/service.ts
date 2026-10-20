import type { AuthContext } from '../../shared/auth.js';
import type { Clock } from '../../shared/clock.js';
import { generateApiKey, hashApiKey, looksLikeApiKey } from '../../shared/crypto.js';
import { notFound } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import type { ProjectsRepository } from '../projects/repository.js';
import type { ApiKey, ApiKeysRepository } from './repository.js';
import type { ApiKeyCreatedDto, ApiKeyDto, CreateApiKeyInput } from './schemas.js';

const TOUCH_INTERVAL_MS = 60_000;

export const toApiKeyDto = (k: ApiKey): ApiKeyDto => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scopes: k.scopes,
  projectId: k.projectId,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
});

export class ApiKeysService {
  constructor(
    private readonly keys: ApiKeysRepository,
    private readonly projects: ProjectsRepository,
    private readonly clock: Clock,
  ) {}

  /** Resolves a bearer token to an auth context, or null for unknown, malformed or revoked keys. */
  async authenticate(token: string): Promise<AuthContext | null> {
    if (!looksLikeApiKey(token)) return null;
    const key = await this.keys.findActiveByHash(hashApiKey(token));
    if (!key) return null;
    const now = this.clock.now();
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
      await this.keys.touch(key.id, now);
    return { keyId: key.id, orgId: key.orgId, projectId: key.projectId, scopes: key.scopes };
  }

  async list(auth: AuthContext): Promise<ApiKeyDto[]> {
    return (await this.keys.listByOrg(auth.orgId)).map(toApiKeyDto);
  }

  async create(auth: AuthContext, input: CreateApiKeyInput): Promise<ApiKeyCreatedDto> {
    if (input.projectId && !(await this.projects.findById(auth.orgId, input.projectId)))
      throw notFound('Project');
    const secret = generateApiKey();
    const key = await this.keys.insert({
      id: newId('key'),
      orgId: auth.orgId,
      projectId: input.projectId ?? null,
      name: input.name,
      prefix: secret.prefix,
      hash: secret.hash,
      scopes: [...new Set(input.scopes)],
    });
    return { ...toApiKeyDto(key), key: secret.plaintext };
  }

  async revoke(auth: AuthContext, id: string): Promise<void> {
    if (!(await this.keys.revoke(auth.orgId, id, this.clock.now()))) throw notFound('API key');
  }
}
