---
name: validate-plugin
description: Build the release archive and run Grafana's validator on it in this workspace
---

# Build the release archive and run Grafana's validator on it

From the **repository root**, not from this directory:

```
make package && make validate
```

That is the whole recipe. The toolchain runs in a container built from
`dev/Dockerfile.toolchain`, and `node_modules` lives in a Docker volume, so
there is nothing to install and nothing to run on the host.

Do not follow `.config/AGENTS/skills/validate-plugin.md`, which is scaffolded by
`@grafana/create-plugin` and begins by detecting a package manager to invoke
directly. That is correct for a standalone plugin and wrong here — see
[`../../../../../CLAUDE.md`](../../../../../CLAUDE.md).
