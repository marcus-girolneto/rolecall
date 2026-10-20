import { and, asc, count, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { projects } from '../../db/schema.js';

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  defaultBranch: string;
  createdAt: Date;
}

export interface ProjectsRepository {
  list(orgId: string): Promise<Project[]>;
  findById(orgId: string, id: string): Promise<Project | null>;
  findBySlug(orgId: string, slug: string): Promise<Project | null>;
  count(orgId: string): Promise<number>;
  insert(project: Omit<Project, 'createdAt'>): Promise<Project>;
}

export class DrizzleProjectsRepository implements ProjectsRepository {
  constructor(private readonly db: Database) {}

  list(orgId: string): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .orderBy(asc(projects.createdAt), asc(projects.id));
  }

  async findById(orgId: string, id: string): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id)))
      .limit(1);
    return row ?? null;
  }

  async findBySlug(orgId: string, slug: string): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)))
      .limit(1);
    return row ?? null;
  }

  async count(orgId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(projects).where(eq(projects.orgId, orgId));
    return row?.n ?? 0;
  }

  async insert(project: Omit<Project, 'createdAt'>): Promise<Project> {
    const [row] = await this.db.insert(projects).values(project).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  }
}
