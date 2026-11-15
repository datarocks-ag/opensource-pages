/** Context for rewriting one markdown file fetched from a repo at a release tag. */
export interface RewriteContext {
  repo: string;
  tag: string;
  docsPath: string;
  filePath: string;
}

/** Stub: Task 4 replaces this with the real link/image rewriter. */
export function rewriteMarkdown(source: string, _ctx: RewriteContext): string {
  return source;
}
