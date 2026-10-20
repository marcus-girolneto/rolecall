import type { AuthContext } from '../../shared/auth.js';
import { AppError, notFound } from '../../shared/errors.js';
import { newId } from '../../shared/ids.js';
import { planOf, upgradeHint } from '../billing/plans.js';
import type { OrganizationsRepository } from '../organizations/repository.js';
import type { Project, ProjectsRepository } from './repository.js';
import type { CreateProjectInput, ProjectDto } from './schemas.js';

export const toProjectDto = (p: Project): ProjectDto => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  defaultBranch: p.defaultBranch,
  createdAt: p.createdAt.toISOString(),
});

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'project';

export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly orgs: OrganizationsRepository,
  ) {}

  /** Project-bound keys only ever see their own project. */
  async list(auth: AuthContext): Promise<ProjectDto[]> {
    const all = await this.projects.list(auth.orgId);
    return all.filter((p) => !auth.projectId || p.id === auth.projectId).map(toProjectDto);
  }

  async get(auth: AuthContext, id: string): Promise<ProjectDto> {
    return toProjectDto(await this.require(auth, id));
  }

  /** Resolves a project the caller may access, or 404 (never 403, so ids of other tenants are not confirmed). */
  async require(auth: AuthContext, id: string): Promise<Project> {
    if (auth.projectId && auth.projectId !== id) throw notFound('Project');
    const project = await this.projects.findById(auth.orgId, id);
    if (!project) throw notFound('Project');
    return project;
  }

  async create(auth: AuthContext, input: CreateProjectInput): Promise<ProjectDto> {
    const org = await this.orgs.findById(auth.orgId);
    if (!org) throw notFound('Organization');
    const plan = planOf(org.plan);
    if (plan.maxProjects !== null && (await this.projects.count(auth.orgId)) >= plan.maxProjects) {
      throw new AppError(
        'plan_limit_reached',
        `The ${plan.name} plan allows ${plan.maxProjects} project(s). ${upgradeHint(plan.id)}`,
        {
          limit: 'projects',
          max: plan.maxProjects,
          plan: plan.id,
        },
      );
    }
    const slug = input.slug ?? slugify(input.name);
    if (await this.projects.findBySlug(auth.orgId, slug))
      throw new AppError('conflict', `A project with slug "${slug}" already exists`);
    return toProjectDto(
      await this.projects.insert({
        id: newId('prj'),
        orgId: auth.orgId,
        name: input.name,
        slug,
        defaultBranch: input.defaultBranch,
      }),
    );
  }
}
