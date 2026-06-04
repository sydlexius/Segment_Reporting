# Segment Reporting - developer convenience targets.
#
# This Makefile only wraps the underlying dotnet/npm/properdocs/script commands;
# CI (.github/workflows/build.yml) invokes those commands directly, so the
# Makefile can never silently drift the build. Run `make help` for the list.
#
# The UAT Emby harness ships here as `make uat-deploy|uat-seed|uat-test|bruno|
# uat-clean|uat` (Phase 2, #106) driving scripts/uat/*. SharpFuzz fuzzing of the
# pure SQL validators runs in a short-lived Linux container via `make fuzz`
# (bounded) / `make fuzz-deep` (unbounded) driving scripts/fuzz/*; both are
# local-only manual gates and never run in CI or a git hook.

SLN := Segment_Reporting.sln
NPM_PREFIX := segment_reporting

.DEFAULT_GOAL := help

.PHONY: help restore build build-release test format format-check lint gate \
        hooks hooks-install docs docs-deps docs-serve screenshots clean \
        uat-deploy uat-seed uat-test bruno uat-clean uat uat-concurrency \
        fuzz fuzz-deep

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

uat-deploy: ## UAT: build + docker cp the DLL into the UAT container, restart
	bash scripts/uat/deploy.sh

uat-seed: ## UAT: generate media, create libraries, sync, set markers (idempotent)
	bash scripts/uat/seed.sh

uat-test: ## UAT: run the Bruno API assertions against UAT (reads apiKey from .env)
	cd bruno-tests/segment-reporting-api && npx --yes @usebruno/cli run --env Local \
		--env-var "apiKey=$$(grep -E '^EMBY_UAT_API_KEY=' ../../.env | head -1 | cut -d= -f2- | tr -d '\r\"')"

bruno: uat-test ## UAT: alias for uat-test

uat-concurrency: ## UAT: stress SegmentRepository lock ordering (#66) with concurrent API requests
	bash scripts/uat/concurrency.sh

uat-clean: ## UAT: remove synthetic libraries/media, reset Local.bru IDs
	bash scripts/uat/clean.sh

uat: uat-deploy uat-seed uat-test ## UAT: full chain (deploy -> seed -> test)

FUZZ_IMAGE := segment-reporting-fuzz

fuzz: ## Fuzz the pure validators in Docker (local-only; bounded 60s/target)
	@echo "Local manual gate: builds + runs SharpFuzz inside a Linux container."
	docker build -t $(FUZZ_IMAGE) -f scripts/fuzz/Dockerfile .
	docker run --rm -e MAX_TOTAL_TIME=60 -v "$(CURDIR)":/src $(FUZZ_IMAGE)

fuzz-deep: ## Fuzz unbounded in Docker (deliberate sessions; Ctrl-C to stop)
	@echo "Local manual gate: unbounded SharpFuzz campaign inside a Linux container."
	docker build -t $(FUZZ_IMAGE) -f scripts/fuzz/Dockerfile .
	docker run --rm -e MAX_TOTAL_TIME=0 -v "$(CURDIR)":/src $(FUZZ_IMAGE)
