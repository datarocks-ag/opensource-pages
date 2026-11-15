import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadProjects } from '../src/lib/project-data.ts';
import { syncAll, type ReleaseInfo } from '../scripts/sync/sync.ts';
import { fakeClient, type FakeRepo } from './fixtures/github/fake-client.ts';

/*
 * The build runs in an isolated copy of the project, in a child process with that copy as cwd.
 * src/lib/*.ts resolve their data from process.cwd() and the sync output is gitignored real
 * developer data, so copying avoids snapshot/restore (which would lose data if the run is killed).
 * The copy lives inside the repo (gitignored) so node_modules resolves by walking up; a symlinked
 * node_modules or a copy under /tmp makes Astro lose track of Starlight's component paths.
 */
const repoRoot = process.cwd();
const projects = loadProjects();
const repos = projects.map((p) => p.repo);

const WITHOUT_DOCS = 'keycloak-provisioner';
const FAILING = 'nats-provisioner';
const PROXY = 'go-egress-mitm-proxy'; // standalone: no collection, docsPath "doc"
const WITH_DOCS = repos.filter((r) => r !== WITHOUT_DOCS && r !== FAILING);

const fixture = (repo: string): FakeRepo => {
  const dir = repo === PROXY ? 'doc' : 'docs';
  return {
    release: 'v1.2.3',
    license: 'Apache-2.0',
    changelog: `# Changelog\n\n## 1.2.3\n\n- Fix ${repo}\n`,
    files: {
      [`${dir}/index.md`]: `# ${repo} docs\n\nSee the [guide](guide/setup.md).\n`,
      [`${dir}/guide/setup.md`]: [
        '# Setup',
        '',
        '[readme](../../README.md) · [source](../../src/main.go) · [changelog](../../CHANGELOG.md) · [home](https://example.com/x)',
        '',
      ].join('\n'),
      // No heading and no frontmatter: the title must come from the file name.
      [`${dir}/untitled-page.md`]: 'Just a paragraph without any heading.\n',
    },
  };
};

let tmp: string;
let dist: string;
let releases: ReleaseInfo[];
let buildOutput: string;
let buildStatus: number | null;

const MIRRORED = ['astro.config.mjs', 'package.json', 'tsconfig.json', 'public', 'scripts'];

beforeAll(async () => {
  tmp = mkdtempSync(join(repoRoot, '.build-test-'));
  dist = join(tmp, 'dist');
  for (const f of MIRRORED) cpSync(join(repoRoot, f), join(tmp, f), { recursive: true });
  const generated = join(repoRoot, 'src/generated');
  const syncedDocs = /src\/content\/docs\/[^/]+\/docs(\/|$)/;
  cpSync(join(repoRoot, 'src'), join(tmp, 'src'), {
    recursive: true,
    filter: (src) => src !== generated && !src.startsWith(`${generated}${sep}`) && !syncedDocs.test(src.split(sep).join('/')),
  });

  const gh = fakeClient({
    ...Object.fromEntries(WITH_DOCS.map((r) => [r, fixture(r)])),
    [WITHOUT_DOCS]: { release: 'v1.13.0', license: 'MIT', files: {}, changelog: '# Changelog' },
    [FAILING]: { errorStatus: 500 },
  });
  releases = await syncAll(projects, gh, {
    docsRoot: join(tmp, 'src/content/docs'),
    examplesRoot: join(tmp, 'src/generated/examples'),
    releasesFile: join(tmp, 'src/generated/releases.json'),
  });

  writeFileSync(
    join(tmp, 'run-build.mjs'),
    `import { build } from 'astro';\nawait build({ root: process.cwd(), outDir: ${JSON.stringify(dist)}, logLevel: 'warn' });\n`,
  );
  const run = spawnSync(process.execPath, ['run-build.mjs'], { cwd: tmp, encoding: 'utf8' });
  buildStatus = run.status;
  buildOutput = `${run.stdout}\n${run.stderr}`;
}, 300_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const page = (route: string) => join(dist, route, 'index.html');
const html = (route: string) => readFileSync(page(route), 'utf8');
const visibleText = (h: string) =>
  h.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, ' ');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('build succeeds', () => {
  expect(buildOutput).not.toMatch(/\[ERROR\]|error:/i);
  expect(buildStatus).toBe(0);
});

describe('pages', () => {
  test('landing, collection and every project page exist', () => {
    const routes = ['/', '/provisioners', ...repos.map((r) => `/${r}`)];
    expect(routes).toHaveLength(9);
    for (const r of routes) expect(existsSync(page(r)), r).toBe(true);
  });

  test('docs exist exactly for repos with docs', () => {
    for (const r of WITH_DOCS) {
      expect(existsSync(page(`/${r}/docs`)), `${r} docs index`).toBe(true);
      expect(existsSync(page(`/${r}/docs/guide/setup`)), `${r} nested doc`).toBe(true);
      expect(existsSync(page(`/${r}/docs/changelog`)), `${r} changelog`).toBe(true);
    }
    for (const r of [WITHOUT_DOCS, FAILING]) expect(existsSync(join(dist, r, 'docs')), r).toBe(false);
  });

  test('docs titles come from heading, then file name', () => {
    expect(html('/postgres-provisioner/docs/guide/setup')).toContain('<title>Setup');
    expect(html('/postgres-provisioner/docs/untitled-page')).toMatch(/<title>Untitled[ -]page/i);
  });

  test('standalone proxy has its own page, reads docs from "doc/", and is not in the collection', () => {
    expect(existsSync(page(`/${PROXY}/docs/guide/setup`))).toBe(true);
    expect(html('/provisioners')).not.toContain(`href="/${PROXY}/"`);
    expect(html('/')).toContain(`href="/${PROXY}/"`);
  });
});

describe('repo without docs at its tag', () => {
  test('project page links the README at the tag and not the docs', () => {
    const h = html(`/${WITHOUT_DOCS}`);
    expect(h).toContain(`href="https://github.com/datarocks-ag/${WITHOUT_DOCS}/blob/v1.13.0/README.md"`);
    expect(h).toContain('v1.13.0');
  });

  test('no page links into its docs', () => {
    for (const f of walk(dist).filter((p) => p.endsWith('.html'))) {
      expect(readFileSync(f, 'utf8'), relative(dist, f)).not.toContain(`href="/${WITHOUT_DOCS}/docs/`);
    }
  });
});

describe('repo whose GitHub API call failed', () => {
  test('sync recorded a warning and no release', () => {
    const r = releases.find((x) => x.repo === FAILING)!;
    expect(r).toMatchObject({ version: null, docsAvailable: false });
    expect(r.warnings.join()).toMatch(/500/);
  });

  test('its page renders without null/undefined text and without docs links', () => {
    const h = html(`/${FAILING}`);
    expect(visibleText(h)).not.toMatch(/\b(null|undefined)\b/);
    expect(h).not.toContain(`href="/${FAILING}/docs/`);
    expect(h).toContain(`https://github.com/datarocks-ag/${FAILING}/blob/main/README.md`);
  });

  test('other repos are intact', () => {
    expect(html('/postgres-provisioner')).toContain('v1.2.3');
    for (const route of ['/', '/provisioners', ...repos.map((r) => `/${r}`)]) {
      expect(visibleText(html(route)), route).not.toMatch(/\b(null|undefined)\b/);
    }
  });
});

describe('links', () => {
  test('links leaving the docs point to GitHub at the release tag', () => {
    const h = html('/postgres-provisioner/docs/guide/setup');
    expect(h).toContain('href="https://github.com/datarocks-ag/postgres-provisioner/blob/v1.2.3/README.md"');
    expect(h).toContain('href="https://github.com/datarocks-ag/postgres-provisioner/blob/v1.2.3/src/main.go"');
    expect(h).toContain('href="/postgres-provisioner/docs/changelog/"');
    expect(h).toContain('href="https://example.com/x"');
  });

  test('every internal href resolves to a file in dist', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of walk(dist).filter((p) => p.endsWith('.html'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\shref="(\/[^"]*)"/g)) {
        const target = m[1].split(/[?#]/)[0];
        if (target.startsWith('//')) continue;
        checked++;
        const rel = decodeURIComponent(target);
        const candidates = rel.endsWith('/') ? [join(dist, rel, 'index.html')] : [join(dist, rel), join(dist, rel, 'index.html')];
        if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) missing.push(`${relative(dist, f)} -> ${m[1]}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

test('real project data is untouched by the test', () => {
  expect(existsSync(join(tmp, 'src/generated/releases.json'))).toBe(true);
  expect(readFileSync(join(repoRoot, 'src/generated/releases.json'), 'utf8')).not.toContain('v1.2.3');
});
