import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Keep in sync with the hand-written validation in src/lib/project-data.ts, which the
// Node sync script uses outside Astro.
const section = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('table'),
    title: z.string(),
    intro: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    type: z.literal('flow'),
    title: z.string(),
    intro: z.string().optional(),
    steps: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  z.object({
    type: z.literal('code'),
    title: z.string(),
    intro: z.string().optional(),
    file: z.string(),
    code: z.string(),
    aside: z.string().optional(),
  }),
  z.object({
    type: z.literal('steps'),
    title: z.string(),
    items: z.array(z.object({ title: z.string(), body: z.string(), code: z.string().optional() })),
  }),
]);

const projects = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/projects' }),
  schema: z.object({
    repo: z.string(),
    name: z.string(),
    collection: z.string().optional(),
    order: z.number(),
    tagline: z.string(),
    highlights: z.array(z.string()),
    resources: z.array(z.string()).optional(),
    features: z.array(z.object({ title: z.string(), body: z.string() })),
    configExample: z
      .object({ path: z.string(), startLine: z.number().optional(), endLine: z.number().optional() })
      .optional(),
    docsPath: z.string().default('docs'),
    sections: z.array(section).default([]),
  }),
});

const collectionDefs = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/collections' }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    steps: z.array(z.object({ title: z.string(), body: z.string(), code: z.string() })),
    principles: z.array(z.object({ title: z.string(), body: z.string() })),
    conventions: z.array(z.object({ label: z.string(), supported: z.array(z.string()) })),
    compose: z.object({ file: z.string(), code: z.string() }),
  }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  projects,
  collections: collectionDefs,
};
