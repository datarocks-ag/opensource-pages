import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import { sidebarTopics } from './src/lib/docs-topics.ts';
import { loadProjects } from './src/lib/project-data.ts';
import { getRelease } from './src/lib/releases.ts';

export default defineConfig({
  site: 'https://oss.datarocks.ch',
  integrations: [
    starlight({
      title: 'Data Rocks Open Source',
      favicon: '/datarocks-logo.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/datarocks-ag' }],
      customCss: ['./src/styles/starlight.css'],
      components: {
        SiteTitle: './src/components/starlight/SiteTitle.astro',
        Footer: './src/components/starlight/Footer.astro',
      },
      plugins: [starlightSidebarTopics(sidebarTopics(loadProjects(), getRelease))],
    }),
  ],
});
