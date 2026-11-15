import { posix } from 'node:path';
import type { Definition, Heading, Image, Link, Nodes, Parent, Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { docUrl } from '../../src/lib/doc-slug.ts';

/** Context for rewriting one markdown file fetched from a repo at a release tag. */
export interface RewriteContext {
  repo: string;
  tag: string;
  docsPath: string;
  /** Repo-relative path of the file being rewritten. */
  filePath: string;
  /** True when the repo's CHANGELOG.md is published as the site's changelog page. */
  changelogOnSite?: boolean;
  /** Site slug the page is published under, written as `slug` frontmatter. Omitted: Starlight derives it. */
  slug?: string;
}

/** Repo frontmatter that cannot be parsed; the file must be skipped. */
export class FrontmatterError extends Error {
  constructor(reason: string) {
    super(`unusable frontmatter: ${reason}`);
    this.name = 'FrontmatterError';
  }
}

const ORG = 'datarocks-ag';
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BADGE = /\/actions\/workflows\/|badge|\.badges\//i;

/**
 * Rewrites a markdown file from a repo so it works as a Starlight page: relative links point at
 * site pages or GitHub, relative images at raw.githubusercontent, badges are dropped, and
 * `title`/`editUrl`/`slug` frontmatter is set. Of an existing frontmatter block only `title`,
 * `description` and `sidebar` survive, so a repo cannot break the site's content schema.
 * Throws {@link FrontmatterError} when the block cannot be parsed.
 */
export function rewriteMarkdown(source: string, ctx: RewriteContext): string {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm).parse(source) as Root;

  removeBadges(tree);
  visit(tree, (node) => {
    if (node.type === 'link' || node.type === 'definition') node.url = rewriteUrl(node.url, ctx, false);
    else if (node.type === 'image') node.url = rewriteUrl(node.url, ctx, true);
    else if (node.type === 'html') node.value = rewriteHtml(node.value, ctx);
  });

  const kept = filterFrontmatter(tree.children[0]?.type === 'yaml' ? tree.children.shift()!.value : '');
  const lines = [...kept.lines];
  if (!kept.hasTitle) lines.unshift(`title: ${JSON.stringify(extractTitle(tree) ?? titleFromFile(ctx.filePath))}`);
  lines.push(`editUrl: https://github.com/${ORG}/${ctx.repo}/edit/main/${ctx.filePath}`);
  if (ctx.slug) lines.push(`slug: ${JSON.stringify(ctx.slug)}`);

  const body = unified()
    .use(remarkGfm)
    .use(remarkStringify, { bullet: '-', emphasis: '_', fences: true, listItemIndent: 'one', rule: '-' })
    .stringify(tree);
  const head = `---\n${lines.join('\n')}\n---\n`;
  return body.trim() ? `${head}\n${body}` : head;
}

const SIDEBAR_KEYS = new Set(['order', 'label', 'hidden']);

/**
 * Reduces a YAML frontmatter block to `title`, `description` and `sidebar` (`order`, `label`,
 * `hidden`). Only the plain `key: value` subset is understood, because the sync has no YAML parser;
 * anything else at the top level means the block is unparseable. Values that would not pass the
 * content schema (non-string title, non-numeric order) are dropped.
 */
function filterFrontmatter(block: string): { lines: string[]; hasTitle: boolean } {
  const out: string[] = [];
  let hasTitle = false;
  const rows = block.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.trim() || row.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(row);
    if (!m) throw new FrontmatterError(`cannot parse line "${row.trim().slice(0, 40)}"`);
    const [, key, rest] = m;
    const nested: string[] = [];
    while (i + 1 < rows.length && (/^\s+\S/.test(rows[i + 1]) || !rows[i + 1].trim())) nested.push(rows[++i]);
    if (key === 'title' || key === 'description') {
      const value = scalarString(rest.trim());
      if (value === undefined || nested.some((n) => n.trim())) continue;
      if (key === 'title') hasTitle = true;
      out.push(`${key}: ${JSON.stringify(value)}`);
    } else if (key === 'sidebar') {
      const items = sidebarLines(rest.trim(), nested);
      if (items.length > 0) out.push('sidebar:', ...items);
    }
  }
  return { lines: out, hasTitle };
}

/** The string a plain or quoted YAML scalar holds; undefined for block scalars, flow values and non-strings. */
function scalarString(raw: string): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(raw);
      return typeof v === 'string' ? v : undefined;
    } catch {
      throw new FrontmatterError(`unterminated or invalid quoted value ${raw.slice(0, 40)}`);
    }
  }
  if (raw.startsWith("'")) {
    if (raw.length < 2 || !raw.endsWith("'")) throw new FrontmatterError(`unterminated quoted value ${raw.slice(0, 40)}`);
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[|>&*!\[{@`%]/.test(raw) || /^(null|~|true|false|[-+]?[\d.]+)$/i.test(raw)) return undefined;
  return raw.replace(/\s+#.*$/, '');
}

function sidebarLines(rest: string, nested: string[]): string[] {
  if (rest) return [];
  const out: string[] = [];
  for (const row of nested) {
    const m = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(row);
    if (!m || !SIDEBAR_KEYS.has(m[1])) continue;
    const value = m[2].replace(/\s+#.*$/, '');
    const ok = m[1] === 'order' ? /^\d+$/.test(value) : m[1] === 'hidden' ? /^(true|false)$/.test(value) : scalarString(value) !== undefined;
    if (!ok) continue;
    out.push(`  ${m[1]}: ${m[1] === 'label' ? JSON.stringify(scalarString(value)) : value}`);
  }
  return out;
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

  if (!isImage && ctx.changelogOnSite && resolved === 'CHANGELOG.md') return `${docUrl(ctx.repo, 'changelog')}${suffix}`;

  const docsPrefix = `${ctx.docsPath.replace(/\/+$/, '')}/`;
  if (!isImage && /\.mdx?$/.test(resolved) && resolved.startsWith(docsPrefix)) {
    return `${docUrl(ctx.repo, resolved.slice(docsPrefix.length))}${suffix}`;
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
