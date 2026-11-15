import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { ProjectData } from '../src/lib/project-data.ts';
import { createGitHubClient, GitHubError } from '../scripts/sync/github.ts';
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
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', license: 'Apache-2.0', files: { 'docs/index.md': '# PG', 'docs/guide/a.mdx': 'A', 'docs/img.png': 'x' }, changelog: '# Changelog' } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', tag: 'v2.0.0', license: 'Apache-2.0', docsAvailable: true, changelogAvailable: true, warnings: [] });
  expect(gh.calls.listFiles).toEqual([['postgres-provisioner', 'v2.0.0', 'docs']]);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8')).toBe('# PG');
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/guide/a.mdx'))).toBe(true);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/img.png'))).toBe(false);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/changelog.md'), 'utf8')).toBe('# Changelog');
});

test('tag without docs folder → docsAvailable false, nothing written', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: {} } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: false, changelogAvailable: false });
  expect(existsSync(join(tmp, 'postgres-provisioner'))).toBe(false);
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
