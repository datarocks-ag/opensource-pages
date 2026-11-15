import { describe, expect, test } from 'vitest';
import { DataError, loadCollections, loadProjects } from '../src/lib/project-data.ts';
import { collectionUrl, docsUrl, githubUrl, imageRef, projectUrl } from '../src/lib/urls.ts';

describe('project data', () => {
  test('loads all seven first-wave projects in spec order', () => {
    expect(loadProjects().map((p) => p.repo)).toEqual([
      'keycloak-provisioner',
      'postgres-provisioner',
      'nats-provisioner',
      'redpanda-provisioner',
      'gcp-emulator-provisioner',
      'seaweedfs-provisioner',
      'go-egress-mitm-proxy',
    ]);
  });

  test('proxy is standalone and reads docs from doc/', () => {
    const p = loadProjects().find((p) => p.repo === 'go-egress-mitm-proxy')!;
    expect(p.collection).toBeUndefined();
    expect(p.docsPath).toBe('doc');
  });

  test('provisioners default docsPath to docs and sections to empty', () => {
    const p = loadProjects().find((p) => p.repo === 'keycloak-provisioner')!;
    expect(p.docsPath).toBe('docs');
    expect(p.sections).toEqual([]);
  });

  test('proxy declares flow, table and code sections', () => {
    const p = loadProjects().find((p) => p.repo === 'go-egress-mitm-proxy')!;
    expect(p.sections.map((s) => s.type)).toEqual(['flow', 'table', 'code']);
  });

  test('every collection member points at an existing collection', () => {
    const slugs = loadCollections().map((c) => c.slug);
    for (const p of loadProjects()) {
      if (p.collection) expect(slugs).toContain(p.collection);
    }
  });

  test('no project repo equals a collection slug', () => {
    const repos = new Set(loadProjects().map((p) => p.repo));
    for (const c of loadCollections()) expect(repos.has(c.slug)).toBe(false);
  });

  test('conventions only reference repos of that collection', () => {
    for (const c of loadCollections()) {
      const members = loadProjects().filter((p) => p.collection === c.slug).map((p) => p.repo);
      for (const row of c.conventions) {
        for (const repo of row.supported) expect(members).toContain(repo);
      }
    }
  });

  test('compose example only uses version placeholders for known repos', () => {
    const repos = loadProjects().map((p) => p.repo);
    for (const c of loadCollections()) {
      for (const m of c.compose.code.matchAll(/\{\{version:([^}]+)\}\}/g)) {
        expect(repos).toContain(m[1]);
      }
    }
  });

  test('a feature icon outside the icon set raises DataError', () => {
    expect(() => loadProjects('tests/fixtures/data-bad-icon')).toThrow(/features\[0\]\.icon/);
  });

  test('invalid file raises DataError naming the file', () => {
    expect(() => loadProjects('tests/fixtures/data')).toThrow(/invalid-project\.json/);
    expect(() => loadProjects('tests/fixtures/data')).toThrow(DataError);
  });
});

describe('urls', () => {
  test('imageRef strips the v and falls back to latest', () => {
    expect(imageRef('keycloak-provisioner', 'v1.13.0')).toBe('ghcr.io/datarocks-ag/keycloak-provisioner:1.13.0');
    expect(imageRef('keycloak-provisioner', null)).toBe('ghcr.io/datarocks-ag/keycloak-provisioner:latest');
  });

  test('site paths', () => {
    expect(projectUrl('nats-provisioner')).toBe('/nats-provisioner/');
    expect(docsUrl('nats-provisioner')).toBe('/nats-provisioner/docs/');
    expect(collectionUrl('provisioners')).toBe('/provisioners/');
  });

  test('githubUrl with and without path and ref', () => {
    expect(githubUrl('nats-provisioner')).toBe('https://github.com/datarocks-ag/nats-provisioner');
    expect(githubUrl('nats-provisioner', 'config.example.yaml', 'v1.1.0')).toBe(
      'https://github.com/datarocks-ag/nats-provisioner/blob/v1.1.0/config.example.yaml',
    );
    expect(githubUrl('nats-provisioner', 'CHANGELOG.md')).toBe(
      'https://github.com/datarocks-ag/nats-provisioner/blob/main/CHANGELOG.md',
    );
  });
});
