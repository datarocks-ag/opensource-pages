# oss.datarocks.ch — Design

Status: draft for approval · 2026-11-15
Visual design: https://claude.ai/artifact/DYXeNTGFp9pRyiurGmtUCW (canvas: Landing, Provisioners, keycloak-provisioner, Docs, go-egress-mitm-proxy, hero tiles)

## Intent

Data Rocks publishes infrastructure tooling under MIT on GitHub (`datarocks-ag`). There is no entry point that presents these projects together. `oss.datarocks.ch` is that entry point.

It has two jobs, and they reinforce each other:

1. **Adoption.** An engineer landing from GitHub, a search or a README understands within ~30 seconds what a project does and can copy a working snippet.
2. **Showcase.** The same visitor leaves thinking Data Rocks is a serious engineering shop. The evidence is the work itself — real configs, shared conventions, visible quality signals — not marketing copy.

The primary call to action for the company side is **visit datarocks.ch**. No contact forms, no job pages.

## Goals

- A general landing page "Open source at Data Rocks" that scales beyond the first projects.
- First wave (7 projects): the six provisioners as one *collection* — `keycloak-provisioner`, `postgres-provisioner`, `nats-provisioner`, `redpanda-provisioner`, `gcp-emulator-provisioner`, `seaweedfs-provisioner` — and `go-egress-mitm-proxy` as a *standalone project*. `debug-docker` is out of scope.
- A project page per project, and full documentation (reference, how-tos, FAQ) per project, searchable across projects.
- Adding project #6 means adding one data file (plus a `docs/` folder in its repo) — no layout work.
- Versions, licenses and docs come from the project repos; nobody edits version numbers on the site by hand.

## Non-goals (v1)

- Versioned docs (v1.x vs v2.x side by side). Docs track the latest release only.
- Blog, news, changelog aggregation, contributor pages.
- Contact forms, newsletter, job listings.
- Dark mode on the custom (non-docs) pages.
- Analytics. (Can be added later with a privacy-friendly, cookieless tool.)

## Anti-goals

- **Two sources of truth for docs.** Docs are never copy-pasted into the site repo; they are written next to the code.
- **A marketing site.** If a section can't point at real code, config or behaviour, it doesn't belong.
- **Invented facts.** No made-up stats, star counts or testimonials. Every claim on a page must be true for the project it's shown on (e.g. the conventions matrix shows `--dry-run` as Keycloak-only, because it is).
- **Looking like a copy of datarocks.ch.** Same brand, but its own developer-oriented look.
- **A fragile build.** One broken or unreachable project repo must not take the site down.

## Constraints

- Hosted on **GitHub Pages**, custom domain `oss.datarocks.ch`.
- Site repo lives at `/home/ssc/work/datarocks/opensource` (GitHub repo under `datarocks-ag`, name to be chosen at creation).
- TypeScript, **pnpm**.
- Dependencies agreed in this design: **Astro**, **Starlight** (Astro docs theme, brings Pagefind search), **starlight-sidebar-topics** (one sidebar per project inside a single Starlight instance), **@fontsource/** packages (self-hosted fonts), **remark/unified** helpers (link and image rewriting in fetched docs), **vitest** (build tests). Anything beyond these needs discussion.
- Infra outside the repo needs explicit approval before touching: DNS `CNAME` record for `oss.datarocks.ch`, GitHub Pages settings, and the GitHub Actions workflow in the new repo.
- Brand: taken from datarocks.ch (see Visual design).

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | **Astro + GitHub Actions → Pages** | Typed content collections fit a growing catalog; build-time GitHub fetches are simple; zero-JS static output; matches TS/pnpm stack. Cost: Node toolchain + Actions workflow. |
| B | Hugo + Actions → Pages | Single Go binary, fast. Go templates are clunky for a custom design; build-time API fetches awkward. |
| C | Hand-written HTML + JSON, no build | Nothing to maintain, but no generated pages or live release data; every project means copy-pasted markup. |

**Docs:** considered (1) README only, linked from the site; (2) docs copied into the site repo; (3) docs live in each project repo and are pulled at build time. **Chosen: (3)** — single source of truth next to the code, full docs UX on the site.

## Decisions

### Information architecture & URLs

```
/                                   Landing
/provisioners/                      Collection page
/<repo>/                            Project page   e.g. /keycloak-provisioner/, /go-egress-mitm-proxy/
/<repo>/docs/…                      Project docs (Starlight)
```

Projects are addressed by **repo name** (unique, stable, already what people know). Collections get their own top-level slug. *(My call.)*

### Pages (as designed on the canvas)

**Landing**
- Header: logo + "/ open source", nav (Projects, How we build, GitHub ↗, **datarocks.ch ↗** as the primary button).
- Hero: eyebrow `oss.datarocks.ch`, H1 "Open source at Data Rocks", one-line intro, buttons *Browse projects* and *github.com/datarocks-ag*. Right side: the **half-circle tile grid** (4×4 tiles built from the logo mark, quarter-turn on hover; purely decorative, `aria-hidden`).
- Facts strip: project count (computed), MIT licensed, Written in Go, Images on ghcr.io, CI on every repo. Only facts true for all listed projects.
- Projects: one card per collection (Provisioners: description, one mini tile per tool with version and what it provisions) and one card per standalone project (proxy: pitch, highlight chips, small *request-flow strip* app → proxy → allowed / rewritten / 403 blocked). Then a dashed "Coming next" placeholder linking to GitHub.
- How we build: four principles — Declarative · Safe by default · Observable · Shipped properly.
- "Built by Data Rocks AG" navy band → **Visit datarocks.ch**.
- Footer: © Data Rocks AG · MIT, GitHub, datarocks.ch.

**Collection — Provisioners**
- Breadcrumb, H1, intro.
- How they work: Describe → Provision → Start.
- One card per tool: repo name, version, tagline, resource chips, image, Details / GitHub.
- "Learn one, know them all": conventions matrix (rows = conventions, columns = tools, ✓ / —). Content comes from the collection data file, not inferred. As verified on 2026-11-15, all six share idempotent YAML config, `${VAR}` expansion, `update`/`create` strategy, retry with backoff and structured logs; `--dry-run` exists for Keycloak, PostgreSQL, GCP emulator and SeaweedFS, not yet for NATS and Redpanda.
- "Bootstrap a whole stack": combined `docker-compose.yaml` using `service_completed_successfully`.
- Navy band → datarocks.ch.

**Project page** (template; keycloak-provisioner and go-egress-mitm-proxy designed)
- Breadcrumb, repo name as H1 (mono), tagline, fact chips (version · latest, MIT, Go, project-specific chips).
- Buttons: View on GitHub (primary), Documentation, Changelog/Releases. `docker pull` line with Copy button.
- "What it does" feature list next to a config excerpt (with link to the source file in the repo).
- Project-specific sections are allowed (Keycloak: env-var table + flags; proxy: request flow, domain-pattern table "Patterns that don't fail open", sidecar deployment).
- Collection members show "More provisioners".

**Docs** (Starlight)
- Top bar: project + version switcher (`keycloak-provisioner · v1.5.0 (latest)`), search across *all* projects' docs, GitHub link.
- Sidebar groups: Getting started · Reference · How-tos · Help (FAQ, Changelog).
- Right "On this page" TOC; footer "Edit this page on GitHub" + "Docs for vX.Y.Z · built from the release tag".

### Content model

In the site repo:

```
src/content/collections/<slug>.yaml   name, description, steps[], conventions matrix, compose example
src/content/projects/<repo>.yaml      repo, collection?, name, tagline, highlights[], resources[],
                                      image, configExample{path,lines}, docsPath (default "docs"),
                                      projectSections (optional, project-specific blocks)
```

`projectSections` are a small set of **generic typed blocks** (`table`, `flow`, `code`, `steps`) rendered by shared components — no per-project Astro components, so project #6 stays one data file. They hold curated showcase content only (e.g. the proxy's request flow and domain-pattern table). **Reference material is not duplicated**: env-var and flag tables live in the repo docs only; the project page links to them. The Keycloak project page on the canvas drops its env-var/flags block accordingly. *(My call.)*

Taglines and highlights live **in the site's data file**, not GitHub's repo description (the proxy has none set).

Cross-project guides (e.g. "Bootstrap Postgres + Keycloak + Redpanda for local dev", "Run provisioners as Kubernetes Jobs") live in the site repo under the collection.

### Data pulled from GitHub at build time

Per project, via the GitHub API (authenticated with the Actions `GITHUB_TOKEN`):
- latest release tag + date → version shown everywhere, image tag in snippets, docs version label;
- license;
- the docs folder **at that release tag** (`docsPath`, default `docs/`, proxy uses `doc/`) and the config-example file.

Rebuild triggers: push to the site repo, nightly schedule, manual dispatch. *(Optional later: project repos trigger a rebuild on release via `repository_dispatch`.)*

**Docs at launch / tags without docs:** docs are only ever published from the latest release tag. If that tag has no `docsPath` folder, the project page and docs nav show "Documentation on GitHub" linking to the README at that tag — unreleased docs from the default branch are never shown. Projects gain site docs with their next normal release; no coordinated release across repos is needed for launch. *(My call.)*

**Changelog:** the "Changelog" docs page renders `CHANGELOG.md` from the repo root at the release tag (all first-wave repos have one). *(My call.)*

**Note:** the canvas shows versions from stale local checkouts (e.g. keycloak v1.5.0; current is v1.13.0). All versions on the site come from the API; never hard-code them.

**Failure behaviour:** if a repo, release or docs folder can't be fetched or parsed, the build logs a warning and continues. The project page still renders from its data file with a "Docs available on GitHub" fallback link. The build fails only on errors in the site repo itself.

### Docs convention in project repos

```
docs/
  index.md            Overview
  getting-started.md
  configuration.md    + other reference pages
  howto/*.md
  faq.md
  upgrading-to-X.md   (when a major version breaks things)
```

`postgres-provisioner` already has a `docs/` folder in this shape (getting-started, how-tos, upgrading-to-2.0) and is the reference example; `gcp-emulator-provisioner` has one too.

- Starlight frontmatter (`title`, optional `sidebar.order`). Sidebar is generated from the folder.
- Relative links and images are rewritten to site URLs at build; GitHub-only artefacts (badges) are stripped.
- `docsPath` per project, so repos with a different folder (proxy: `doc/`) don't need to rename.
- READMEs shrink to pitch + quick start + link to the site docs **after** the docs exist on the site.

### Visual design

Brand from datarocks.ch:
- Colours: electric blue `#1301E9` (accent, links, primary buttons), navy `#0A017B` (headings, nav, dark bands), deep navy `#020165`. Neutrals cool-tinted: background `#F7F7FB`, borders `#E3E4EF`, body text `#3B3D55`, muted `#55576F`, code background `#0D0C2E`.
- Status colours (request-flow strip, matrix): allowed `#047857`, rewritten `#1301E9`, blocked `#B42318` — always paired with icon and text, never colour alone.
- Type: **Montserrat** (headings), **Nunito** (body) — the datarocks.ch fonts — plus **JetBrains Mono** for code, repo names and labels.
- Logo: official `datarocks-logo.svg` from datarocks.ch. The half-circle mark is the recurring motif (hero tiles, project nodes).
- Fonts are **self-hosted** (no requests to Google from the site). *(My call — privacy; implies `@fontsource/*` packages or vendored font files.)*
- Starlight is themed with the same tokens.
- Accessibility: WCAG AA contrast, real links/buttons, keyboard-reachable copy buttons, decorative graphics `aria-hidden`, layouts work at 375 px.

### Deployment

- GitHub Actions: install (pnpm), build, deploy to Pages. `public/CNAME` = `oss.datarocks.ch`.
- DNS: `CNAME oss.datarocks.ch → datarocks-ag.github.io` — **needs approval / done by whoever owns DNS**.

## Content still owed by Data Rocks

- One or two lines on what Data Rocks does (landing band) and how the tools are used in client work (collection band) — placeholders in the design.
- Real FAQ entries per project (the designed ones are derived from README facts; real questions should come from issues and support experience).
- GitHub repo description for `go-egress-mitm-proxy` (nice to have; site does not depend on it).

## Pre-launch work in project repos

- `postgres-provisioner` and `gcp-emulator-provisioner` already have `docs/`; `go-egress-mitm-proxy` has `doc/` (set `docsPath`). Keycloak, NATS, Redpanda and SeaweedFS need their README split into `docs/` — until their next release ships it, the site links to the README.
- Confirm image tags follow `ghcr.io/datarocks-ag/<repo>:<semver without v>` (used in snippets).

## Left to the builder

- Astro project structure, component breakdown, and how custom pages and Starlight share header/footer and tokens.
- Implementation of the GitHub fetch layer (caching between builds, rate-limit handling) within the failure behaviour above.
- Markdown link/image rewriting approach.
- Exact responsive breakpoints, hover/motion details (respect `prefers-reduced-motion` for the tile rotation).
- Test approach: at minimum a build test that runs against fixtures, including a "repo unreachable" case.
