# Contributing

## Toolchain

**Docker and make. Nothing else.** No Node, no pnpm, no browser and no
`node_modules` on your machine. Every command in this repository runs inside
the image built from [`dev/Dockerfile.toolchain`](dev/Dockerfile.toolchain),
and a fresh clone is expected to go straight to `make check` on a machine that
has never seen this project.

That image pins what it uses, each to an exact version:

| | | |
|---|---|---|
| Node | `24.21.0` | the active LTS line, and the major `@grafana/create-plugin` scaffolds against |
| pnpm | `12.4.1` | must equal `package.json#packageManager`, or pnpm refuses to run |
| Chromium | the build shipped with Playwright `1.63.0` | must equal the `@playwright/test` version `pnpm-lock.yaml` resolves |

The `FROM` line in the Dockerfile is the single source of truth for the Node
version; `.nvmrc` carries the major for editors and nothing on the host gets a
say. Bump any of the three deliberately, in its own commit, and say why.

`node_modules` lives in named Docker volumes, one per workspace package, not
in the checkout. The host stays clean, and on WSL2 the install is an order of
magnitude faster for not crossing the 9p bridge. The cost is real and worth
naming: your editor cannot resolve types from a directory that is not there.
`make shell` opens a shell inside the container when you need one.

The pnpm version is not arbitrary. `pnpm-workspace.yaml` carries this
project's supply-chain controls (`strictDepBuilds`, `minimumReleaseAge`,
`blockExoticSubdeps`, `allowBuilds`), and pnpm below 11 silently ignores all
of them rather than erroring: an install under pnpm 10 succeeds without any of
the protections it appears to configure. Pinning the version in the image is
what stops that from depending on what a contributor happens to have.

## Working on it

```bash
make check   # lint, typecheck, every test, build, React 19 scan — what CI runs
make up      # Grafana on http://localhost:3000 with the panel loaded
make e2e     # Playwright against that stack
make watch   # rebuild the panel on change; Grafana picks it up live
make shell   # a shell inside the toolchain container
make clean   # drop the stack, the volumes and the build output
```

Adding or bumping a dependency means editing the `package.json` and then
running `make lock` once — every other target installs with
`--frozen-lockfile`, which is what makes a build reproducible and what lets CI
check the lockfile against the supply-chain policies.

`make` with no target lists them all. `make e2e` builds the plugin, starts the
stack and waits for Grafana to answer before it runs a test, so there is no
separate setup step and nothing CI does that you do not.

Do not run `pnpm` on the host — not to work around a slow container, not for
your editor. The moment a command needs a toolchain the image does not have,
that belongs in the image.

CI (`.github/workflows/ci.yml`) builds the same image and runs the same `make`
targets. It installs no Node of its own, deliberately: a second toolchain is
the thing that drifts.

## Where the design decisions are written down

Three design documents in `docs/specs/`, one per slice, each written
before its code and each answering *why* rather than *what*:

| | |
|---|---|
| `2026-09-12-slurm-node-grid-design.md` | The panel itself: what a cell is, where colour comes from, why the plugin hardcodes none of it |
| `2026-09-15-node-grouping-design.md` | How a node finds its group. Three routes separated by the privilege each needs — Prometheus relabelling, a join transformation, a declared range table — and why the panel is never the source of the topology |
| `2026-09-16-blade-density-design.md` | Several nodes in one cabinet slot, and why a blade here is a count rather than a shape |

Read the relevant one before changing behaviour it covers. They record the
alternatives that were rejected and what it would cost to revisit them, which is
the part that does not survive in the code.

## Why `packages/core` imports nothing from Grafana

`@grafana/data` touches `window` and `document` at import time and throws
under plain Node — there is no way to import it outside a DOM. Keeping the
engine (ingest, state parsing, grouping) free of any Grafana import is what
lets its tests run under plain Node with nothing more than `jest`, no browser
and no Grafana instance, and it is what keeps the panel itself thin: the
panel package translates a `DataFrame` into the engine's plain structural
types and translates the result back into React, and does nothing else that
the engine could have done for it. If a change to `packages/core` needs
anything from `@grafana/data`, `@grafana/ui` or `@grafana/runtime`, that
logic belongs in the panel package instead.

## Bug fixes need a regression test

A bug fix lands with a test that fails against the code before the fix and
passes after it. Writing the fix first and the test after tends to produce a
test that only exercises the fixed behaviour, which proves nothing about the
bug it was meant to catch — run the new test against the pre-fix code and
confirm it fails before committing either.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope):
subject`, with `feat`, `fix`, `docs`, `refactor`, `test` and `chore` the
types in use here, e.g. `fix(panel): compute NodeCell's mapped state from
percent, not text`. Scope names the workspace or area affected (`panel`,
`core`, `e2e`, `dev`) and is omitted when a change is repo-wide.

## The dev stack's Grafana version is pinned, not floating

`dev/.env` and CI pin `GRAFANA_VERSION` to an exact tag. `docker compose up
-d` does not recreate a container whose image tag it already has running, so
a floating `:latest` silently keeps whatever version happened to be pulled
first — it does not track new releases the way the tag name implies. Bump
`GRAFANA_VERSION` deliberately, in its own commit, and say in the message
which version and why.

## The supply-chain controls stay as configured

`pnpm-workspace.yaml`'s `strictDepBuilds`, `minimumReleaseAge`,
`blockExoticSubdeps` and `allowBuilds` are not defaults left over from
scaffolding — they were chosen deliberately and are checked in CI. Each
`false` entry under `allowBuilds` is a recorded decision that a specific
package does not get to run its install scripts, not a placeholder; nothing
here is approved to build. If a dependency's install fails because of one of
these controls, that is the control doing its job. Fix the underlying cause
— pin an older release that clears `minimumReleaseAge`, find an alternative
package, or bring a specific, justified exception to review — rather than
loosening the setting to make the install succeed.
