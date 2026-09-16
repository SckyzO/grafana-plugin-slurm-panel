# tomzone-slurm-panel

One cell per Slurm node. The panel's own documentation — what it draws, the
options it takes, and the data it expects — is [`src/README.md`](src/README.md),
which is the file that ships inside `dist/` and is what Grafana shows in its
plugin catalogue. Edit that one when the panel's behaviour changes.

## Building and testing it

From the repository root, and only from there:

```bash
make check   # lint, typecheck, tests, build
make up      # Grafana on http://localhost:3000 with this panel loaded
make e2e     # Playwright against that stack
```

The scaffold's own `pnpm server` flow is deliberately not wired up here, and
neither is the `docker-compose.yaml` it ran: that stack publishes Grafana on a
port this repository does not control, and `extends` concatenates port lists
rather than replacing them, so it could not be moved out of the way either.
`make up` at the root is the only way to run this panel.

Everything runs inside the toolchain container. There is no `pnpm install`
step and no `node_modules` in this directory — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for how the toolchain is pinned and
why, and [`dev/README.md`](../../dev/README.md) for the stack itself.

Signing and distribution are not set up: this plugin is unsigned and is loaded
by the dev stack through `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`.
