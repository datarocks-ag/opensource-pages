import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, expect, test, vi } from 'vitest';

const releases: Record<string, { version: string | null; docs: boolean; changelog?: boolean }> = {
  'keycloak-provisioner': { version: 'v1.13.0', docs: false },
  'postgres-provisioner': { version: 'v2.0.0', docs: true, changelog: true },
  'nats-provisioner': { version: null, docs: false },
};
vi.mock('../src/lib/releases', () => ({
  getRelease: (repo: string) => {
    const r = releases[repo] ?? { version: 'v3.0.0', docs: false };
    return {
      repo, version: r.version, tag: r.version, publishedAt: null, license: r.version ? 'MIT' : null,
      docsAvailable: r.docs, changelogAvailable: r.changelog ?? false, warnings: [],
    };
  },
}));
vi.mock('../src/lib/examples', () => ({
  getConfigExample: (repo: string) => (repo === 'keycloak-provisioner' ? 'strategy: "update"\nrealms: []' : null),
}));

import { renderVersionPlaceholders } from '../src/lib/placeholders';
import { loadCollections, loadProjects } from '../src/lib/project-data';
import CollectionPage from '../src/components/CollectionPage.astro';
import ProjectPage from '../src/components/ProjectPage.astro';
import { staticPaths } from '../src/lib/page-paths';

const projects = loadProjects();
const collection = loadCollections().find((c) => c.slug === 'provisioners')!;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const project = (repo: string) => projects.find((p) => p.repo === repo)!;
const renderProject = (repo: string) => container.renderToString(ProjectPage, { props: { project: project(repo) } });

test('placeholder substitution', () => {
  expect(renderVersionPlaceholders('img:{{version:keycloak-provisioner}}', () => 'v1.13.0')).toBe('img:1.13.0');
  expect(renderVersionPlaceholders('img:{{version:keycloak-provisioner}}', () => null)).toBe('img:latest');
});

test('static paths yield one path per collection and per project', () => {
  const slugs = staticPaths().map((p) => p.params.slug);
  expect(slugs).toContain('provisioners');
  for (const p of projects) expect(slugs).toContain(p.repo);
  expect(slugs).toHaveLength(projects.length + 1);
});

test('conventions matrix shows ✓ and — per repo', async () => {
  const html = await container.renderToString(CollectionPage, { props: { collection } });
  const row = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*--dry-run[\s\S]*?<\/tr>/)![0];
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  const repos = projects.filter((p) => p.collection === 'provisioners').map((p) => p.repo);
  expect(cells).toHaveLength(repos.length);
  expect(cells[repos.indexOf('nats-provisioner')]).toBe('—');
  expect(cells[repos.indexOf('redpanda-provisioner')]).toBe('—');
  expect(cells[repos.indexOf('keycloak-provisioner')]).toBe('✓');
});

test('collection page lists tools and renders compose versions with fallback', async () => {
  const html = await container.renderToString(CollectionPage, { props: { collection } });
  expect(html).toContain('postgres-provisioner:2.0.0');
  expect(html).toContain('keycloak-provisioner:1.13.0');
  expect(html).not.toContain('{{version');
  expect(html).not.toMatch(/null|undefined/);
  expect(html).toContain('href="/nats-provisioner/"');
});

test('project page with docs links to /<repo>/docs/', async () => {
  const html = await renderProject('postgres-provisioner');
  expect(html).toContain('href="/postgres-provisioner/docs/"');
  expect(html).toContain('href="/postgres-provisioner/docs/changelog/"');
});

test('project page without released docs links to README at the tag', async () => {
  const html = await renderProject('keycloak-provisioner');
  expect(html).toContain('href="https://github.com/datarocks-ag/keycloak-provisioner/blob/v1.13.0/README.md"');
  expect(html).not.toContain('/keycloak-provisioner/docs/');
  expect(html).toContain('docker pull ghcr.io/datarocks-ag/keycloak-provisioner:1.13.0');
});

test('project page without any release hides version chip and pulls :latest', async () => {
  const html = await renderProject('nats-provisioner');
  expect(html).toContain('ghcr.io/datarocks-ag/nats-provisioner:latest');
  expect(html).not.toMatch(/v\d+\.\d+/);
  expect(html).not.toMatch(/null|undefined/);
});

test('config excerpt column is present only when an excerpt exists', async () => {
  expect(await renderProject('keycloak-provisioner')).toContain('strategy: &quot;update&quot;');
  expect(await renderProject('nats-provisioner')).not.toContain('class="excerpt"');
});

test('collection member shows "More provisioners" without itself; proxy shows none', async () => {
  const html = await renderProject('keycloak-provisioner');
  const more = html.match(/More provisioners[\s\S]*$/)![0];
  expect(more).toContain('href="/postgres-provisioner/"');
  expect(more).not.toContain('href="/keycloak-provisioner/"');
  expect(await renderProject('go-egress-mitm-proxy')).not.toContain('More provisioners');
});

test('proxy page renders its flow, pattern table and sidecar sections', async () => {
  const html = await renderProject('go-egress-mitm-proxy');
  for (const s of project('go-egress-mitm-proxy').sections) expect(html).toContain(s.title.replace(/'/g, '&#39;'));
  expect(html).toContain('<table');
  expect(html).toContain('How a request flows');
});
