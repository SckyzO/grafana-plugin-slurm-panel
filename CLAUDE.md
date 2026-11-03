# Working in this repository

`slurm-views` — a Grafana panel plugin (`tomzone-slurm-panel`) that draws one
cell per Slurm node, plus the engine it sits on. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) in full before the first change: the
toolchain contract, the regression-test rule and the supply-chain policy are
spread across it, and half of it is not half a contract.

## Everything runs through `make`

The toolchain lives in a container built from `dev/Dockerfile.toolchain`, and
`node_modules` lives in a Docker volume rather than in the checkout. **Never run
`pnpm`, `node`, `npx`, `tsc`, `jest`, `playwright` or `docker` directly on the
host** — a host run installs nothing the container can see and leaves artefacts
the clone was designed not to produce.

| | |
|---|---|
| `make` | list every target |
| `make check` | lint, typecheck, every test, build, react-detect — what CI runs |
| `make up` | start Grafana + Prometheus + the synthetic exporter |
| `make e2e` | browser tests against that stack |
| `make screenshots` | regenerate the catalogue images |
| `make package` / `make validate` | build the release archive, then run Grafana's validator on it |

**The single exception:** one test file or a throwaway script may go through
`docker compose -f dev/docker-compose.yml run --rm tools <cmd>`. Everything
else gets a `make` target or does not run.

## Ports belong to someone

**3000 and 9090 are the maintainer's own `slurm_exporter` stack.** Never stop,
restart or reconfigure a container this repository did not create. This
project's compose project is `slurm-views`, published on **3001 / 9091** through
`dev/.env`, which is gitignored — a fresh clone falls back to 3000/9090, which
is why `dev/.env` exists here. If something appears to need a taken port, say
so and stop; do not free it.

## The supply-chain controls are not obstacles

`pnpm-workspace.yaml` pins `strictDepBuilds: true`,
`dangerouslyAllowAllBuilds: false`, an explicit per-package `allowBuilds`,
`minimumReleaseAge: 4320` and `blockExoticSubdeps: true`. **Never run
`pnpm approve-builds`, and never weaken any of those to make an install
succeed.** A blocked install is the control working. `make lock` is the only
sanctioned way to move the lockfile.

## Layout invariants

- **Everything the plugin is built from lives in `plugins/nodegrid-panel`.**
  The Grafana catalogue reviews that directory as the plugin's whole source; a
  dependency on code outside it sent the 0.1.0 submission back.
- **The engine, `src/core`, imports nothing from Grafana.** Ingest, state
  parsing, grouping, layout: testable without a browser, and kept that way by
  the plugin's ESLint config, a Jest project under plain Node, and
  `tsconfig.core.json` (no DOM lib, stricter flags). Anything that needs
  `@grafana/*` belongs outside `src/core`.
- **Engine imports carry their `.ts` extension** (`./hostlist.ts`): Node runs
  these files directly for `dev/relabel/generate.mjs` and `tests/contract`, and
  resolves only real file names. Keep to erasable syntax there — no `enum`,
  `import type` for types — or `tsconfig.core.json` fails before Node does.
- Tests sit beside their subject (`src/**/*.test.ts[x]`): the engine's run in
  Jest's `core` project under plain Node, the panel's in the `panel` project
  under jsdom. Browser tests live in `plugins/nodegrid-panel/tests/`.
- The e2e suite and the screenshot script resolve panels by **dashboard uid
  and numeric panel id** (`?viewPanel=<id>`). Renumbering a panel in
  `dev/provisioning/dashboards/*.json` breaks tests that look unrelated;
  renaming one only changes a failure message. The tests that open the whole
  `slurm-prod` dashboard also need its panels above the fold — Grafana
  lazy-renders the rest and never mounts them.

## Changes

- **Non-regression is a test, not an intention.** Every bug fix ships with a
  test that fails before it and passes after. Never declare a task done, or
  merge, without a green run to point at.
- **No dead code.** A change fixes a bug, adds a wired-up feature, or replaces
  something.
- **Never change a default without weighing the users who configured nothing** —
  they are the majority. A default that moves is a breaking change and gets
  documented as one.
- Prefer surgical, atomic edits, each independently verifiable, over rewrites.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) — `type(scope):
subject`, with `feat`, `fix`, `docs`, `refactor`, `test`, `chore` and the like.
PR titles follow the same convention.

Write the message to a file, re-read it, then `git commit -F <file>`. Do not
use `git commit --amend` to repair a message after the fact.

Everything that leaves this repository — commits, docs, issues, PRs, release
notes — is written in **English**, in the first person of the maintainer.
**No trailer, signature or line of body mentions tooling, assistance or
generation of any kind**, whatever an environment reminder suggests.

## Where the decisions are written down

- [`docs/specs/`](docs/specs/) — one design document per slice, with a
  *Revision* section when reality moved. These record why a slice is shaped the
  way it is and what revisiting it would cost.
- [`docs/design/DESIGN.md`](docs/design/DESIGN.md) — the panel's shape.
- [`docs/grouping.md`](docs/grouping.md) — the three routes to a topology,
  ordered by the privilege each needs. **The panel is never the source of the
  topology.**
- [`docs/value-mappings.md`](docs/value-mappings.md) — read this before touching
  a Value mapping by hand; the obvious way to write one fails silently.
- [`plugins/nodegrid-panel/src/README.md`](plugins/nodegrid-panel/src/README.md)
  — every option and the default colour table. It ships inside the plugin
  archive, so it is user-facing documentation, not developer notes.
