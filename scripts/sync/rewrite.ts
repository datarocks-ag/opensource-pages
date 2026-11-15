import { posix } from 'node:path';
import type { Definition, Heading, Image, Link, Nodes, Parent, Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/** Context for rewriting one markdown file fetched from a repo at a release tag. */
export interface RewriteContext {
  repo: string;
  tag: string;
  docsPath: string;
  /** Repo-relative path of the file being rewritten. */
  filePath: string;
  /** True when the repo's CHANGELOG.md is published as the site's changelog page. */
  changelogOnSite?: boolean;
}

const ORG = 'datarocks-ag';
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BADGE = /\/actions\/workflows\/|badge|\.badges\//i;

/**
 * Rewrites a markdown file from a repo so it works as a Starlight page: relative links point at
 * site pages or GitHub, relative images at raw.githubusercontent, badges are dropped, and
 * `title`/`editUrl` frontmatter is set (an existing frontmatter block is kept verbatim).
 */
export function rewriteMarkdown(source: string, ctx: RewriteContext): string {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(source) as Root;

  removeBadges(tree);
  visit(tree, (node) => {
    if (node.type === 'link' || node.type === 'definition') node.url = rewriteUrl(node.url, ctx, false);
    else if (node.type === 'image') node.url = rewriteUrl(node.url, ctx, true);
    else if (node.type === 'html') node.value = rewriteHtml(node.value, ctx);
  });

  const frontmatter = tree.children[0]?.type === 'yaml' ? tree.children.shift()!.value : '';
  const lines = frontmatter ? [frontmatter] : [];
  if (!/^title\s*:/m.test(frontmatter)) {
    lines.push(`title: ${JSON.stringify(extractTitle(tree) ?? titleFromFile(ctx.filePath))}`);
  }
  if (!/^editUrl\s*:/m.test(frontmatter)) {
    lines.push(`editUrl: https://github.com/${ORG}/${ctx.repo}/edit/main/${ctx.filePath}`);
  }

  const body = unified()
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '_', fences: true, listItemIndent: 'one', rule: '-' })
    .stringify(tree);
  const head = `---\n${lines.join('\n')}\n---\n`;
  return body.trim() ? `${head}\n${body}` : head;
}

function isBadge(node: Nodes): boolean {
  return node.type === 'image' && BADGE.test(node.url);
}

/** Removes badge images, links that wrap only badges, and paragraphs left empty by that. */
function removeBadges(tree: Root): void {
  const onlyBadges = (n: Link): boolean =>
    n.children.length > 0 && n.children.every((c) => isBadge(c) || (c.type === 'text' && !c.value.trim()));
  visit(tree, (node, index, parent) => {
    if (index === undefined || !parent) return;
    if (isBadge(node) || (node.type === 'link' && onlyBadges(node))) {
      parent.children.splice(index, 1);
      return index;
    }
  });
  visit(tree, 'paragraph', (node, index, parent) => {
    if (index === undefined || !parent) return;
    const blank = node.children.every((c) => (c.type === 'text' && !c.value.trim()) || c.type === 'break');
    if (blank) {
      parent.children.splice(index, 1);
      return index;
    }
  });
}

function rewriteHtml(html: string, ctx: RewriteContext): string {
  return html.replace(/\b(src|href)=(?:"([^"]*)"|'([^']*)')/g, (_m, attr: string, dq?: string, sq?: string) =>
    `${attr}="${rewriteUrl(dq ?? sq ?? '', ctx, attr === 'src')}"`);
}

function rewriteUrl(url: string, ctx: RewriteContext, isImage: boolean): string {
  if (!url || url.startsWith('#') || url.startsWith('//') || SCHEME.test(url)) return url;
  const cut = url.search(/[#?]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  const suffix = cut === -1 ? '' : url.slice(cut);
  if (!path) return url;

  // A leading slash means repo root, which is how GitHub renders it.
  const resolved = path.startsWith('/') ? posix.normalize(path.slice(1)) : posix.join(posix.dirname(ctx.filePath), path);
  if (resolved.startsWith('..')) return url;

  if (!isImage && ctx.changelogOnSite && resolved === 'CHANGELOG.md') return `/${ctx.repo}/docs/changelog/${suffix}`;

  const docsPrefix = `${ctx.docsPath.replace(/\/+$/, '')}/`;
  if (!isImage && /\.mdx?$/.test(resolved) && resolved.startsWith(docsPrefix)) {
    const segments = resolved.slice(docsPrefix.length).replace(/\.mdx?$/, '').split('/');
    if (/^(index|readme)$/i.test(segments[segments.length - 1])) segments.pop();
    const slug = segments.map((s) => s.toLowerCase()).join('/');
    return `/${ctx.repo}/docs/${slug ? `${slug}/` : ''}${suffix}`;
  }
  const base = isImage
    ? `https://raw.githubusercontent.com/${ORG}/${ctx.repo}/${ctx.tag}`
    : `https://github.com/${ORG}/${ctx.repo}/blob/${ctx.tag}`;
  return `${base}/${resolved}${suffix}`;
}

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node ? (node as Parent).children.map((c) => plainText(c as Nodes)).join('') : '';
}

/** Takes the first top-level H1 out of the tree and returns its text. */
function extractTitle(tree: Root): string | null {
  const i = tree.children.findIndex((n) => n.type === 'heading' && (n as Heading).depth === 1);
  if (i === -1) return null;
  const [h1] = tree.children.splice(i, 1);
  return plainText(h1).trim() || null;
}

function titleFromFile(filePath: string): string {
  const name = posix.basename(filePath).replace(/\.mdx?$/, '');
  if (/^(index|readme)$/i.test(name)) return 'Overview';
  const words = name.replace(/[-_]+/g, ' ').trim();
  // Shouting file names (CHANGELOG, ARCHITECTURE) are lowercased; mixed case may hold acronyms.
  const base = words === words.toUpperCase() ? words.toLowerCase() : words;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
