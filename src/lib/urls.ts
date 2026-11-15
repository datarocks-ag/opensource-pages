const ORG = 'datarocks-ag';

/** Site path of a project landing page. */
export function projectUrl(repo: string): string {
  return `/${repo}/`;
}

/** Site path of a project's documentation root. */
export function docsUrl(repo: string): string {
  return `/${repo}/docs/`;
}

/** Site path of a collection page. */
export function collectionUrl(slug: string): string {
  return `/${slug}/`;
}

/** GitHub URL of a repo, or of a file in it at `ref` (default branch name `main` when omitted). */
export function githubUrl(repo: string, path?: string, ref?: string): string {
  const base = `https://github.com/${ORG}/${repo}`;
  if (!path) return base;
  return `${base}/blob/${ref ?? 'main'}/${path}`;
}

/** Container image reference; strips a leading `v` and uses `latest` without a version. */
export function imageRef(repo: string, version: string | null): string {
  const tag = version ? version.replace(/^v/, '') : 'latest';
  return `ghcr.io/${ORG}/${repo}:${tag}`;
}
