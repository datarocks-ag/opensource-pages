import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Resolved from the project root (cwd), not import.meta.url: Astro bundles this module into dist/chunks.
const dir = join(process.cwd(), 'src/generated/examples');

/** Config excerpt written by `pnpm sync`; null when the project has none. */
export function getConfigExample(repo: string): string | null {
  const file = join(dir, `${repo}.txt`);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').trimEnd();
  return text === '' ? null : text;
}
