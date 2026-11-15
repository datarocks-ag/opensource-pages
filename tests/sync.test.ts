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
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', license: 'Apache-2.0', files: { 'docs/index.md': '# PG\n\n[c](../CHANGELOG.md)', 'docs/guide/a.md': 'A', 'docs/img.png': 'x' }, changelog: '# Changelog\n\nSee [license](LICENSE).' } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', tag: 'v2.0.0', license: 'Apache-2.0', docsAvailable: true, changelogAvailable: true, warnings: [] });
  expect(gh.calls.listFiles).toEqual([['postgres-provisioner', 'v2.0.0', 'docs']]);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8')).toMatch(/^---\ntitle: "PG"\neditUrl: .*\/edit\/main\/docs\/index\.md\nslug: "postgres-provisioner\/docs"\n---\n\n\[c\]\(\/postgres-provisioner\/docs\/changelog\/\)/);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/guide/a.md'))).toBe(true);
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

test('failure while reading docs keeps the release and publishes no partial docs', async () => {
  const base = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/a.md': 'A', 'docs/b.md': 'B' } } });
  let reads = 0;
  const gh = { ...base, async readFile(repo: string, ref: string, path: string) {
    if (++reads > 1) throw new GitHubError(502, 'https://api.github.com/x');
    return base.readFile(repo, ref, path);
  } };
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: false });
  expect(info.warnings.join()).toMatch(/502/);
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

const withExample = (configExample: ProjectData['configExample']): ProjectData => ({ ...pg, configExample });
const exampleFile = () => join(tmp, 'examples/postgres-provisioner.txt');
const numbered = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');

test('configExample is fetched at the tag and written to the examples dir', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'config.example.yaml': numbered } } });
  await syncProject(withExample({ path: 'config.example.yaml', startLine: 3, endLine: 5 }), gh, join(tmp, 'docs'), join(tmp, 'examples'));
  expect(readFileSync(exampleFile(), 'utf8')).toBe('line3\nline4\nline5\n');
  expect(gh.calls.readFile).toContainEqual(['postgres-provisioner', 'v2.0.0', 'config.example.yaml']);
});

test('configExample without endLine is capped at 40 lines after startLine', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'c.yaml': numbered } } });
  await syncProject(withExample({ path: 'c.yaml', startLine: 11 }), gh, join(tmp, 'docs'), join(tmp, 'examples'));
  const lines = readFileSync(exampleFile(), 'utf8').trimEnd().split('\n');
  expect(lines).toHaveLength(40);
  expect(lines[0]).toBe('line11');
  expect(lines[39]).toBe('line50');
});

test('missing configExample file warns and clears a stale excerpt', async () => {
  mkdirSync(join(tmp, 'examples'), { recursive: true });
  writeFileSync(exampleFile(), 'stale');
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: {} } });
  const info = await syncProject(withExample({ path: 'nope.yaml' }), gh, join(tmp, 'docs'), join(tmp, 'examples'));
  expect(existsSync(exampleFile())).toBe(false);
  expect(info.warnings.join()).toMatch(/nope\.yaml/);
  expect(info.version).toBe('v2.0.0');
});

/** Wraps a fake client so readFile throws for one path. */
function failingRead(path: string, gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/a.md': '# A' }, changelog: '# C' } })) {
  const read = gh.readFile.bind(gh);
  gh.readFile = async (repo, ref, p) => {
    if (p === path) throw new GitHubError(403, `https://api.github.com/x/${p}`);
    return read(repo, ref, p);
  };
  return gh;
}

test('configExample transport error keeps release and docs, with a warning', async () => {
  const info = await syncProject(withExample({ path: 'c.yaml' }), failingRead('c.yaml'), join(tmp, 'docs'), join(tmp, 'examples'));
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: true, changelogAvailable: true });
  expect(info.warnings.join()).toMatch(/c\.yaml.*403/);
  expect(existsSync(exampleFile())).toBe(false);
  expect(existsSync(join(tmp, 'docs/postgres-provisioner/docs/a.md'))).toBe(true);
});

test('README fallback transport error keeps release and docs, with a warning', async () => {
  const info = await syncProject(pg, failingRead('README.md'), join(tmp, 'docs'));
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: true, changelogAvailable: true });
  expect(info.warnings.join()).toMatch(/README\.md.*403/);
  expect(existsSync(join(tmp, 'docs/postgres-provisioner/docs/changelog.md'))).toBe(true);
});

const keptRelease = { version: 'v2.0.0', tag: 'v2.0.0', publishedAt: '2026-01-01T00:00:00Z', license: 'Apache-2.0' };
const docsRepo = () => fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', license: 'Apache-2.0', files: { 'docs/a.md': '# A', 'docs/b.md': '# B' }, changelog: '# C' } });
const docsDir = () => join(tmp, 'docs/postgres-provisioner/docs');

test('license transport error keeps release and docs, with a warning', async () => {
  const gh = docsRepo();
  gh.license = async () => { throw new GitHubError(503, 'https://api.github.com/repos/x'); };
  const info = await syncProject(pg, gh, join(tmp, 'docs'));
  expect(info).toMatchObject({ version: 'v2.0.0', tag: 'v2.0.0', license: null, docsAvailable: true, changelogAvailable: true });
  expect(info.warnings.join()).toMatch(/license.*503/);
});

test('license transport error with no release still reports no release', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: null } });
  gh.license = async () => { throw new GitHubError(503, 'https://api.github.com/repos/x'); };
  const info = await syncProject(pg, gh, join(tmp, 'docs'));
  expect(info).toMatchObject({ version: null, license: null });
  expect(info.warnings.join()).toMatch(/no release[\s\S]*503|503[\s\S]*no release/);
});

test('tree listing transport error keeps release data and drops docs', async () => {
  const gh = docsRepo();
  gh.listFiles = async () => { throw new GitHubError(502, 'https://api.github.com/trees'); };
  const info = await syncProject(pg, gh, join(tmp, 'docs'));
  expect(info).toMatchObject({ ...keptRelease, docsAvailable: false, changelogAvailable: false });
  expect(info.warnings.join()).toMatch(/docs.*502/);
  expect(existsSync(docsDir())).toBe(false);
});

test('truncated tree keeps release data and drops docs', async () => {
  const gh = docsRepo();
  gh.listFiles = async () => { throw new TruncatedTreeError('postgres-provisioner', 'v2.0.0'); };
  const info = await syncProject(pg, gh, join(tmp, 'docs'));
  expect(info).toMatchObject({ ...keptRelease, docsAvailable: false, changelogAvailable: false });
  expect(info.warnings.join()).toMatch(/truncated/i);
});

test('CHANGELOG.md read error keeps docs and release, without a changelog page', async () => {
  const info = await syncProject(pg, failingRead('CHANGELOG.md', docsRepo()), join(tmp, 'docs'));
  expect(info).toMatchObject({ ...keptRelease, docsAvailable: true, changelogAvailable: false });
  expect(info.warnings.join()).toMatch(/CHANGELOG\.md.*403/);
  expect(existsSync(join(docsDir(), 'changelog.md'))).toBe(false);
  expect(existsSync(join(docsDir(), 'a.md'))).toBe(true);
});

test('docs page read error keeps release data and removes the partial docs', async () => {
  const info = await syncProject(pg, failingRead('docs/b.md', docsRepo()), join(tmp, 'docs'));
  expect(info).toMatchObject({ ...keptRelease, docsAvailable: false, changelogAvailable: false });
  expect(info.warnings.join()).toMatch(/403.*docs\/b\.md/);
  expect(existsSync(docsDir())).toBe(false);
});

test('local write errors are not reported as fetch failures', async () => {
  writeFileSync(join(tmp, 'docs'), 'a file where the docs root should be');
  const info = await syncProject(pg, docsRepo(), join(tmp, 'docs'));
  expect(info.version).toBeNull();
  expect(info.warnings.join()).toMatch(/sync failed/);
  expect(info.warnings.join()).not.toMatch(/could not be fetched/);
});

test('.mdx files are skipped with a warning', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '# PG', 'docs/x.mdx': 'import X from "x"\n\n<X />' } } });
  const info = await syncProject(pg, gh, tmp);
  expect(info.docsAvailable).toBe(true);
  expect(info.warnings.join()).toMatch(/docs\/x\.mdx skipped/);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/x.mdx'))).toBe(false);
  expect(gh.calls.readFile.map((c) => c[2])).not.toContain('docs/x.mdx');
});

test('a file with unparseable frontmatter is skipped with a warning; the rest is published', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '# PG', 'docs/bad.md': '---\ntitle: "open\n---\nBody' } } });
  const info = await syncProject(pg, gh, tmp);
  expect(info).toMatchObject({ version: 'v2.0.0', docsAvailable: true });
  expect(info.warnings.join()).toMatch(/docs\/bad\.md skipped, unusable frontmatter/);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/bad.md'))).toBe(false);
  expect(existsSync(join(tmp, 'postgres-provisioner/docs/index.md'))).toBe(true);
});

test('duplicate frontmatter keys become a warning naming repo and file, and the page is still written', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '---\ntitle: A\ntitle: B\n---\nBody' } } });
  const info = await syncProject(pg, gh, tmp);
  expect(info.warnings).toContain('postgres-provisioner: docs/index.md: duplicate frontmatter key "title" ignored, first occurrence kept');
  const out = readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8');
  expect(out.match(/^title:/gm)).toHaveLength(1);
});

test('repo frontmatter is reduced to title, description and sidebar on disk', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '---\ntitle: T\nsidebar: 3\ntemplate: splash\n---\nBody' } } });
  await syncProject(pg, gh, tmp);
  const out = readFileSync(join(tmp, 'postgres-provisioner/docs/index.md'), 'utf8');
  expect(out).not.toMatch(/sidebar|template/);
  expect(out).toContain('title: "T"');
});

test('dotted file names are written under their original name with an explicit slug', async () => {
  const gh = fakeClient({ 'postgres-provisioner': { release: 'v2.0.0', files: { 'docs/index.md': '# PG', 'docs/upgrading-to-2.0.md': '# Up' } } });
  await syncProject(pg, gh, tmp);
  expect(readFileSync(join(tmp, 'postgres-provisioner/docs/upgrading-to-2.0.md'), 'utf8')).toContain('slug: "postgres-provisioner/docs/upgrading-to-2-0"');
});
