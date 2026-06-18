#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
forge build
OUT=../shared/src/abis.ts
{
  echo "// Auto-generated from Foundry artifacts. Regenerate with contracts/tools/gen-abis.sh."
  echo "export const wordRegistryAbi = $(jq -c '.abi' out/WordRegistry.sol/WordRegistry.json) as const;"
  echo "export const deedMarketplaceAbi = $(jq -c '.abi' out/DeedMarketplace.sol/DeedMarketplace.json) as const;"
} > "$OUT"
echo "Wrote $OUT"
