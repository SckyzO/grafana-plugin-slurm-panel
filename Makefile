# Every target below runs inside a container. Docker and make are the only two
# things this repository expects to find on the machine: no Node, no pnpm, no
# browser, and no node_modules on the host. `make check` on a fresh clone is
# the whole contract.

COMPOSE := docker compose -f dev/docker-compose.yml

# The toolchain image is built for the caller's ids so that what the container
# writes into the bind-mounted source tree — dist/, playwright-report/ — comes
# back owned by them and not by root. Exported because compose reads them.
export UID := $(shell id -u)
export GID := $(shell id -g)

RUN := $(COMPOSE) run --rm tools

.DEFAULT_GOAL := help
.PHONY: help image deps install lock build watch test lint typecheck react-detect \
        check scrape e2e up down restart logs logs-once shell screenshots package sign \
        validate clean

help: ## Show this help
	@awk 'BEGIN { FS = ":.*## "; print "Targets:\n" } \
	     /^[a-z][a-z-]*:.*## / { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

image: ## Build the toolchain image
	$(COMPOSE) build tools

# Bring node_modules in the named volume up to the lockfile. Cheap when it
# already matches, and it is why a fresh clone can run any target directly
# instead of having to know to install first.
deps:
	@$(RUN) pnpm install --frozen-lockfile

install: ## Install dependencies into the node_modules volume
	$(RUN) pnpm install --frozen-lockfile

lock: ## Update pnpm-lock.yaml after editing a package.json
	@# Every other target installs with --frozen-lockfile, which is what makes
	@# a build reproducible and what lets CI verify the lockfile against the
	@# supply-chain policies. Changing a manifest therefore needs this target
	@# once, deliberately, and the resulting lockfile change is reviewed like
	@# any other diff.
	$(RUN) pnpm install --no-frozen-lockfile

build: deps ## Build every workspace package
	$(RUN) pnpm build

watch: deps ## Rebuild the panel on change (Grafana picks it up live)
	$(RUN) pnpm --filter tomzone-slurm-panel dev

test: build ## Run the unit and contract tests
	@# A contract test that asserts the behaviour of a built artifact needs the
	@# artifact: depending on `build` rather than `deps` is what stops this
	@# target from passing quietly against yesterday's dist/.
	$(RUN) pnpm test

lint: deps ## Lint
	$(RUN) pnpm lint

typecheck: deps ## Typecheck
	$(RUN) pnpm typecheck

react-detect: build ## Check the panel for React 19 incompatibilities
	@# Read the output rather than the verdict. The tool prints "Failed to load
	@# dependencies / expected a single document in the stream, but found more"
	@# and then carries on to announce good news: pnpm 12 writes pnpm-lock.yaml
	@# as a two-document YAML stream and react-detect's parser accepts only one,
	@# so the dependency half of the scan does not run. What it does still check
	@# — this plugin's own source and bundle, for defaultProps, ReactDOM.render,
	@# findDOMNode and jsx-runtime imports — is the half that is ours to fix.
	@# The warning is deliberately left visible so the gap closes loudly when
	@# either side gains support for the other.
	$(RUN) sh -c 'cd plugins/nodegrid-panel && pnpm exec react-detect'

check: lint typecheck test build react-detect ## Everything CI runs before e2e

scrape: build ## Generate the Prometheus scrape config from dev/relabel/racks.txt
	@# Running the generator here is what keeps it from being dead code: it is
	@# exercised on every `make up` rather than illustrated in a README, and it
	@# is what lets the dev stack demonstrate the rung it recommends first.
	@mkdir -p dev/prometheus/scrape
	$(RUN) node dev/relabel/generate.mjs dev/relabel/racks.txt slurm_exporter synthetic-exporter:9341 \
	  > dev/prometheus/scrape/nodes.yml
	@# The file is bind-mounted, so a running Prometheus sees no container
	@# change to act on and would keep serving the previous config. A stale
	@# fixture that looks like a panel bug is the worst kind. Silence is right
	@# for a cold start, which `make up` always hits: exit 7 when the container
	@# is down, and exit 6 when the name does not resolve at all — which is
	@# what CI sees, because `scrape` runs before `up` creates the network.
	@# Wrong when Prometheus is running and rejects the regenerated config,
	@# which stays silent identically without this check.
	@$(RUN) sh -c '\
	    curl -sf -X POST http://prometheus:9090/-/reload >/dev/null 2>&1; \
	    code=$$?; \
	    [ "$$code" -eq 0 ] || [ "$$code" -eq 6 ] || [ "$$code" -eq 7 ] || \
	      echo "warning: Prometheus rejected the scrape config reload (curl exit $$code) - it may be serving a stale config until it does" >&2; \
	    exit 0' || true

up: scrape ## Start Grafana, Prometheus and the synthetic exporter
	$(COMPOSE) up -d --build grafana prometheus synthetic-exporter
	@# Grafana answers on the network well before it answers on HTTP. Waiting
	@# here, rather than in the e2e target or in CI, is what makes `make e2e`
	@# mean the same thing on a laptop as on a runner.
	@$(RUN) sh -c 'for _ in $$(seq 1 90); do \
	    curl -sf http://grafana:3000/api/health >/dev/null && exit 0; \
	    sleep 1; \
	  done; echo "Grafana never became healthy" >&2; exit 1'
	@# Grafana being healthy does not mean there is anything to draw, so the
	@# probes below ask the questions the dashboards ask: run one of their
	@# queries, through Grafana, and wait until it comes back with data in
	@# it — once per datasource, because each is a separate plugin on the same
	@# registry. Three separate things have to be true for the first, and each
	@# one of them has produced a flake here:
	@#
	@#   - Prometheus has scraped at least once;
	@#   - the provisioned datasource exists;
	@#   - Grafana has registered the Prometheus datasource *plugin* — it
	@#     answers /api/health and the datasource API well before this, and in
	@#     that window every query fails with "Could not find plugin definition
	@#     for data source", which reaches the panel as no frames at all and
	@#     draws as "No nodes".
	@#
	@# Waiting on the query rather than on the three parts is what keeps this
	@# honest: any fourth thing that has to be true is covered too. These
	@# dashboards all refresh every 30s, so an empty first render eventually
	@# heals on a screen — but a test asserting inside 15s has already failed.
	@$(RUN) sh -c 'for _ in $$(seq 1 90); do \
	    curl -sf -u admin:admin -H "Content-Type: application/json" -X POST \
	      http://grafana:3000/api/ds/query \
	      -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"prometheus\",\"uid\":\"slurm-views-prom\"},\"expr\":\"slurm_node_status\",\"instant\":true,\"format\":\"table\"}],\"from\":\"now-5m\",\"to\":\"now\"}" \
	      2>/dev/null | grep -q "\"node\"" && exit 0; \
	    sleep 1; \
	  done; echo "Grafana never answered a node query - see: make logs-once" >&2; exit 1'
	@# And again for TestData, which is a different plugin on the same
	@# registry and gets registered on its own schedule. Four panels of the
	@# grouping dashboard read a CSV from it and nothing else, so until it
	@# answers they draw no cells at all — which is what took down the 12.4
	@# leg while the five others passed.
	@$(RUN) sh -c 'for _ in $$(seq 1 90); do \
	    curl -sf -u admin:admin -H "Content-Type: application/json" -X POST \
	      http://grafana:3000/api/ds/query \
	      -d "{\"queries\":[{\"refId\":\"A\",\"datasource\":{\"type\":\"grafana-testdata-datasource\",\"uid\":\"slurm-views-testdata\"},\"scenarioId\":\"csv_content\",\"csvContent\":\"probe\\n1\"}],\"from\":\"now-5m\",\"to\":\"now\"}" \
	      2>/dev/null | grep -q "\"probe\"" && exit 0; \
	    sleep 1; \
	  done; echo "Grafana never answered a TestData query - see: make logs-once" >&2; exit 1'
	@# What that query cannot prove is the one thing it was once claimed to:
	@# /api/ds/query never touches the panel plugin. Grafana scans plugins
	@# after it starts serving, and until tomzone-slurm-panel is registered a
	@# dashboard draws "Panel plugin not found" — no grid in the DOM at all,
	@# which is how this surfaced: two tests failing on the slowest image in
	@# the matrix while the same commit passed on the five others.
	@$(RUN) sh -c 'for _ in $$(seq 1 90); do \
	    curl -sf -u admin:admin http://grafana:3000/api/plugins/tomzone-slurm-panel/settings \
	      2>/dev/null | grep -q "\"id\":\"tomzone-slurm-panel\"" && exit 0; \
	    sleep 1; \
	  done; echo "Grafana never registered the panel plugin - see: make logs-once" >&2; exit 1'
	@# Asked of compose rather than hardcoded: the published port is
	@# ${GRAFANA_PORT:-3000}, and a message that names the wrong one is
	@# worse than no message.
	@echo "Grafana is up on http://localhost:$$($(COMPOSE) port grafana 3000 | sed 's/.*://')"

down: ## Stop the stack, keeping the volumes
	$(COMPOSE) down

restart: down up ## Recreate the stack

logs: ## Follow Grafana's logs
	$(COMPOSE) logs -f grafana

logs-once: ## Print Grafana's logs and exit (used by CI on failure)
	$(COMPOSE) logs grafana

e2e: up ## Run the browser tests against the running stack
	$(RUN) pnpm e2e

shell: deps ## Open a shell in the toolchain container
	$(RUN) bash

screenshots: up ## Regenerate the catalogue screenshots from the dev stack
	@# Committed images, regenerated by a script rather than taken by hand:
	@# a hand-made screenshot drifts away from the panel the first time the
	@# panel changes, and nobody can tell by looking. They are declared in
	@# plugin.json, which is what makes the build copy them into dist/.
	$(RUN) node plugins/nodegrid-panel/scripts/screenshots.mjs

sign: build ## Sign dist/ (needs GRAFANA_ACCESS_POLICY_TOKEN in the environment)
	@# Deliberately not part of `package`. Signing is the one step that speaks
	@# to Grafana as you, and until Grafana has reviewed a first submission and
	@# granted a signature level it answers "Field is required: rootUrls" —
	@# which is expected, not a failure to work around. A first submission is
	@# allowed to be unsigned; every version after it is not.
	@[ -n "$$GRAFANA_ACCESS_POLICY_TOKEN" ] || { \
	  echo "GRAFANA_ACCESS_POLICY_TOKEN is not set - see dev/README.md" >&2; exit 1; }
	$(COMPOSE) run --rm -e GRAFANA_ACCESS_POLICY_TOKEN tools \
	  pnpm --filter tomzone-slurm-panel sign

package: build ## Package dist/ as the archive a release publishes, with its SHA1
	@# The archive holds exactly one top-level directory, named after the
	@# plugin id: that is what Grafana unpacks into its plugins directory, and
	@# the validator rejects any other shape. The version comes from
	@# package.json rather than from a tag, so a tag that disagrees with it is
	@# caught before a release is public rather than after.
	@#
	@# Run `make sign` first when signing: it writes MANIFEST.txt into dist/,
	@# and a manifest added after the zip is built is a manifest nobody ships.
	@#
	@# The name is written to .artifacts/zipname because it carries the
	@# version, and both `validate` below and the release workflow need to
	@# name the file without recomputing how it is spelled.
	$(RUN) sh -c 'cd plugins/nodegrid-panel \
	  && version=$$(node -p "require(\"./package.json\").version") \
	  && name="tomzone-slurm-panel-$$version.zip" \
	  && rm -rf .artifacts tomzone-slurm-panel \
	  && mkdir -p .artifacts \
	  && cp -r dist tomzone-slurm-panel \
	  && zip -qr ".artifacts/$$name" tomzone-slurm-panel \
	  && rm -rf tomzone-slurm-panel \
	  && (cd .artifacts && sha1sum "$$name" > "$$name.sha1") \
	  && printf %s "$$name" > .artifacts/zipname \
	  && echo "packaged plugins/nodegrid-panel/.artifacts/$$name"'

validate: package ## Run Grafana's official plugin validator on that archive
	@# On the archive a release would publish, not on a different one built
	@# for the occasion: validating something other than what ships proves
	@# nothing about what ships.
	$(COMPOSE) run --rm validator "/archive/$$(cat plugins/nodegrid-panel/.artifacts/zipname)"

clean: ## Remove the stack, the node_modules volumes and the build output
	$(COMPOSE) down -v --remove-orphans
	rm -rf plugins/nodegrid-panel/dist plugins/nodegrid-panel/.artifacts \
	       plugins/nodegrid-panel/playwright-report plugins/nodegrid-panel/test-results \
	       packages/core/dist coverage
