# Segment Reporting - developer convenience targets.
#
# This Makefile only wraps the underlying dotnet/npm/properdocs/script commands;
# CI (.github/workflows/build.yml) invokes those commands directly, so the
# Makefile can never silently drift the build. Run `make help` for the list.
#
# Bruno API tests, fuzzing, leak detection, and the UAT Emby harness arrive as
# `make bruno|fuzz|leak-check|uat-up|uat-down` alongside the #106 Phase 2/3 work,
# so their targets ship with the scripts they drive (not before).

SLN := Segment_Reporting.sln
NPM_PREFIX := segment_reporting

.DEFAULT_GOAL := help

.PHONY: help restore build build-release test format format-check lint gate \
        hooks hooks-install docs docs-deps docs-serve screenshots clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

restore: ## Restore NuGet dependencies
	dotnet restore $(SLN)

build: ## Build the solution (Debug)
	dotnet build $(SLN)

build-release: ## Build Release (minifies JS; requires Node)
	dotnet build $(SLN) --configuration Release

test: ## Run the xUnit test suite
	dotnet test $(SLN)

format: ## Apply code formatting in place
	dotnet format $(SLN)

format-check: ## Verify formatting without changes (matches CI)
	dotnet format $(SLN) --verify-no-changes

lint: ## Lint the page JavaScript
	npm run lint:js --prefix $(NPM_PREFIX)

gate: ## Full CI-parity pre-push gate (build + format + lint)
	bash scripts/pre-push-gate.sh

hooks: ## Verify git hooks are wired to lefthook
	bash scripts/check-hooks.sh

hooks-install: ## Install the lefthook git hooks
	npx --prefix $(NPM_PREFIX) lefthook install && node $(NPM_PREFIX)/scripts/fix-hooks.mjs

docs-deps: ## Install the docs toolchain (ProperDocs, see dev-requirements.txt)
	pip install -r dev-requirements.txt

docs: ## Build the docs site (strict)
	properdocs build --strict

docs-serve: ## Serve the docs locally with live reload
	properdocs serve

screenshots: ## Capture + anonymize page screenshots (needs running Emby + .env)
	node scripts/capture-screenshots.mjs

clean: ## Remove build output and the generated docs site
	dotnet clean $(SLN) || true
	find . -type d \( -name bin -o -name obj \) -exec rm -rf {} + 2>/dev/null || true
	rm -rf site
