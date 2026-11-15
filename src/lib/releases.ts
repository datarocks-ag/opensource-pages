import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleaseInfo } from '../../scripts/sync/sync.ts';

export type { ReleaseInfo };

// Resolved from the project root (cwd), not import.meta.url: Astro bundles this module into dist/chunks.
const file = join(process.cwd(), 'src/generated/releases.json');

/** Release info written by `pnpm sync`; an all-null entry when the file or repo is missing. */
export function getRelease(repo: string): ReleaseInfo {
  const empty: ReleaseInfo = {
    repo, version: null, tag: null, publishedAt: null, license: null,
    docsAvailable: false, changelogAvailable: false, warnings: [],
  };
  if (!existsSync(file)) return empty;
  const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ReleaseInfo>;
  return all[repo] ?? empty;
}
