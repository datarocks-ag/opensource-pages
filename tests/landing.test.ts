import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, expect, test, vi } from 'vitest';

vi.mock('../src/lib/releases', () => ({
  getRelease: (repo: string) => ({
    repo,
    version: repo === 'nats-provisioner' ? null : 'v9.8.7',
    tag: null,
    publishedAt: null,
    license: null,
    docsAvailable: false,
    changelogAvailable: false,
    warnings: [],
  }),
}));

import Landing from '../src/pages/index.astro';
import { loadProjects } from '../src/lib/project-data';

let html: string;
let collectionCard: string;
beforeAll(async () => {
  const container = await AstroContainer.create();
  html = await container.renderToString(Landing);
  collectionCard = html.match(/<article[^>]*data-collection="provisioners"[\s\S]*?<\/article>/)![0];
});

test('facts strip counts projects from data', () => {
  expect(html).toContain(`${loadProjects().length} projects`);
  expect(html).toContain('MIT licensed');
});

test('provisioners card lists six tools with release versions', () => {
  const repos = loadProjects().filter((p) => p.collection === 'provisioners').map((p) => p.repo);
  expect(repos).toHaveLength(6);
  for (const repo of repos) expect(collectionCard).toContain(`href="/${repo}/"`);
  expect(collectionCard).toContain('v9.8.7');
});

test('a tool without a release shows no version text', () => {
  expect(html).not.toContain('null');
  const nats = collectionCard.match(/<a[^>]*href="\/nats-provisioner\/"[\s\S]*?<\/a>/)![0];
  expect(nats).not.toMatch(/v\d/);
});

test('proxy appears as a standalone project card, not in the collection', () => {
  expect(collectionCard).not.toContain('/go-egress-mitm-proxy/');
  expect(html).toContain('href="/go-egress-mitm-proxy/"');
  expect(html).toContain('403 blocked');
});

test('projects and principles sections carry the header anchor ids', () => {
  expect(html).toMatch(/<section[^>]*id="projects"/);
  expect(html).toMatch(/<section[^>]*id="principles"/);
});

test('company CTA links to datarocks.ch', () => {
  expect(html).toContain('Visit datarocks.ch');
  expect(html).toContain('href="https://datarocks.ch"');
});

test('How we build only makes claims that hold for every project, not provisioner behaviour', () => {
  const section = html.match(/<section[^>]*id="principles"[\s\S]*?<\/section>/)![0];
  expect(section).not.toMatch(/provisioner/i);
  expect(section).not.toContain('YAML');
});
