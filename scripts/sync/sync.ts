import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { ProjectData } from '../../src/lib/project-data.ts';
import type { GitHubClient } from './github.ts';
import { rewriteMarkdown } from './rewrite.ts';

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
 * writes docs under `<docsRoot>/<repo>/docs`. Any failure becomes a warning on an all-null result.
 */
export async function syncProject(p: ProjectData, gh: GitHubClient, docsRoot: string): Promise<ReleaseInfo> {
  try {
    return await sync(p, gh, docsRoot);
  } catch (e) {
    let reason = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.cause !== undefined) {
      const c = e.cause;
      reason += ` (cause: ${c instanceof Error ? c.message : String(c)})`;
    }
    const warnings = [`${p.repo}: sync failed: ${reason}`];
    // Never leave partial docs behind: Astro would publish them while releases.json says unavailable.
    try {
      rmSync(join(docsRoot, p.repo, 'docs'), { recursive: true, force: true });
    } catch (cleanup) {
      warnings.push(`${p.repo}: could not remove partial docs: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);
    }
    return emptyInfo(p.repo, warnings);
  }
}

async function sync(p: ProjectData, gh: GitHubClient, docsRoot: string): Promise<ReleaseInfo> {
  const docsDir = join(docsRoot, p.repo, 'docs');
  rmSync(docsDir, { recursive: true, force: true });

  const release = await gh.latestRelease(p.repo);
  const license = await gh.license(p.repo);
  if (!release) {
    return { ...emptyInfo(p.repo, [`${p.repo}: no release found`]), license };
  }
  const { tag } = release;
  const warnings: string[] = [];

  // The changelog page lives inside the docs folder, so it only exists when there are docs.
  const docsPrefix = `${p.docsPath.replace(/\/+$/, '')}/`;
  const files = (await gh.listFiles(p.repo, tag, p.docsPath)).filter((f) => /\.mdx?$/.test(f));
  const changelog = files.length > 0 ? await gh.readFile(p.repo, tag, 'CHANGELOG.md') : null;
  const base = { repo: p.repo, tag, docsPath: p.docsPath, changelogOnSite: changelog !== null };

  let written = 0;
  for (const filePath of files) {
    const source = await gh.readFile(p.repo, tag, filePath);
    if (source === null) {
      warnings.push(`${p.repo}: ${filePath} listed but not readable at ${tag}`);
      continue;
    }
    write(join(docsDir, posix.relative(docsPrefix, filePath)), rewriteMarkdown(source, { ...base, filePath }));
    written++;
  }
  if (written === 0) warnings.push(`${p.repo}: no docs found in ${p.docsPath}/ at ${tag}`);

  // Without a docs landing page the README stands in, so /<repo>/docs/ is never empty.
  if (written > 0 && !files.some((f) => /^index\.mdx?$/i.test(posix.relative(docsPrefix, f)))) {
    const readme = await gh.readFile(p.repo, tag, 'README.md');
    if (readme === null) warnings.push(`${p.repo}: docs have no index.md and no README.md at ${tag}`);
    else write(join(docsDir, 'index.md'), rewriteMarkdown(readme, { ...base, filePath: 'README.md' }));
  }

  let changelogAvailable = false;
  if (written > 0) {
    if (changelog !== null) {
      write(join(docsDir, 'changelog.md'), rewriteMarkdown(changelog, { ...base, filePath: 'CHANGELOG.md' }));
      changelogAvailable = true;
    } else warnings.push(`${p.repo}: no CHANGELOG.md at ${tag}`);
  }

  return {
    repo: p.repo,
    version: tag,
    tag,
    publishedAt: release.publishedAt,
    license,
    docsAvailable: written > 0,
    changelogAvailable,
    warnings,
  };
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Syncs all projects sequentially and writes `releasesFile` as a JSON object keyed by repo. */
export async function syncAll(
  ps: ProjectData[],
  gh: GitHubClient,
  out: { docsRoot: string; releasesFile: string },
): Promise<ReleaseInfo[]> {
  const results: ReleaseInfo[] = [];
  for (const p of ps) results.push(await syncProject(p, gh, out.docsRoot));
  mkdirSync(dirname(out.releasesFile), { recursive: true });
  const byRepo = Object.fromEntries(results.map((r) => [r.repo, r]));
  writeFileSync(out.releasesFile, `${JSON.stringify(byRepo, null, 2)}\n`);
  return results;
}
