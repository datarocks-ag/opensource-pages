import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { docSlug } from '../src/lib/doc-slug.ts';
import { FrontmatterError, rewriteMarkdown } from '../scripts/sync/rewrite.ts';

const ctx = { repo: 'postgres-provisioner', tag: 'v2.0.0', docsPath: 'docs', filePath: 'docs/howto/app-migrations.md' };
const gh = 'https://github.com/datarocks-ag/postgres-provisioner';

test('sibling doc link → site URL with anchor', () => {
  expect(rewriteMarkdown('[x](../concepts.md#strategy)', ctx)).toContain('](/postgres-provisioner/docs/concepts/#strategy)');
});

test('index and README links map to the folder URL, segments lowercased', () => {
  const out = rewriteMarkdown('[a](../index.md) [b](./sub/README.md) [c](../ARCHITECTURE.md)', ctx);
  expect(out).toContain('](/postgres-provisioner/docs/)');
  expect(out).toContain('](/postgres-provisioner/docs/howto/sub/)');
  expect(out).toContain('](/postgres-provisioner/docs/architecture/)');
});

test('link outside docs → GitHub blob at tag', () => {
  expect(rewriteMarkdown('[cfg](../../config.example.yaml)', ctx)).toContain(`](${gh}/blob/v2.0.0/config.example.yaml)`);
});

test('non-markdown link inside docs → GitHub blob at tag', () => {
  expect(rewriteMarkdown('[f](./data.json)', ctx)).toContain(`](${gh}/blob/v2.0.0/docs/howto/data.json)`);
});

test('relative image → raw.githubusercontent at tag', () => {
  expect(rewriteMarkdown('![d](../img/a.png)', ctx)).toContain('](https://raw.githubusercontent.com/datarocks-ag/postgres-provisioner/v2.0.0/docs/img/a.png)');
});

test('badges and their wrapping links are removed', () => {
  const out = rewriteMarkdown(readFileSync('tests/fixtures/markdown/keycloak-readme-header.md', 'utf8'), ctx);
  expect(out).not.toMatch(/badge|workflows|!\[/);
  expect(out).toContain('Declarative Keycloak setup.');
});

test('H1 becomes frontmatter title and leaves body', () => {
  const out = rewriteMarkdown('# When the app runs migrations\n\nText', ctx);
  expect(out).toMatch(/^---\ntitle: "When the app runs migrations"\n/);
  expect(out).not.toContain('# When the app');
  expect(out).toContain('Text');
});

test('title is quoted safely', () => {
  expect(rewriteMarkdown('# Say "hi": a\n', ctx)).toContain('title: "Say \\"hi\\": a"');
});

test('no H1 → title from file name', () => {
  const out = rewriteMarkdown('Text', { ...ctx, filePath: 'docs/getting-started.md' });
  expect(out).toContain('title: "Getting started"');
});

test('existing frontmatter title wins; H1 stays', () => {
  const out = rewriteMarkdown('---\ntitle: Mine\nsidebar:\n  order: 2\n---\n# Heading\n', ctx);
  expect(out).toContain('title: "Mine"\nsidebar:\n  order: 2\neditUrl:');
  expect(out).toContain('# Heading');
});

test('absolute URLs and pure anchors are untouched', () => {
  const out = rewriteMarkdown('[a](https://example.com/x.md) [b](mailto:a@b.c) [c](#top)', ctx);
  expect(out).toContain('](https://example.com/x.md)');
  expect(out).toContain('](mailto:a@b.c)');
  expect(out).toContain('](#top)');
});

test('frontmatter gets editUrl', () => {
  expect(rewriteMarkdown('# T', ctx)).toContain(`editUrl: ${gh}/edit/main/docs/howto/app-migrations.md`);
});

test('changelog links resolve from the repo root; title falls back to Changelog', () => {
  const out = rewriteMarkdown('[d](docs/a.md) [l](LICENSE)', { ...ctx, filePath: 'CHANGELOG.md' });
  expect(out).toContain('title: "Changelog"');
  expect(out).toContain('](/postgres-provisioner/docs/a/)');
  expect(out).toContain(`](${gh}/blob/v2.0.0/LICENSE)`);
});

test('GFM tables, task lists, strikethrough and footnotes round-trip', () => {
  const src = [
    '| a | b |',
    '| - | - |',
    '| [x](../concepts.md) | ~~old~~ |',
    '',
    '- [ ] todo',
    '- [x] done',
    '',
    'Text[^1]',
    '',
    '[^1]: note',
    '',
  ].join('\n');
  const body = rewriteMarkdown(src, ctx).replace(/^---[\s\S]*?---\n\n/, '');
  expect(body).toContain('[x](/postgres-provisioner/docs/concepts/)');
  expect(body).toContain('~~old~~');
  expect(body).toContain('- [ ] todo\n- [x] done');
  expect(body).toContain('Text[^1]');
  expect(body).toContain('[^1]: note');
  expect(body).not.toContain('\\');
});

test('link to repo-root CHANGELOG.md maps to the site changelog when available', () => {
  const md = '[c](../../CHANGELOG.md#unreleased)';
  expect(rewriteMarkdown(md, { ...ctx, changelogOnSite: true })).toContain('](/postgres-provisioner/docs/changelog/#unreleased)');
  expect(rewriteMarkdown(md, ctx)).toContain(`](${gh}/blob/v2.0.0/CHANGELOG.md#unreleased)`);
});

test('relative src and href in raw HTML are rewritten', () => {
  const out = rewriteMarkdown('<img src="../img/a.png" alt="a"> <a href="../concepts.md">c</a> <a href="https://x.y/z">z</a> <a href="#t">t</a> <a href="mailto:a@b.c">m</a>', ctx);
  expect(out).toContain('src="https://raw.githubusercontent.com/datarocks-ag/postgres-provisioner/v2.0.0/docs/img/a.png"');
  expect(out).toContain('href="/postgres-provisioner/docs/concepts/"');
  expect(out).toContain('href="https://x.y/z"');
  expect(out).toContain('href="#t"');
  expect(out).toContain('href="mailto:a@b.c"');
});

test('link to a dotted file name uses the same slug the page is published under', () => {
  const out = rewriteMarkdown('[u](../upgrading-to-2.0.md#steps)', ctx);
  expect(out).toContain('](/postgres-provisioner/docs/upgrading-to-2-0/#steps)');
  const page = rewriteMarkdown('# U', { ...ctx, filePath: 'docs/upgrading-to-2.0.md', slug: docSlug('postgres-provisioner', 'upgrading-to-2.0.md') });
  expect(page).toContain('slug: "postgres-provisioner/docs/upgrading-to-2-0"');
});

test('uppercase and README file names slug consistently', () => {
  expect(docSlug('r', 'ARCHITECTURE.md')).toBe('r/docs/architecture');
  expect(docSlug('r', 'sub/README.md')).toBe('r/docs/sub');
  expect(docSlug('r', 'index.md')).toBe('r/docs');
});

test('only title, description and sidebar survive from repo frontmatter', () => {
  const src = '---\ntitle: Mine\ndescription: "D"\nslug: evil\neditUrl: false\ntemplate: splash\nhead:\n  - tag: script\nsidebar:\n  order: 2\n  badge: new\n---\nBody\n';
  const out = rewriteMarkdown(src, ctx);
  expect(out).toMatch(/^---\ntitle: "Mine"\ndescription: "D"\nsidebar:\n  order: 2\neditUrl: .*\n---\n/);
  expect(out).not.toMatch(/evil|splash|tag: script|badge/);
});

test('frontmatter values the schema would reject are dropped', () => {
  const out = rewriteMarkdown('---\ntitle: 3\nsidebar: 3\n---\n# Real\n', ctx);
  expect(out).toContain('title: "Real"');
  expect(out).not.toContain('sidebar');
});

test('unparseable frontmatter throws FrontmatterError', () => {
  expect(() => rewriteMarkdown('---\ntitle: "open\n---\nBody', ctx)).toThrow(FrontmatterError);
  expect(() => rewriteMarkdown('---\n- just\n- a list\n---\nBody', ctx)).toThrow(FrontmatterError);
});

test('repeated top-level keys keep the first and warn', () => {
  const warnings: string[] = [];
  const out = rewriteMarkdown('---\ntitle: First\ntitle: Second\ndescription: A\ndescription: B\nsidebar:\n  order: 1\nsidebar:\n  order: 2\n---\nBody\n', { ...ctx, warn: (m) => warnings.push(m) });
  expect(out.match(/^title:/gm)).toHaveLength(1);
  expect(out.match(/^description:/gm)).toHaveLength(1);
  expect(out.match(/^sidebar:/gm)).toHaveLength(1);
  expect(out).toContain('title: "First"');
  expect(out).toContain('description: "A"');
  expect(out).toContain('  order: 1');
  expect(out).not.toContain('order: 2');
  expect(warnings).toHaveLength(3);
  expect(warnings.join()).toMatch(/"title".*"description".*"sidebar"/);
});

test('repeated nested sidebar keys keep the first and warn', () => {
  const warnings: string[] = [];
  const out = rewriteMarkdown('---\nsidebar:\n  order: 1\n  label: A\n  order: 2\n  label: B\n---\n# T\n', { ...ctx, warn: (m) => warnings.push(m) });
  expect(out.match(/^ {2}order:/gm)).toHaveLength(1);
  expect(out.match(/^ {2}label:/gm)).toHaveLength(1);
  expect(out).toContain('  order: 1');
  expect(out).toContain('  label: "A"');
  expect(warnings).toEqual([
    'duplicate frontmatter key "sidebar.order" ignored, first occurrence kept',
    'duplicate frontmatter key "sidebar.label" ignored, first occurrence kept',
  ]);
});

test('duplicate keys are tolerated without a warn callback', () => {
  const out = rewriteMarkdown('---\ntitle: A\ntitle: B\n---\nBody\n', ctx);
  expect(out.match(/^title:/gm)).toHaveLength(1);
});

test('empty title or description is dropped so the H1 title applies', () => {
  for (const empty of ['""', "''"]) {
    const out = rewriteMarkdown(`---\ntitle: ${empty}\ndescription: ${empty}\n---\n# From H1\n`, ctx);
    expect(out).toContain('title: "From H1"');
    expect(out).not.toContain('description');
  }
});

test('mermaid code blocks become escaped diagram containers', () => {
  const out = rewriteMarkdown('# T\n\n```mermaid\ngraph LR\n  A["<b>a & b</b>"] --> B\n\n  B --> C\n```\n', ctx);
  expect(out).toContain('<pre class="mermaid">graph LR\n  A["&lt;b&gt;a &amp; b&lt;/b&gt;"] --&gt; B\n\n  B --&gt; C</pre>');
  expect(out).not.toContain('```mermaid');
});

test('other code blocks stay fenced', () => {
  expect(rewriteMarkdown('# T\n\n```yaml\nkey: value\n```\n', ctx)).toContain('```yaml\nkey: value\n```');
});
