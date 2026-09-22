# Build the plugin

From the **repository root**, not from this directory:

```
make build
```

That is the whole recipe. The toolchain runs in a container built from
`dev/Dockerfile.toolchain`, and `node_modules` lives in a Docker volume, so
there is nothing to install and nothing to run on the host.

Do not follow `.config/AGENTS/skills/build-plugin.md`, which is scaffolded by
`@grafana/create-plugin` and begins by detecting a package manager to invoke
directly. That is correct for a standalone plugin and wrong here — see
[`../../../../../CLAUDE.md`](../../../../../CLAUDE.md).
