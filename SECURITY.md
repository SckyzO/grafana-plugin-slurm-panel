# Security policy

## Reporting a vulnerability

Please report privately through GitHub's
[security advisory form](https://github.com/SckyzO/grafana-plugin-slurm-panel/security/advisories/new)
rather than opening an issue. I will acknowledge within a few days and tell
you what I intend to do about it; if I disagree that something is a
vulnerability, I will say so and why rather than let it go quiet.

A dashboard JSON that reproduces the problem is the single most useful thing
you can attach. Almost everything this panel does is decided by its options,
so the configuration usually *is* the reproduction.

## What this plugin is, in security terms

It is a **frontend-only panel plugin**. It ships no backend, runs no server
code, stores nothing, and reads nothing but the query results Grafana hands
it. It holds no credentials and asks for no permissions beyond rendering.

That narrows the interesting surface to what it does with untrusted input:

- **Query results** — node names, states and label values come from whatever
  data source the dashboard points at. They reach the DOM as text and as
  attributes.
- **Panel options** — the grouping key, the range and blade tables, the
  capture pattern and the data link are typed by whoever can edit the
  dashboard, and the data link can name a dashboard variable, which anyone
  who can *view* the dashboard can set from the query string.

Both are in scope. A report showing either one reaching script execution, or
a panel option that lets a viewer do something an editor should have had to
do, is a vulnerability.

## What is out of scope

**The development stack under `dev/` is deliberately open and is not a
deployment.** It exists so that `make up` gives a contributor a working
cluster in one command, and it makes trades no real installation should:

- Grafana grants the **Admin** role to the anonymous user
  (`GF_AUTH_ANONYMOUS_ENABLED`, `GF_AUTH_ANONYMOUS_ORG_ROLE: Admin`), so
  `/api/org` and `/api/datasources` answer without credentials.
- Both Grafana and Prometheus **publish on all interfaces**, IPv4 and IPv6,
  which is what lets a browser on the host reach a container under WSL2.
- Prometheus serves its **admin endpoints**; `POST /-/reload` returns 200.

None of this is a finding — it is written down in `dev/README.md` and it only
runs while you run it. Reports about the dev stack are welcome as ordinary
issues, not as advisories.

Also out of scope: the Grafana version the dev stack pins, which moves with
dependabot, and `slurm_exporter`, which has
[its own repository](https://github.com/SckyzO/slurm_exporter).

## Supported versions

The latest release. This plugin is young enough that there is nothing else to
support; when that changes, this section will say so.
