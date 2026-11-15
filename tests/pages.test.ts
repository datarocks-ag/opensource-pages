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

test('README fallback is labelled "Documentation on GitHub" and opens externally', async () => {
  const html = await renderProject('keycloak-provisioner');
  expect(html.match(/Documentation on GitHub/g)).toHaveLength(2);
  expect(html).not.toContain('Read the docs');
  const links = [...html.matchAll(/<a [^>]*README\.md"[^>]*>/g)].map((m) => m[0]);
  expect(links).toHaveLength(2);
  for (const l of links) expect(l).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"/);
});

test('project page with docs keeps the plain "Documentation" label', async () => {
  const html = await renderProject('postgres-provisioner');
  expect(html).not.toContain('Documentation on GitHub');
  expect(html).toContain('Read the docs');
});

test('collection tool cards carry resource chips, the image and Details / GitHub actions', async () => {
  const html = await container.renderToString(CollectionPage, { props: { collection } });
  const pg = project('postgres-provisioner');
  expect(html).toContain('aria-label="Provisions"');
  for (const r of pg.resources ?? []) expect(html).toContain(`>${r}</li>`);
  expect(html).toContain('ghcr.io/datarocks-ag/postgres-provisioner</code>');
  expect(html).toContain('Details →');
  expect(html).toContain('href="/postgres-provisioner/"');
  expect(html).toContain('href="https://github.com/datarocks-ag/postgres-provisioner"');
});

test('collection page links the committed guides', async () => {
  const html = await container.renderToString(CollectionPage, { props: { collection } });
  expect(html).toContain('href="/provisioners/guides/compose-stack/"');
  expect(html).toContain('href="/provisioners/guides/"');
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

test('collection page states how its tools behave, from the collection data', async () => {
  const html = await container.renderToString(CollectionPage, { props: { collection } });
  expect(collection.principles.length).toBeGreaterThan(0);
  for (const p of collection.principles) {
    expect(html).toContain(p.title);
    expect(html).toContain(p.body);
  }
});

test('features render as cards with an icon each', async () => {
  const html = await renderProject('go-egress-mitm-proxy');
  const cards = [...html.matchAll(/<li class="feature-card"[\s\S]*?<\/li>/g)].map((m) => m[0]);
  expect(cards).toHaveLength(project('go-egress-mitm-proxy').features.length);
  for (const card of cards) expect(card).toMatch(/<svg[^>]*aria-hidden="true"/);
  expect(cards[0]).toContain('Split-brain DNS');
});

test('configuration is its own section with wrapped lines instead of a scrollbar', async () => {
  const html = await renderProject('keycloak-provisioner');
  const section = html.match(/<section[^>]*aria-labelledby="configuration"[\s\S]*?<\/section>/)![0];
  expect(section).toContain('>Configuration</h2>');
  expect(section).toMatch(/<pre[^>]*class="[^"]*wrap/);
  expect(section).toMatch(/<span class="line" style="--indent: 0ch"[^>]*>realms: \[\]<\/span>/);
  expect(await renderProject('nats-provisioner')).not.toContain('aria-labelledby="configuration"');
});
