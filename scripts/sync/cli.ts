import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataError, loadProjects } from '../../src/lib/project-data.ts';
import { createGitHubClient } from './github.ts';
import { syncAll } from './sync.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

try {
  const projects = loadProjects();
  const gh = createGitHubClient({ owner: 'datarocks-ag', token: process.env.GITHUB_TOKEN });
  const results = await syncAll(projects, gh, {
    docsRoot: join(root, 'src/content/docs'),
    examplesRoot: join(root, 'src/generated/examples'),
    releasesFile: join(root, 'src/generated/releases.json'),
  });
  for (const r of results) {
    console.log(`${r.repo}: ${r.version ?? 'no release'} docs=${r.docsAvailable} changelog=${r.changelogAvailable}`);
    for (const w of r.warnings) console.warn(`  warning: ${w}`);
  }
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
