import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export type Section =
  | { type: 'table'; title: string; intro?: string; columns: string[]; rows: string[][] }
  | { type: 'flow'; title: string; intro?: string; steps: { title: string; body: string }[] }
  | { type: 'code'; title: string; intro?: string; file: string; code: string; aside?: string }
  | { type: 'steps'; title: string; items: { title: string; body: string; code?: string }[] };

export interface ProjectData {
  repo: string;
  name: string;
  collection?: string;
  order: number;
  tagline: string;
  highlights: string[];
  resources?: string[];
  features: { title: string; body: string }[];
  configExample?: { path: string; startLine?: number; endLine?: number };
  /** Folder in the repo that holds the docs. Defaults to `docs`. */
  docsPath: string;
  sections: Section[];
}

export interface CollectionData {
  slug: string;
  name: string;
  description: string;
  steps: { title: string; body: string; code: string }[];
  /** `supported` lists the repos that have the convention. */
  conventions: { label: string; supported: string[] }[];
  /** `code` may contain `{{version:<repo>}}` placeholders. */
  compose: { file: string; code: string };
}

/** A data file is malformed. The message names the file and the reason. */
export class DataError extends Error {
  constructor(file: string, reason: string) {
    super(`${file}: ${reason}`);
    this.name = 'DataError';
  }
}

// Resolved from cwd, not import.meta.url: Astro bundles this module into dist/chunks.
const root = process.cwd();
const DEFAULT_PROJECTS_DIR = join(root, 'src/content/projects');
const DEFAULT_COLLECTIONS_DIR = join(root, 'src/content/collections');

type Obj = Record<string, unknown>;

/** Loads all project files in `dir`, sorted by collection then order. */
export function loadProjects(dir: string = DEFAULT_PROJECTS_DIR): ProjectData[] {
  const projects = readJsonFiles(dir).map(({ file, value }) => parseProject(file, value));
  return projects.sort(
    (a, b) =>
      Number(a.collection === undefined) - Number(b.collection === undefined) || // standalone last
      (a.collection ?? '').localeCompare(b.collection ?? '') ||
      a.order - b.order,
  );
}

/** Loads all collection files in `dir`, sorted by slug. */
export function loadCollections(dir: string = DEFAULT_COLLECTIONS_DIR): CollectionData[] {
  return readJsonFiles(dir)
    .map(({ file, value }) => parseCollection(file, value))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function readJsonFiles(dir: string): { file: string; value: unknown }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      try {
        return { file: basename(path), value: JSON.parse(readFileSync(path, 'utf8')) as unknown };
      } catch (e) {
        throw new DataError(f, `invalid JSON (${(e as Error).message})`);
      }
    });
}

function parseProject(file: string, v: unknown): ProjectData {
  const o = obj(file, v, 'file');
  const configExample = o.configExample === undefined ? undefined : parseConfigExample(file, o.configExample);
  return {
    repo: str(file, o, 'repo'),
    name: str(file, o, 'name'),
    ...(o.collection === undefined ? {} : { collection: str(file, o, 'collection') }),
    order: num(file, o, 'order'),
    tagline: str(file, o, 'tagline'),
    highlights: strList(file, o, 'highlights'),
    ...(o.resources === undefined ? {} : { resources: strList(file, o, 'resources') }),
    features: list(file, o, 'features').map((f, i) => {
      const x = obj(file, f, `features[${i}]`);
      return { title: str(file, x, 'title', `features[${i}]`), body: str(file, x, 'body', `features[${i}]`) };
    }),
    ...(configExample ? { configExample } : {}),
    docsPath: o.docsPath === undefined ? 'docs' : str(file, o, 'docsPath'),
    sections: o.sections === undefined ? [] : list(file, o, 'sections').map((s, i) => parseSection(file, s, i)),
  };
}

function parseConfigExample(file: string, v: unknown): NonNullable<ProjectData['configExample']> {
  const o = obj(file, v, 'configExample');
  const out: NonNullable<ProjectData['configExample']> = { path: str(file, o, 'path', 'configExample') };
  if (o.startLine !== undefined) out.startLine = num(file, o, 'startLine', 'configExample');
  if (o.endLine !== undefined) out.endLine = num(file, o, 'endLine', 'configExample');
  return out;
}

function parseSection(file: string, v: unknown, i: number): Section {
  const at = `sections[${i}]`;
  const o = obj(file, v, at);
  const title = str(file, o, 'title', at);
  const intro = o.intro === undefined ? {} : { intro: str(file, o, 'intro', at) };
  switch (o.type) {
    case 'table':
      return {
        type: 'table', title, ...intro,
        columns: strList(file, o, 'columns', at),
        rows: list(file, o, 'rows', at).map((r, j) => {
          if (!Array.isArray(r) || r.some((c) => typeof c !== 'string')) {
            throw new DataError(file, `${at}.rows[${j}] must be an array of strings`);
          }
          return r as string[];
        }),
      };
    case 'flow':
      return {
        type: 'flow', title, ...intro,
        steps: list(file, o, 'steps', at).map((s, j) => {
          const x = obj(file, s, `${at}.steps[${j}]`);
          return { title: str(file, x, 'title', `${at}.steps[${j}]`), body: str(file, x, 'body', `${at}.steps[${j}]`) };
        }),
      };
    case 'code':
      return {
        type: 'code', title, ...intro,
        file: str(file, o, 'file', at),
        code: str(file, o, 'code', at),
        ...(o.aside === undefined ? {} : { aside: str(file, o, 'aside', at) }),
      };
    case 'steps':
      return {
        type: 'steps', title,
        items: list(file, o, 'items', at).map((s, j) => {
          const p = `${at}.items[${j}]`;
          const x = obj(file, s, p);
          return {
            title: str(file, x, 'title', p),
            body: str(file, x, 'body', p),
            ...(x.code === undefined ? {} : { code: str(file, x, 'code', p) }),
          };
        }),
      };
    default:
      throw new DataError(file, `${at}.type must be one of table, flow, code, steps (got ${JSON.stringify(o.type)})`);
  }
}

function parseCollection(file: string, v: unknown): CollectionData {
  const o = obj(file, v, 'file');
  const compose = obj(file, o.compose, 'compose');
  return {
    slug: str(file, o, 'slug'),
    name: str(file, o, 'name'),
    description: str(file, o, 'description'),
    steps: list(file, o, 'steps').map((s, i) => {
      const x = obj(file, s, `steps[${i}]`);
      return {
        title: str(file, x, 'title', `steps[${i}]`),
        body: str(file, x, 'body', `steps[${i}]`),
        code: str(file, x, 'code', `steps[${i}]`),
      };
    }),
    conventions: list(file, o, 'conventions').map((c, i) => {
      const x = obj(file, c, `conventions[${i}]`);
      return { label: str(file, x, 'label', `conventions[${i}]`), supported: strList(file, x, 'supported', `conventions[${i}]`) };
    }),
    compose: { file: str(file, compose, 'file', 'compose'), code: str(file, compose, 'code', 'compose') },
  };
}

function path(at: string, key: string): string {
  return at === 'file' ? key : `${at}.${key}`;
}

function obj(file: string, v: unknown, at: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DataError(file, `${at} must be an object`);
  return v as Obj;
}

function str(file: string, o: Obj, key: string, at = 'file'): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new DataError(file, `${path(at, key)} must be a non-empty string`);
  return v;
}

function num(file: string, o: Obj, key: string, at = 'file'): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(file, `${path(at, key)} must be a number`);
  return v;
}

function list(file: string, o: Obj, key: string, at = 'file'): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new DataError(file, `${path(at, key)} must be an array`);
  return v;
}

function strList(file: string, o: Obj, key: string, at = 'file'): string[] {
  const v = list(file, o, key, at);
  if (v.some((x) => typeof x !== 'string')) throw new DataError(file, `${path(at, key)} must be an array of strings`);
  return v as string[];
}
