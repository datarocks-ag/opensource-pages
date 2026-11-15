/**
 * Replaces `{{version:<repo>}}` with the semver of the repo's latest release (no leading `v`),
 * or with `latest` when `version` returns null.
 */
export function renderVersionPlaceholders(code: string, version: (repo: string) => string | null): string {
  return code.replace(/\{\{version:([^}\s]+)\}\}/g, (_, repo: string) => version(repo)?.replace(/^v/, '') ?? 'latest');
}
