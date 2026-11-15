import { expect, test } from 'vitest';
import { docGroup, projectSidebar, sidebarTopics } from '../src/lib/docs-topics.ts';
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
  }), () => ['index.md']);
  expect(topics.map((t) => t.link)).toEqual(['/postgres-provisioner/docs/', '/provisioners/guides/']);
  expect(topics[0].label).toBe('postgres-provisioner · v2.0.0');
  expect(topics[0].items).toEqual([{ label: 'Getting started', items: [{ slug: 'postgres-provisioner/docs' }] }]);
});

test('guides topic remains when no project has docs', () => {
  const topics = sidebarTopics(projects, nullRelease);
  expect(topics.map((t) => t.link)).toEqual(['/provisioners/guides/']);
});

test('pages map to the spec groups', () => {
  expect(docGroup('index.md')).toBe('Getting started');
  expect(docGroup('getting-started.md')).toBe('Getting started');
  expect(docGroup('configuration.md')).toBe('Reference');
  expect(docGroup('howto/app-migrations.md')).toBe('How-tos');
  expect(docGroup('faq.md')).toBe('Help');
  expect(docGroup('changelog.md')).toBe('Help');
  expect(docGroup('upgrading-to-2.0.md')).toBe('Help');
});

test('sidebar lists groups in spec order with slugs that match the synced pages', () => {
  const items = projectSidebar('postgres-provisioner', [
    'changelog.md', 'faq.md', 'upgrading-to-2.0.md', 'howto/a.md', 'configuration.md', 'ARCHITECTURE.md', 'getting-started.md', 'index.md',
  ]);
  expect(items).toEqual([
    { label: 'Getting started', items: [{ slug: 'postgres-provisioner/docs' }, { slug: 'postgres-provisioner/docs/getting-started' }] },
    { label: 'Reference', items: [{ slug: 'postgres-provisioner/docs/architecture' }, { slug: 'postgres-provisioner/docs/configuration' }] },
    { label: 'How-tos', items: [{ slug: 'postgres-provisioner/docs/howto/a' }] },
    { label: 'Help', items: [
      { slug: 'postgres-provisioner/docs/changelog' }, { slug: 'postgres-provisioner/docs/faq' }, { slug: 'postgres-provisioner/docs/upgrading-to-2-0' },
    ] },
  ]);
});

test('groups without pages are left out', () => {
  expect(projectSidebar('r', ['faq.md']).map((g) => 'label' in g && g.label)).toEqual(['Help']);
});
