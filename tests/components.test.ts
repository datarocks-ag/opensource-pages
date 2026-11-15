import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, expect, test } from 'vitest';
import TileGrid from '../src/components/TileGrid.astro';
import FlowStrip from '../src/components/FlowStrip.astro';
import ProjectSections from '../src/components/ProjectSections.astro';
import CommandLine from '../src/components/CommandLine.astro';
import CodeBlock from '../src/components/CodeBlock.astro';
import BrandBand from '../src/components/BrandBand.astro';
import Chip from '../src/components/Chip.astro';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});
const render = (c: any, props?: Record<string, unknown>, slots?: Record<string, string>) =>
  container.renderToString(c, { props, slots });

test('TileGrid is decorative and honours reduced motion', async () => {
  const html = await render(TileGrid);
  expect(html).toContain('aria-hidden="true"');
  expect(html.match(/class="tile/g)).toHaveLength(16);
  expect(html).toContain('prefers-reduced-motion');
});

test('FlowStrip never relies on colour alone', async () => {
  const html = await render(FlowStrip, {
    outcomes: [
      { kind: 'allowed', host: 'api.example.com', result: '200 allowed' },
      { kind: 'rewritten', host: 'cdn.example.com', result: 'rewritten' },
      { kind: 'blocked', host: 'ads.tiktok.com', result: '403 blocked' },
    ],
  });
  for (const t of ['✓', '↪', '✕', '403 blocked', '200 allowed', 'rewritten']) expect(html).toContain(t);
  expect(html).toContain('aria-label=');
});

test('ProjectSections renders a table section with a scroll container', async () => {
  const html = await render(ProjectSections, {
    sections: [{ type: 'table', title: 'T', columns: ['a'], rows: [['1']] }],
  });
  expect(html).toMatch(/overflow-x:\s*auto/);
  expect(html).toContain('<th scope="col"');
});

test('ProjectSections dispatches flow, code and steps sections', async () => {
  const html = await render(ProjectSections, {
    sections: [
      { type: 'flow', title: 'Flow T', steps: [{ title: 'S1', body: 'B1' }] },
      { type: 'code', title: 'Code T', file: 'a.yaml', code: 'x: <1>', aside: 'Aside text' },
      { type: 'steps', title: 'Steps T', items: [{ title: 'I1', body: 'IB', code: 'run me' }] },
    ],
  });
  for (const t of ['Flow T', 'S1', 'Code T', 'a.yaml', 'x: &lt;1&gt;', 'Aside text', 'Steps T', 'I1', 'run me'])
    expect(html).toContain(t);
});

test('CommandLine has an accessible copy button', async () => {
  const html = await render(CommandLine, { command: 'docker pull x' });
  expect(html).toContain('<button type="button" aria-label="Copy command"');
  expect(html).toContain('docker pull x');
  expect(html).toContain('data-copy');
});

test('CodeBlock escapes code and renders caption link', async () => {
  const html = await render(CodeBlock, { file: 'f.yml', code: '<b>', caption: 'Cap', captionHref: 'https://x.y' });
  expect(html).toContain('&lt;b&gt;');
  expect(html).toMatch(/<figcaption[\s\S]*href="https:\/\/x\.y"[\s\S]*Cap/);
});

test('BrandBand links to datarocks.ch', async () => {
  const html = await render(BrandBand, { title: 'Built by Data Rocks AG' });
  expect(html).toContain('href="https://datarocks.ch"');
  expect(html).toContain('Visit datarocks.ch →');
});

test('Chip renders its slot', async () => {
  const html = await render(Chip, { tone: 'accent' }, { default: 'MIT' });
  expect(html).toContain('MIT');
});
