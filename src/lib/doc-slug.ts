/**
 * The single owner of site slugs for synced docs. The sync writes the result as explicit `slug`
 * frontmatter and rewrites links with it, so link targets and Starlight routes cannot diverge
 * (Astro's default id would strip dots: `upgrading-to-2.0` becomes `upgrading-to-20`).
 */

/** Lowercases one path segment and turns every run of characters other than letters, digits, `_` and `-` into `-`. */
export function slugSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug of a docs page without the repo prefix, from its path relative to the docs folder
 * (`guide/Upgrading-to-2.0.md` gives `guide/upgrading-to-2-0`). `index` and `readme` files map to
 * their folder; the docs root is the empty string.
 */
export function docPageSlug(relativePath: string): string {
  const segments = relativePath
    .replace(/\.mdx?$/i, '')
    .split('/')
    .filter(Boolean);
  if (/^(index|readme)$/i.test(segments[segments.length - 1] ?? '')) segments.pop();
  return segments.map(slugSegment).filter(Boolean).join('/');
}

/** Full Starlight slug (content id) of a synced docs page, e.g. `postgres-provisioner/docs/guide/setup`. */
export function docSlug(repo: string, relativePath: string): string {
  const page = docPageSlug(relativePath);
  return page ? `${repo}/docs/${page}` : `${repo}/docs`;
}

/** Site URL of a synced docs page. */
export function docUrl(repo: string, relativePath: string): string {
  return `/${docSlug(repo, relativePath)}/`;
}
