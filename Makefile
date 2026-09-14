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
.PHONY: help image deps install build watch test lint typecheck react-detect \
        check e2e up down restart logs logs-once shell validate clean

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

build: deps ## Build every workspace package
	$(RUN) pnpm build

watch: deps ## Rebuild the panel on change (Grafana picks it up live)
	$(RUN) pnpm --filter tomzone-slurmnodegrid-panel dev

test: deps ## Run the unit and contract tests
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
	$(RUN) sh -c 'cd plugins/nodegrid-panel && npx --yes @grafana/react-detect@latest'

check: lint typecheck test build react-detect ## Everything CI runs before e2e

up: build ## Start Grafana, Prometheus and the synthetic exporter
	$(COMPOSE) up -d --build grafana prometheus synthetic-exporter
	@# Grafana answers on the network well before it answers on HTTP. Waiting
	@# here, rather than in the e2e target or in CI, is what makes `make e2e`
	@# mean the same thing on a laptop as on a runner.
	@$(RUN) sh -c 'for _ in $$(seq 1 90); do \
	    curl -sf http://grafana:3000/api/health >/dev/null && exit 0; \
	    sleep 1; \
	  done; echo "Grafana never became healthy" >&2; exit 1'
	@echo "Grafana is up on http://localhost:3001"

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

validate: build ## Run Grafana's official plugin validator
	$(RUN) sh -c 'cd plugins/nodegrid-panel \
	  && rm -rf .artifacts tomzone-slurmnodegrid-panel \
	  && mkdir -p .artifacts \
	  && cp -r dist tomzone-slurmnodegrid-panel \
	  && zip -qr .artifacts/plugin.zip tomzone-slurmnodegrid-panel \
	  && rm -rf tomzone-slurmnodegrid-panel'
	docker run --rm --pull=always \
	  -v "$(CURDIR)/plugins/nodegrid-panel/.artifacts/plugin.zip:/archive.zip:ro" \
	  grafana/plugin-validator-cli /archive.zip

clean: ## Remove the stack, the node_modules volumes and the build output
	$(COMPOSE) down -v --remove-orphans
	rm -rf plugins/nodegrid-panel/dist plugins/nodegrid-panel/.artifacts \
	       plugins/nodegrid-panel/playwright-report plugins/nodegrid-panel/test-results \
	       packages/core/dist coverage
