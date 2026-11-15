import type { ProjectData } from './project-data.ts';
import type { ReleaseInfo } from './releases.ts';
import { docsUrl } from './urls.ts';

/** One entry of the `starlight-sidebar-topics` configuration. */
export interface DocsTopic {
  label: string;
  link: string;
  items: { autogenerate: { directory: string } }[];
}

/**
 * Sidebar topics for the docs: one per project whose release carries synced docs, followed by the
 * committed provisioner guides. The guides topic is always present so every docs page belongs to a topic.
 */
export function sidebarTopics(
  projects: ProjectData[],
  releases: (repo: string) => ReleaseInfo,
): DocsTopic[] {
  const perProject = projects.flatMap((p): DocsTopic[] => {
    const release = releases(p.repo);
    if (!release.docsAvailable) return [];
    return [
      {
        label: release.version ? `${p.repo} · ${release.version}` : p.repo,
        link: docsUrl(p.repo),
        items: [{ autogenerate: { directory: `${p.repo}/docs` } }],
      },
    ];
  });
  return [
    ...perProject,
    {
      label: 'Provisioners guides',
      link: '/provisioners/guides/',
      items: [{ autogenerate: { directory: 'provisioners/guides' } }],
    },
  ];
}
