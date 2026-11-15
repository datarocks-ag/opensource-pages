import { loadCollections, loadProjects, type CollectionData, type ProjectData } from './project-data.ts';

export type PagePath =
  | { params: { slug: string }; props: { kind: 'collection'; collection: CollectionData } }
  | { params: { slug: string }; props: { kind: 'project'; project: ProjectData } };

/** One path per collection slug and one per project repo; both share the top-level `/<slug>/` namespace. */
export function staticPaths(): PagePath[] {
  return [
    ...loadCollections().map((collection): PagePath => ({ params: { slug: collection.slug }, props: { kind: 'collection', collection } })),
    ...loadProjects().map((project): PagePath => ({ params: { slug: project.repo }, props: { kind: 'project', project } })),
  ];
}
