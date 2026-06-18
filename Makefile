# wordsmash — local dev + test orchestration.
# Requires: foundry (anvil/forge), node, jq. `make help` lists targets.

SHELL := /bin/bash
RPC ?= http://localhost:8545
# Default anvil account #0 (public dev key — LOCAL ONLY).
ANVIL_PK := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

.PHONY: help install merkle test test-contracts test-shared test-indexer \
        chain deploy seed indexer-dev web-dev dev slither abis clean

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install all JS deps + Foundry libs
	cd shared && npm install
	cd indexer && npm install
	cd web && npm install
	cd contracts/tools && npm install
	cd contracts && forge install

merkle: ## Build whitelist Merkle root + proofs from the address list (HUMAN TASK: the list)
	cd contracts/tools && node merkle.mjs

abis: ## Regenerate shared ABIs from compiled contracts
	cd contracts && ./tools/gen-abis.sh

## ─── Tests ──────────────────────────────────────────────────────────────────
test: test-shared test-contracts test-indexer ## Run the whole suite (shared + contracts + indexer)
	@echo "✅ all suites passed"

test-shared: ## TS normalization cross-parity tests
	cd shared && npm test

test-contracts: ## Foundry unit + invariant + parity tests
	cd contracts && forge test -vv

test-indexer: ## Indexer unit tests (idempotency, reorg, reconciliation, API)
	cd indexer && npm test

slither: ## Static analysis (requires `pip install slither-analyzer`)
	cd contracts && slither . --config-file slither.config.json

## ─── Local end-to-end stack ──────────────────────────────────────────────────
chain: ## Start a local anvil node (foreground)
	anvil

deploy: ## Deploy contracts to local anvil + write shared/deployments/anvil.json
	mkdir -p shared/deployments
	cd contracts && DEPLOYER_PRIVATE_KEY=$(ANVIL_PK) \
		forge script script/Deploy.s.sol:Deploy --rpc-url $(RPC) --broadcast

seed: ## Seed demo on-chain data (claims, a listing, a sale) on local anvil
	cd contracts && forge script script/Seed.s.sol:Seed --rpc-url $(RPC) --broadcast

seed-social: ## Seed demo off-chain social data (profiles, comments, watchlist) via the indexer API
	cd contracts/tools && node seed-social.mjs

indexer-dev: ## Apply schema to local D1 + run the indexer Worker (wrangler dev)
	cd indexer && npx wrangler d1 execute wordsmash --local --file=./schema.sql && npx wrangler dev --port 8787

web-dev: ## Run the frontend (Vite). Set web/.env first (VITE_USE_ANVIL=1 for local).
	cd web && npm run dev

e2e: ## Playwright end-to-end (expects chain+indexer+web already running)
	cd web && npx playwright test

## ─── Deploy (Base Sepolia + Cloudflare). See DEPLOY.md. ───────────────────────
deploy-contracts: ## Deploy contracts to Base Sepolia (needs DEPLOYER_PRIVATE_KEY + BASE_SEPOLIA_RPC_URL)
	cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url $(BASE_SEPOLIA_RPC_URL) --broadcast --verify

wire: ## Wire deployed addresses into indexer/wrangler.toml + web/.env.production
	node scripts/wire-deploy.mjs baseSepolia --rpc "$(BASE_SEPOLIA_RPC_URL)" $(if $(API),--api $(API),)

deploy-indexer: ## Deploy the indexer Worker (needs wrangler auth; D1/secret set per DEPLOY.md)
	cd indexer && wrangler deploy

deploy-web: ## Build + deploy the web app to Cloudflare Pages
	cd web && npm run build && wrangler pages deploy dist --project-name wordsmash

clean: ## Remove build artifacts
	rm -rf contracts/out contracts/cache web/dist
	@echo "cleaned"
