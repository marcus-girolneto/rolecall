import { z } from 'zod';

export const projectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    defaultBranch: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'Project' });

export const createProjectBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes')
    .optional(),
  defaultBranch: z.string().trim().min(1).max(255).default('main'),
});

export type ProjectDto = z.output<typeof projectSchema>;
export type CreateProjectInput = z.output<typeof createProjectBody>;
