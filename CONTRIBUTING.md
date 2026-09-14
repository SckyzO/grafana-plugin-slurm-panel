# Contributing

## Toolchain

Node >= 22, pnpm >= 11.0.0 — both enforced by `package.json#engines` and
`packageManager`.

The pnpm floor is not arbitrary: `pnpm-workspace.yaml` carries this project's
supply-chain controls (`strictDepBuilds`, `minimumReleaseAge`,
`blockExoticSubdeps`, `allowBuilds`), and pnpm below 11 silently ignores all
of them rather than erroring. An install under pnpm 10 succeeds without any
of the protections it appears to configure. Use `corepack prepare
pnpm@12.4.1 --activate` (or `npm install -g pnpm@12.4.1` if corepack refuses)
rather than whatever pnpm your system already has.

## Working on it

```bash
pnpm install
pnpm test    # unit + contract tests across every workspace
pnpm build   # packages/core, then the plugin bundle
pnpm e2e     # Playwright, against a running dev stack
```

`pnpm e2e` needs the dev stack up first — see [`dev/README.md`](dev/README.md)
for `docker compose -f dev/docker-compose.yml up -d --build`. CI does this
for you (`.github/workflows/ci.yml`); locally, run the stack, then `pnpm e2e`
from the repository root or `pnpm --filter tomzone-slurmnodegrid-panel e2e`.

`pnpm lint` and `pnpm typecheck` run across the whole workspace and are part
of CI; run them before opening a pull request.

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
