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
    // Never leave partial docs behind: Astro would publish them while releases.json says unavailable.
    rmSync(join(docsRoot, p.repo, 'docs'), { recursive: true, force: true });
    let reason = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.cause !== undefined) reason += ` (cause: ${String(e.cause)})`;
    return emptyInfo(p.repo, [`${p.repo}: sync failed: ${reason}`]);
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

  const docsPrefix = `${p.docsPath.replace(/\/+$/, '')}/`;
  const files = (await gh.listFiles(p.repo, tag, p.docsPath)).filter((f) => /\.mdx?$/.test(f));
  let written = 0;
  for (const filePath of files) {
    const source = await gh.readFile(p.repo, tag, filePath);
    if (source === null) {
      warnings.push(`${p.repo}: ${filePath} listed but not readable at ${tag}`);
      continue;
    }
    const content = rewriteMarkdown(source, { repo: p.repo, tag, docsPath: p.docsPath, filePath });
    write(join(docsDir, posix.relative(docsPrefix, filePath)), content);
    written++;
  }
  if (written === 0) warnings.push(`${p.repo}: no docs found in ${p.docsPath}/ at ${tag}`);

  // The changelog page lives inside the docs folder, so it only exists when there are docs.
  let changelogAvailable = false;
  if (written > 0) {
    const changelog = await gh.readFile(p.repo, tag, 'CHANGELOG.md');
    if (changelog !== null) {
      write(join(docsDir, 'changelog.md'), changelog);
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
