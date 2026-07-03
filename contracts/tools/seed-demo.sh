#!/usr/bin/env bash
#
# seed-demo.sh — populate the LIVE Base Sepolia launchpad with organic-looking,
# REAL on-chain activity so a demo link isn't a ghost town. It doubles as a full
# end-to-end test of the deployed contracts (claim -> buy -> sell -> list).
#
# It spreads activity across several throwaway actor wallets (the registry caps
# claims at 3/address), so the feed shows many distinct addresses — not one.
#
# REQUIREMENTS
#   - foundry (cast) on PATH
#   - contracts/.env with DEPLOYER_PRIVATE_KEY (gitignored; never printed)
#   - the deployer wallet funded with ~0.03 Base Sepolia ETH (see PREFLIGHT)
#
# SAFETY
#   - Actor private keys are written to contracts/.seed-actors.env (gitignored)
#     and NEVER printed to stdout. Only addresses are shown.
#   - testnet only. Do not point this at mainnet.
#
# USAGE
#   cd contracts && bash tools/seed-demo.sh
#
set -euo pipefail

RPC="${RPC:-https://sepolia.base.org}"
REGISTRY="${REGISTRY:-0xe061E462Cd4610c727a10BD79E752293420ce314}"
MARKETPLACE="${MARKETPLACE:-0x4Bd0792a1DA3F387E0d9AFA3d97Ca6d9fdA5ff82}"
ACTORS_FILE="./.seed-actors.env"

# Per-actor funding (covers 3 claims @0.001 + a couple buys + gas + dust).
FUND_PER_ACTOR="0.008ether"
BUY_AMT="0.0015ether"
# CLAIM_FEE is read LIVE from the registry after the env is loaded (see below) —
# the owner can change it on-chain (setClaimFee), so never hardcode it here.

# --- load deployer key (do not echo) ---
if [[ ! -f ./.env ]]; then echo "ERROR: contracts/.env not found"; exit 1; fi
set +u; source ./.env; set -u
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY missing in contracts/.env}"
DEPLOYER_PK="$DEPLOYER_PRIVATE_KEY"
DEPLOYER_ADDR=$(cast wallet address "$DEPLOYER_PK")

# Robust send: the public Base Sepolia RPC is load-balanced across nodes with
# slightly different views, so rapid sequential sends can read a stale nonce
# ("nonce too low") or hit a transient 429/5xx. cast waits for the receipt, so a
# failed attempt didn't broadcast — retry (re-reading the nonce) is safe.
send() {
  local pk="$1"; shift
  local i=0 out
  while :; do
    if out=$(cast send --rpc-url "$RPC" --private-key "$pk" "$@" 2>&1); then return 0; fi
    if echo "$out" | grep -qiE "nonce too low|already known|replacement transaction|timed out|timeout|-32000|429|50[0-9]"; then
      i=$((i+1)); if [ "$i" -ge 8 ]; then echo "  ! send failed after retries: $(echo "$out" | tail -1)"; return 1; fi
      sleep 4; continue
    fi
    echo "  ! send failed: $(echo "$out" | tail -1)"; return 1
  done
}
call() { cast call --rpc-url "$RPC" "$@"; }

# Live claim fee (wei) — strip cast's " [1e15]" annotation if present.
CLAIM_FEE_WEI=$(call "$REGISTRY" "claimFee()(uint256)" | awk '{print $1}')
echo "Claim fee: $(cast from-wei "$CLAIM_FEE_WEI") ETH (read from chain)"

# --- PREFLIGHT: balance check ---
# Overridable: re-runs with already-funded actors need almost nothing from the deployer.
BAL_WEI=$(cast balance "$DEPLOYER_ADDR" --rpc-url "$RPC")
NEED_WEI=$(cast to-wei "${MIN_DEPLOYER_ETH:-0.045}" ether)
echo "Deployer:  $DEPLOYER_ADDR"
echo "Balance:   $(cast from-wei "$BAL_WEI") ETH"
if [[ $(cast --to-dec "$BAL_WEI" 2>/dev/null || echo "$BAL_WEI") -lt $(cast --to-dec "$NEED_WEI" 2>/dev/null || echo "$NEED_WEI") ]]; then
  echo ""
  echo ">>> NOT ENOUGH ETH. Fund the deployer with ~0.05 Base Sepolia ETH, then re-run."
  echo ">>> Send to: $DEPLOYER_ADDR"
  echo ">>> Faucet:  https://portal.cdp.coinbase.com/products/faucet  (Base Sepolia)"
  exit 1
fi

# --- actor wallets (5 actors, <=3 claims each) ---
# word lists chosen to look like a real, desirable launchpad. NB: 'bitcoin' is reserved.
ACTOR_WORDS=(
  "base onchain gm"
  "degen wagmi based"
  "alpha frens mint"
  "ser lfg moon"
  "diamond ape pump"
)
N=${#ACTOR_WORDS[@]}

declare -a ACTOR_PK ACTOR_ADDR
if [[ -f "$ACTORS_FILE" ]]; then
  echo "Reusing existing actors from $ACTORS_FILE"
  set +u; source "$ACTORS_FILE"; set -u
  for ((i=0;i<N;i++)); do
    v="ACTOR${i}_PK"; ACTOR_PK[$i]="${!v}"; ACTOR_ADDR[$i]=$(cast wallet address "${ACTOR_PK[$i]}")
  done
else
  echo "Generating $N actor wallets -> $ACTORS_FILE (gitignored, keys NOT printed)"
  : > "$ACTORS_FILE"
  for ((i=0;i<N;i++)); do
    out=$(cast wallet new)
    addr=$(printf '%s\n' "$out" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
    pk=$(printf '%s\n'  "$out" | grep -oE '0x[0-9a-fA-F]{64}' | head -1)
    ACTOR_PK[$i]="$pk"; ACTOR_ADDR[$i]="$addr"
    printf 'ACTOR%d_PK=%s\n' "$i" "$pk" >> "$ACTORS_FILE"
  done
fi

echo ""
echo "== Funding actors =="
FUND_MIN_WEI=$(cast to-wei 0.004 ether)
for ((i=0;i<N;i++)); do
  # Idempotent: skip actors that are already funded (safe re-runs after a hiccup).
  abal=$(cast balance "${ACTOR_ADDR[$i]}" --rpc-url "$RPC")
  abal=$(cast --to-dec "$abal" 2>/dev/null || echo "$abal")
  if [[ "$abal" -ge $(cast --to-dec "$FUND_MIN_WEI") ]]; then
    echo "  ~ actor$i already funded, skip"; continue
  fi
  echo "  actor$i ${ACTOR_ADDR[$i]}"
  send "$DEPLOYER_PK" "${ACTOR_ADDR[$i]}" --value "$FUND_PER_ACTOR"
done

echo ""
echo "== Claiming words =="
for ((i=0;i<N;i++)); do
  for w in ${ACTOR_WORDS[$i]}; do
    # skip if already claimed (idempotent re-runs)
    claimed=$(call "$REGISTRY" "isClaimed(string)(bool)" "$w")
    if [[ "$claimed" == "true" ]]; then echo "  ~ $w already claimed, skip"; continue; fi
    echo "  + actor$i claims '$w'"
    send "${ACTOR_PK[$i]}" "$REGISTRY" "claim(string)" "$w" --value "$CLAIM_FEE_WEI"
  done
done

echo ""
echo "== Cross-buys (actors buy OTHER people's word tokens) =="
# (buyer_actor, word) — minTokensOut=0 is fine on testnet (no MEV here)
BUYS=( "4:base" "3:onchain" "0:degen" "1:alpha" "2:moon" "4:diamond" "0:wagmi" )
for pair in "${BUYS[@]}"; do
  ai="${pair%%:*}"; w="${pair##*:}"
  mkt=$(call "$REGISTRY" "marketOf(string)(address)" "$w" | awk '{print $1}')
  if [[ "$mkt" == 0x0000000000000000000000000000000000000000 ]]; then echo "  ! no market for $w, skip"; continue; fi
  echo "  \$ actor$ai buys \$$w"
  send "${ACTOR_PK[$ai]}" "$mkt" "buy(uint256)" 0 --value "$BUY_AMT"
done

echo ""
echo "== A couple of sells (shows red flow + accrues deed fees) =="
SELLS=( "4:base" "0:degen" )
for pair in "${SELLS[@]}"; do
  ai="${pair%%:*}"; w="${pair##*:}"
  mkt=$(call "$REGISTRY" "marketOf(string)(address)" "$w" | awk '{print $1}')
  # cast annotates uint256 output as "<dec> [1.2e3]" — keep only the decimal.
  bal=$(call "$mkt" "balanceOf(address)(uint256)" "${ACTOR_ADDR[$ai]}" | awk '{print $1}')
  if [[ "${bal:-0}" -le 0 ]]; then echo "  ! actor$ai holds no \$$w, skip"; continue; fi
  half=$(( bal / 2 ))
  echo "  - actor$ai sells half of \$$w"
  send "${ACTOR_PK[$ai]}" "$mkt" "sell(uint256,uint256)" "$half" 0
done

echo ""
echo "== List two deeds for sale (populates the For-sale strip) =="
# (seller_actor, word, price-eth)
LISTINGS=( "1:wagmi:0.02" "2:mint:0.05" )
for trip in "${LISTINGS[@]}"; do
  IFS=':' read -r ai w price <<< "$trip"
  tid=$(call "$REGISTRY" "tokenIdOf(string)(uint256)" "$w" | awk '{print $1}')
  echo "  ^ actor$ai lists '$w' for $price ETH"
  send "${ACTOR_PK[$ai]}" "$REGISTRY" "approve(address,uint256)" "$MARKETPLACE" "$tid"
  send "${ACTOR_PK[$ai]}" "$MARKETPLACE" "list(uint256,uint256)" "$tid" "$(cast to-wei "$price" ether)"
done

echo ""
echo "== DONE =="
echo "Total words now: $(call "$REGISTRY" "totalWords()(uint256)" | awk '{print $1}')"
echo "Indexer cron runs every ~1 min; the site should light up shortly:"
echo "  https://keepney.com"
