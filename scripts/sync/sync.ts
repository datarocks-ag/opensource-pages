import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { ProjectData } from '../../src/lib/project-data.ts';
import type { GitHubClient } from './github.ts';
import { docSlug } from '../../src/lib/doc-slug.ts';
import { FrontmatterError, rewriteMarkdown } from './rewrite.ts';

/** What the site knows about a repo's latest release. Written to `releases.json`. */
export interface ReleaseInfo {
  repo: string;
  version: string | null;
  tag: string | null;
  publishedAt: string | null;
  license: string | null;
  docsAvailable: boolean;
  changelogAvailable: boolean;
  warnings: string[];
}

function emptyInfo(repo: string, warnings: string[] = []): ReleaseInfo {
  return { repo, version: null, tag: null, publishedAt: null, license: null, docsAvailable: false, changelogAvailable: false, warnings };
}

/**
 * Fetches release, license, docs and changelog of one project at its latest release tag and
 * writes docs under `<docsRoot>/<repo>/docs`. A failed release fetch becomes a warning on an all-null result;
 * a failed license, docs, changelog or example fetch only drops that part and keeps the release.
 */
export async function syncProject(
  p: ProjectData,
  gh: GitHubClient,
  docsRoot: string,
  examplesRoot?: string,
): Promise<ReleaseInfo> {
  try {
    return await sync(p, gh, docsRoot, examplesRoot);
  } catch (e) {
    const warnings = [`${p.repo}: sync failed: ${describeError(e)}`];
    // Never leave partial docs behind: Astro would publish them while releases.json says unavailable.
    try {
      rmSync(join(docsRoot, p.repo, 'docs'), { recursive: true, force: true });
      if (examplesRoot) rmSync(exampleFile(examplesRoot, p.repo), { force: true });
    } catch (cleanup) {
      warnings.push(`${p.repo}: could not remove partial docs: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
    }
    return emptyInfo(p.repo, warnings);
  }
}

async function sync(p: ProjectData, gh: GitHubClient, docsRoot: string, examplesRoot?: string): Promise<ReleaseInfo> {
  const docsDir = join(docsRoot, p.repo, 'docs');
  rmSync(docsDir, { recursive: true, force: true });
  if (examplesRoot) rmSync(exampleFile(examplesRoot, p.repo), { force: true });

  // Release data is primary: a failure here fails the project. Everything fetched afterwards is optional.
  const release = await gh.latestRelease(p.repo);
  const warnings: string[] = [];
  const license = await optionalLicense(p, gh, warnings);
  if (!release) {
    return { ...emptyInfo(p.repo, [`${p.repo}: no release found`, ...warnings]), license };
  }
  const { tag } = release;

  const docs = await syncDocs(p, gh, tag, docsDir, warnings);
  if (examplesRoot) await syncConfigExample(p, gh, tag, examplesRoot, warnings);

  return {
    repo: p.repo,
    version: tag,
    tag,
    publishedAt: release.publishedAt,
    license,
    docsAvailable: docs.written > 0,
    changelogAvailable: docs.changelogAvailable,
    warnings,
  };
}

async function optionalLicense(p: ProjectData, gh: GitHubClient, warnings: string[]): Promise<string | null> {
  try {
    return await gh.license(p.repo);
  } catch (e) {
    warnings.push(`${p.repo}: license could not be fetched: ${describeError(e)}`);
    return null;
  }
}

interface FetchedDocs {
  pages: { path: string; source: string }[];
  changelog: string | null;
}

/** Fetches every docs page and the changelog. Throws on any transport error; nothing is written here. */
async function fetchDocs(p: ProjectData, gh: GitHubClient, tag: string, warnings: string[]): Promise<FetchedDocs> {
  const listed = await gh.listFiles(p.repo, tag, p.docsPath);
  for (const f of listed.filter((f) => /\.mdx$/.test(f))) {
    warnings.push(`${p.repo}: ${f} skipped, .mdx is not supported in synced docs`);
  }
  const files = listed.filter((f) => /\.md$/.test(f));

  // The changelog page lives inside the docs folder, so it is only read when there are docs.
  let changelog: string | null = null;
  if (files.length > 0) {
    try {
      changelog = await gh.readFile(p.repo, tag, 'CHANGELOG.md');
    } catch (e) {
      warnings.push(`${p.repo}: CHANGELOG.md could not be fetched, treating it as absent: ${describeError(e)}`);
    }
  }

  const pages: FetchedDocs['pages'] = [];
  for (const path of files) {
    const source = await gh.readFile(p.repo, tag, path);
    if (source === null) warnings.push(`${p.repo}: ${path} listed but not readable at ${tag}`);
    else pages.push({ path, source });
  }
  return { pages, changelog };
}

/**
 * Writes the docs folder. A fetch failure removes the folder, records a warning and reports no
 * docs, so the release data stays. Local write errors are not caught here: they are site-side bugs.
 */
async function syncDocs(
  p: ProjectData,
  gh: GitHubClient,
  tag: string,
  docsDir: string,
  warnings: string[],
): Promise<{ written: number; changelogAvailable: boolean }> {
  let fetched: FetchedDocs;
  try {
    fetched = await fetchDocs(p, gh, tag, warnings);
  } catch (e) {
    rmSync(docsDir, { recursive: true, force: true });
    warnings.push(`${p.repo}: docs could not be fetched at ${tag}, docs unavailable: ${describeError(e)}`);
    return { written: 0, changelogAvailable: false };
  }

  const docsPrefix = `${p.docsPath.replace(/\/+$/, '')}/`;
  const base = { repo: p.repo, tag, docsPath: p.docsPath, changelogOnSite: fetched.changelog !== null };
  const slugs = new Set<string>();
  const publish = (filePath: string, source: string, relative: string): boolean => {
    const slug = docSlug(p.repo, relative);
    if (slugs.has(slug)) {
      warnings.push(`${p.repo}: ${filePath} skipped, its page address ${slug} is already taken`);
      return false;
    }
    let content: string;
    try {
      content = rewriteMarkdown(source, { ...base, filePath, slug, warn: (m) => warnings.push(`${p.repo}: ${filePath}: ${m}`) });
    } catch (e) {
      if (!(e instanceof FrontmatterError)) throw e;
      warnings.push(`${p.repo}: ${filePath} skipped, ${e.message}`);
      return false;
    }
    slugs.add(slug);
    write(join(docsDir, relative), content);
    return true;
  };

  let written = 0;
  for (const { path, source } of fetched.pages) {
    const relative = posix.relative(docsPrefix, path);
    if (publish(path, source, relative)) written++;
  }
  if (written === 0) {
    warnings.push(`${p.repo}: no docs found in ${p.docsPath}/ at ${tag}`);
    return { written, changelogAvailable: false };
  }

  // Without a docs landing page the README stands in, so /<repo>/docs/ is never empty.
  if (!slugs.has(docSlug(p.repo, 'index'))) await readmeIndex(p, gh, tag, publish, warnings);

  let changelogAvailable = false;
  if (fetched.changelog !== null) changelogAvailable = publish('CHANGELOG.md', fetched.changelog, 'changelog.md');
  else warnings.push(`${p.repo}: no CHANGELOG.md at ${tag}`);
  return { written, changelogAvailable };
}

async function readmeIndex(
  p: ProjectData,
  gh: GitHubClient,
  tag: string,
  publish: (filePath: string, source: string, relative: string) => boolean,
  warnings: string[],
): Promise<void> {
  let readme: string | null;
  try {
    readme = await gh.readFile(p.repo, tag, 'README.md');
  } catch (e) {
    warnings.push(`${p.repo}: README.md fallback for docs index failed: ${describeError(e)}`);
    return;
  }
  if (readme === null) warnings.push(`${p.repo}: docs have no index.md and no README.md at ${tag}`);
  else publish('README.md', readme, 'index.md');
}

async function syncConfigExample(
  p: ProjectData,
  gh: GitHubClient,
  tag: string,
  examplesRoot: string,
  warnings: string[],
): Promise<void> {
  if (!p.configExample) return;
  // The excerpt is optional: a failed fetch only omits it.
  let source: string | null;
  try {
    source = await gh.readFile(p.repo, tag, p.configExample.path);
  } catch (e) {
    warnings.push(`${p.repo}: configExample ${p.configExample.path} could not be fetched: ${describeError(e)}`);
    return;
  }
  if (source === null) warnings.push(`${p.repo}: configExample ${p.configExample.path} not found at ${tag}`);
  else write(exampleFile(examplesRoot, p.repo), `${excerpt(source, p.configExample)}\n`);
}

function describeError(e: unknown): string {
  let reason = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.cause !== undefined) {
    const c = e.cause;
    reason += ` (cause: ${c instanceof Error ? c.message : String(c)})`;
  }
  return reason;
}

const MAX_EXCERPT_LINES = 40;

function exampleFile(examplesRoot: string, repo: string): string {
  return join(examplesRoot, `${repo}.txt`);
}

/** Lines `startLine`..`endLine` (1-based, inclusive); without `endLine` at most 40 lines from `startLine`. */
function excerpt(source: string, range: { startLine?: number; endLine?: number }): string {
  const lines = source.replace(/\n$/, '').split('\n');
  const start = Math.max(1, range.startLine ?? 1);
  const end = range.endLine ?? start + MAX_EXCERPT_LINES - 1;
  return lines.slice(start - 1, end).join('\n');
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Syncs all projects sequentially and writes `releasesFile` as a JSON object keyed by repo. */
export async function syncAll(
  ps: ProjectData[],
  gh: GitHubClient,
  out: { docsRoot: string; releasesFile: string; examplesRoot?: string },
): Promise<ReleaseInfo[]> {
  const results: ReleaseInfo[] = [];
  for (const p of ps) results.push(await syncProject(p, gh, out.docsRoot, out.examplesRoot));
  mkdirSync(dirname(out.releasesFile), { recursive: true });
  const byRepo = Object.fromEntries(results.map((r) => [r.repo, r]));
  writeFileSync(out.releasesFile, `${JSON.stringify(byRepo, null, 2)}\n`);
  return results;
}
