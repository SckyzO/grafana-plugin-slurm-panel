# tomzone-slurm-panel

One cell per Slurm node. The panel's own documentation — what it draws, the
options it takes, and the data it expects — is [`src/README.md`](src/README.md),
which is the file that ships inside `dist/` and is what Grafana shows in its
plugin catalogue. Edit that one when the panel's behaviour changes.

## Building and testing it

From the repository root, and only from there:

```bash
make check   # lint, typecheck, tests, build
make up      # Grafana on http://localhost:3001 with this panel loaded
make e2e     # Playwright against that stack
```

Everything runs inside the toolchain container. There is no `pnpm install`
step and no `node_modules` in this directory — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for how the toolchain is pinned and
why, and [`dev/README.md`](../../dev/README.md) for the stack itself.

Signing and distribution are not set up: this plugin is unsigned and is loaded
by the dev stack through `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`.
