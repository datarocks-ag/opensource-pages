import { GitHubError, type GitHubClient } from '../../../scripts/sync/github.ts';

export interface FakeRepo {
  /** Latest release tag; null or omitted means no release. */
  release?: string | null;
  /** Repo-relative path to file content, at the release tag. */
  files?: Record<string, string>;
  changelog?: string | null;
  license?: string | null;
  /** Every call for this repo throws a GitHubError with this status. */
  errorStatus?: number;
}

export interface FakeCalls {
  latestRelease: [string][];
  license: [string][];
  listFiles: [string, string, string][];
  readFile: [string, string, string][];
}

export type FakeClient = GitHubClient & { calls: FakeCalls };

/** In-memory GitHubClient. `repos` maps repo name to its behaviour; `defaults` applies to unlisted repos. */
export function fakeClient(repos: Record<string, FakeRepo> | FakeRepo = {}, defaults: FakeRepo = {}): FakeClient {
  const lookup = (repo: string): FakeRepo => {
    const isSingle = 'release' in repos || 'files' in repos || 'changelog' in repos || 'errorStatus' in repos || 'license' in repos;
    return isSingle ? (repos as FakeRepo) : ((repos as Record<string, FakeRepo>)[repo] ?? defaults);
  };
  const check = (repo: string): FakeRepo => {
    const r = lookup(repo);
    if (r.errorStatus) throw new GitHubError(r.errorStatus, `https://api.github.com/repos/fake/${repo}`);
    return r;
  };
  const calls: FakeCalls = { latestRelease: [], license: [], listFiles: [], readFile: [] };
  return {
    calls,
    async latestRelease(repo) {
      calls.latestRelease.push([repo]);
      const r = check(repo);
      return r.release ? { tag: r.release, publishedAt: '2026-01-01T00:00:00Z' } : null;
    },
    async license(repo) {
      calls.license.push([repo]);
      return check(repo).license ?? null;
    },
    async listFiles(repo, ref, dir) {
      calls.listFiles.push([repo, ref, dir]);
      const r = check(repo);
      return Object.keys(r.files ?? {}).filter((p) => p.startsWith(`${dir}/`));
    },
    async readFile(repo, ref, path) {
      calls.readFile.push([repo, ref, path]);
      const r = check(repo);
      if (path === 'CHANGELOG.md') return r.changelog ?? null;
      return r.files?.[path] ?? null;
    },
  };
}
