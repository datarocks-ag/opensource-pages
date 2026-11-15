import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, expect, test } from 'vitest';
import SiteHeader from '../src/components/SiteHeader.astro';
import SiteFooter from '../src/components/SiteFooter.astro';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

test('header links to datarocks.ch as primary action and GitHub org', async () => {
  const html = await container.renderToString(SiteHeader);
  expect(html).toContain('href="https://datarocks.ch"');
  expect(html).toContain('href="https://github.com/datarocks-ag"');
  expect(html).toMatch(/<img[^>]+src="\/datarocks-logo\.svg"[^>]+alt="Datarocks"/);
});

test('footer states MIT and Data Rocks AG', async () => {
  const html = await container.renderToString(SiteFooter);
  expect(html).toContain('Data Rocks AG');
  expect(html).toContain('MIT');
});
