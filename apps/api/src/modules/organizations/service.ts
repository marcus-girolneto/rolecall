import type { AuthContext } from '../../shared/auth.js';
import type { Clock } from '../../shared/clock.js';
import { generateApiKey } from '../../shared/crypto.js';
import { notFound } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { planOf } from '../billing/plans.js';
import { toProjectDto } from '../projects/service.js';
import type { Organization, OrganizationsRepository } from './repository.js';
import type { OrganizationDto, SignupInput, SignupResult } from './schemas.js';

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  name: o.name,
  email: o.email,
  plan: planOf(o.plan).id,
  createdAt: o.createdAt.toISOString(),
});

export class OrganizationsService {
  constructor(
    private readonly orgs: OrganizationsRepository,
    private readonly clock: Clock,
  ) {}

  /** Self-serve signup: free plan, a `default` project and an admin key whose plaintext is returned exactly once. */
  async signup(input: SignupInput): Promise<SignupResult> {
    const now = this.clock.now();
    const org = { id: newId('org'), name: input.orgName, email: input.email.toLowerCase() };
    const project = { id: newId('prj'), name: 'Default', slug: 'default', defaultBranch: 'main' };
    const secret = generateApiKey();
    const key = {
      id: newId('key'),
      name: 'Admin key (created at signup)',
      prefix: secret.prefix,
      hash: secret.hash,
      scopes: ['admin' as const],
    };
    await this.orgs.createWithDefaults({ org, project, key });
    return {
      organization: toOrganizationDto({
        ...org,
        plan: 'free',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: now,
      }),
      project: toProjectDto({ ...project, orgId: org.id, createdAt: now }),
      apiKey: {
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: key.scopes,
        projectId: null,
        createdAt: now.toISOString(),
        lastUsedAt: null,
        revokedAt: null,
        key: secret.plaintext,
      },
    };
  }

  async current(auth: AuthContext): Promise<OrganizationDto> {
    const org = await this.orgs.findById(auth.orgId);
    if (!org) throw notFound('Organization');
    return toOrganizationDto(org);
  }
}
