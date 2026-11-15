import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ProjectData } from '../src/lib/project-data.ts';
import { createGitHubClient, GitHubError, TruncatedTreeError } from '../scripts/sync/github.ts';
import { getRelease } from '../src/lib/releases.ts';
import { syncAll, syncProject } from '../scripts/sync/sync.ts';
import { fakeClient } from './fixtures/github/fake-client.ts';

const project = (repo: string, docsPath = 'docs'): ProjectData => ({
  repo, name: repo, order: 1, tagline: 't', highlights: [], features: [], docsPath, sections: [],
});
const pg = project('postgres-provisioner');
const kc = project('keycloak-provisioner');

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sync-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test('docs and changelog are written from the release tag', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', license: 'Apache-2.0', files: { 'docs/index.md': '# PG\n\n[c](../CHANGELOG.md)', 'docs/guide/a.mdx': 'A', 'docs/img.png': 'x' }, changelog: '# Changelog\n\nSee [license](LICENSE).' } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', tag: 'v2.0.0', license: 'Apache-2.0', docsAvailable: true, changelogAvailable: true, warnings: [] });
  expect(gh.calls.listFiles).toEqual([['postgres-provisioner', 'v2.0.0', 'docs']]);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8')).toMatch(/^---\ntitle: "PG"\neditUrl: .*\/edit\/main\/docs\/index\.md\n---\n\n\[c\]\(\/postgres-provisioner\/docs\/changelog\/\)/);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/guide/a.mdx'))).toBe(true);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/img.png'))).toBe(false);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/changelog.md'), 'utf8')).toMatch(/title: "Changelog"[\s\S]*\]\(https:\/\/github\.com\/datarocks-ag\/postgres-provisioner\/blob\/v2\.0\.0\/LICENSE\)/);
});

test('tag without docs folder → docsAvailable false, nothing written', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: {}, changelog: '# C' } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: false, changelogAvailable: false });
  expect(existsSync(join(tmp, 'postgres-provisioner/docs'))).toBe(false);
});

test('no release → version null and default branch never read', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: null } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: null, tag: null, docsAvailable: false, changelogAvailable: false });
  expect(gh.calls.readFile).toEqual([]);
  expect(gh.calls.listFiles).toEqual([]);
});

test('API failure for one repo does not stop the others', async () => {
  const out = { docsRoot: join(tmp, 'docs'), releasesFile: join(tmp, 'gen/releases.json') };
  const gh = fakeClient({ 'keycloak-provisioner': { errorStatus: 403 }, 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '# PG' } } });
  const results = await syncAll([kc, pg], gh, out);
  expect(results[0]).toMatchObject({ version: null, docsAvailable: false });
  expect(results[0].warnings[0]).toMatch(/403/);
  expect(results[1].version).toBe('v2.0.0');
  expect(JSON.parse(readFileSync(out.releasesFile, 'utf8'))).toHaveProperty('postgres-provisioner');
});

test('docs from a previous run are cleared before writing', async () => {
  const stale = join(tmp, 'postgres-provisioner/docs/old.md');
  mkdirSync(join(tmp, 'postgres-provisioner/docs'), { recursive: true });
  writeFileSync(stale, 'old');
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '# PG' } } });
  await syncProject(pg, gh, tmp);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/index.md'))).toBe(true);
});

test('custom docsPath is listed and made relative', async () => {
  const gh = fakeClient({ proxy: { release: 'v1.0.0', files: { 'doc/x/y.md': 'Y' } } });
  await syncProject(project('proxy', 'doc'), gh, tmp);
  expect(existsSync(join(tmp, 'proxy/docs/x/y.md'))).toBe(true);
});

test('github client maps 404 to null and sends the token', async () => {
  const seen: { url: string; auth: string | null }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    if (url.endsWith('/releases/latest')) return new Response('', { status: 404 });
    if (url.endsWith('/repos/o/r')) return Response.json({ license: { spdx_id: 'MIT' } });
    if (url.includes('/git/trees/')) return Response.json({ tree: [{ path: 'docs/a.md', type: 'blob' }, { path: 'docs', type: 'tree' }, { path: 'src/b.md', type: 'blob' }] });
    return new Response('', { status: 500 });
  }) as unknown as typeof fetch;
  const gh = createGitHubClient({ owner: 'o', token: 'tok', fetch: fetchStub });
  expect(await gh.latestRelease('r')).toBeNull();
  expect(await gh.license('r')).toBe('MIT');
  expect(await gh.listFiles('r', 'v1', 'docs')).toEqual(['docs/a.md']);
  expect(seen[0].auth).toBe('Bearer tok');
  await expect(gh.readFile('r', 'v1', 'x')).rejects.toBeInstanceOf(GitHubError);
});

test('failure after some files were written removes partial docs', async () => {
  const base = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } } });
  let reads = 0;
  const gh = { ...base, async readFile(repo: string, ref: string, path: string) {
    if (++reads > 1) throw new GitHubError(502, 'https://api.github.com/x');
    return base.readFile(repo, ref, path);
  } };
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: null, docsAvailable: false });
  expect(info.warnings[0]).toMatch(/502/);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs'))).toBe(false);
});

test('truncated git tree is an error, not a silent empty listing', async () => {
  const fetchStub = (async () => Response.json({ truncated: true, tree: [] })) as unknown as typeof fetch;
  const gh = createGitHubClient({ owner: 'o', fetch: fetchStub });
  const err = await gh.listFiles('r', 'v1', 'docs').catch((e) => e);
  expect(err).toBeInstanceOf(TruncatedTreeError);
  expect(err.repo).toBe('o/r');
  expect(err.message).toMatch(/truncated/);
});

test('getRelease returns an all-null entry for an unknown repo', () => {
  expect(getRelease('no-such-repo')).toEqual({
    repo: 'no-such-repo', version: null, tag: null, publishedAt: null, license: null,
    docsAvailable: false, changelogAvailable: false, warnings: [],
  });
});

test('cleanup failure becomes a second warning instead of escaping', async () => {
  const docs = join(tmp, 'postgres-provisioner/docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(docs, 'old.md'), 'old');
  chmodSync(docs, 0o500); // entries cannot be removed
  try {
    const info = await syncProject(pg, fakeClient({ 'postgres-provisioner': { release: 'v2.0.0' } }), tmp);
    expect(info.version).toBeNull();
    expect(info.warnings).toHaveLength(2);
    expect(info.warnings[0]).toMatch(/sync failed/);
    expect(info.warnings[1]).toMatch(/could not remove partial docs/);
  } finally {
    chmodSync(docs, 0o700);
  }
});

test('error cause message is rendered in the warning', async () => {
  const gh = { ...fakeClient({}), async latestRelease(): Promise<never> { throw new Error('boom', { cause: new Error('socket hang up') }); } };
  const info = await syncProject(pg, gh, tmp);
  expect(info.warnings[0]).toMatch(/boom \(cause: socket hang up\)/);
});

test('docs without index.md get the README as index, rewritten', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/a.md': '# A', 'README.md': '# PG\n\n[a](docs/a.md)\n[c](CHANGELOG.md)' }, changelog: '# Changelog' } });
  const info = await syncProject(pg, gh, tmp);
  const index = readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8');
  expect(index).toContain('title: "PG"');
  expect(index).toContain('](/postgres-provisioner/docs/a/)');
  expect(index).toContain('](/postgres-provisioner/docs/changelog/)');
  expect(info.warnings).toEqual([]);
});

test('docs without index.md and without README → warning, no index', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/a.md': '# A' } } });
  const info = await syncProject(pg, gh, tmp);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/index.md'))).toBe(false);
  expect(info.warnings.join()).toMatch(/README\.md/);
});
