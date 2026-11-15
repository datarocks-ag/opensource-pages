/** A GitHub API request failed with a non-success status (other than the 404s the client maps). */
export class GitHubError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`GitHub API ${status} for ${url}`);
    this.name = 'GitHubError';
    this.status = status;
    this.url = url;
  }
}

/** Read-only view of the GitHub REST API, scoped to one owner. */
export interface GitHubClient {
  /** Latest published release; null when the repo has none (404). */
  latestRelease(repo: string): Promise<{ tag: string; publishedAt: string } | null>;
  /** SPDX id of the repo license, or null. */
  license(repo: string): Promise<string | null>;
  /** Repo-relative paths of all files under `dir` at `ref`, recursive; a missing dir yields []. */
  listFiles(repo: string, ref: string, dir: string): Promise<string[]>;
  /** File content at `ref`; null when the file does not exist (404). */
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
}

const API = 'https://api.github.com';

/** Creates a client using the global `fetch` unless `opts.fetch` is given. */
export function createGitHubClient(opts: { owner: string; token?: string; fetch?: typeof fetch }): GitHubClient {
  const doFetch = opts.fetch ?? fetch;
  const base = (repo: string) => `${API}/repos/${opts.owner}/${repo}`;

  async function request(url: string, accept: string): Promise<Response | null> {
    const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await doFetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new GitHubError(res.status, url);
    return res;
  }

  const json = async (url: string): Promise<any | null> => {
    const res = await request(url, 'application/vnd.github+json');
    return res ? res.json() : null;
  };

  return {
    async latestRelease(repo) {
      const body = await json(`${base(repo)}/releases/latest`);
      return body ? { tag: body.tag_name, publishedAt: body.published_at } : null;
    },
    async license(repo) {
      const body = await json(base(repo));
      const id = body?.license?.spdx_id;
      return typeof id === 'string' && id !== 'NOASSERTION' ? id : null;
    },
    async listFiles(repo, ref, dir) {
      const body = await json(`${base(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      if (!body) return [];
      if (body.truncated) {
        throw new Error(`git tree of ${opts.owner}/${repo}@${ref} is truncated; docs listing would be incomplete`);
      }
      const prefix = `${dir.replace(/\/+$/, '')}/`;
      return (body.tree as { path: string; type: string }[])
        .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
        .map((e) => e.path);
    },
    async readFile(repo, ref, path) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = await request(`${base(repo)}/contents/${encoded}?ref=${encodeURIComponent(ref)}`, 'application/vnd.github.raw');
      return res ? res.text() : null;
    },
  };
}
