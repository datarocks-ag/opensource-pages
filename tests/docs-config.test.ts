import { expect, test } from 'vitest';
import { sidebarTopics } from '../src/lib/docs-topics.ts';
import type { ProjectData } from '../src/lib/project-data.ts';
import type { ReleaseInfo } from '../src/lib/releases.ts';

const project = (repo: string): ProjectData => ({
  repo, name: repo, order: 1, tagline: '', highlights: [], features: [], docsPath: 'docs', sections: [],
});
const nullRelease = (repo: string): ReleaseInfo => ({
  repo, version: null, tag: null, publishedAt: null, license: null,
  docsAvailable: false, changelogAvailable: false, warnings: [],
});
const projects = [project('keycloak-provisioner'), project('postgres-provisioner')];

test('only projects with released docs get a topic', () => {
  const topics = sidebarTopics(projects, (r) => ({
    ...nullRelease(r), docsAvailable: r === 'postgres-provisioner', version: 'v2.0.0',
  }));
  expect(topics.map((t) => t.link)).toEqual(['/postgres-provisioner/docs/', '/provisioners/guides/']);
  expect(topics[0].label).toBe('postgres-provisioner · v2.0.0');
  expect(topics[0].items).toEqual([{ autogenerate: { directory: 'postgres-provisioner/docs' } }]);
});

test('guides topic remains when no project has docs', () => {
  const topics = sidebarTopics(projects, nullRelease);
  expect(topics.map((t) => t.link)).toEqual(['/provisioners/guides/']);
});
