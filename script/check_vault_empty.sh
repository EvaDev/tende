#!/usr/bin/env bash
#
# check_vault_empty.sh — Verify the live Vault proxy has a fully empty ledger
# before upgrading to v1.1.0 (which reinterprets the `unifiedBalance` storage
# slot as `_shares`). The reinterpretation is only sound if every balance is 0.
#
# A non-zero unifiedBalance can ONLY be produced by one of four events:
#   Credited, Transferred, UsdPurchased, Deposited.
# If none were ever emitted, the ledger is provably empty. If any were, we
# enumerate the touched (user, currency) pairs and read each live balance.
#
# Uses the Etherscan v2 getLogs API (handles the full block range; the Alchemy
# free tier caps eth_getLogs at 10 blocks). Reads unifiedBalance via cast.
#
# Usage: ./script/check_vault_empty.sh
# Requires: cast, jq, curl; ETHERSCAN_API_KEY + RPC_URL_SEPOLIA + VAULT_CONTRACT_ADDRESS
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; [ -f ./.env ] && . ./.env; [ -f ./server/.env ] && . ./server/.env; set +a

CHAIN=11155111
RPC="${RPC_URL_SEPOLIA:?RPC_URL_SEPOLIA not set}"
KEY="${ETHERSCAN_API_KEY:?ETHERSCAN_API_KEY not set}"
VAULT="${VAULT_CONTRACT_ADDRESS:-0xe9e3DB0be17a4D6D4c794FF2600Fd9D7BC30C3dA}"
FROM="${FROM_BLOCK:-11064153}"   # vault proxy deploy block
API="https://api.etherscan.io/v2/api?chainid=$CHAIN"

# Balance-creating events → topic0  (see Vault.sol event signatures).
# Plain function (not an assoc array) so this runs on macOS' stock bash 3.2.
topic_of() {
  case "$1" in
    Credited)     echo 0x67c88b52c84602df62d19a6c0f1c906450cda4f3b8c7c0c1522aa5cd48b2c913 ;;
    Transferred)  echo 0x59ea1e562886aeb5a9ec8a52939012ad92373a366dc829c6be7b27b60b85631d ;;
    UsdPurchased) echo 0x9fe294a0d361c92c1fcf347258569c7b68c6dce03118793fa38ec60617b14ea8 ;;
    Deposited)    echo 0x4174a9435a04d04d274c76779cad136a41fde6937c56241c09ab9d3c7064a1a9 ;;
  esac
}
USDC_CODE=$(cast keccak "USDC")

echo "Vault: $VAULT  (scan from block $FROM, chain $CHAIN)"
echo

getlogs() { curl -s "$API&module=logs&action=getLogs&address=$VAULT&topic0=$1&fromBlock=$FROM&toBlock=latest&apikey=$KEY"; }
norm_addr() { echo "0x${1: -40}"; }   # 32-byte topic → 20-byte address

pairs="$(mktemp)"; trap 'rm -f "$pairs" "$pairs.u"' EXIT
total=0

for name in Credited Transferred UsdPurchased Deposited; do
  resp="$(getlogs "$(topic_of "$name")")"
  if [ "$(echo "$resp" | jq -r '(.result|type)')" != "array" ]; then
    echo "  $name: 0 events"; continue   # "No records found" → status 0, result is a string
  fi
  n="$(echo "$resp" | jq '.result|length')"
  echo "  $name: $n event(s)"
  [ "$n" = 0 ] && continue
  case "$name" in
    Credited)     rows='.result[] | "\(.topics[1]) \(.topics[2])"' ;;     # user, currency
    Transferred)  rows='.result[] | "\(.topics[2]) \(.topics[3])"' ;;     # to, currency
    UsdPurchased) rows='.result[] | "\(.topics[1]) \(.topics[2])"' ;;     # buyer, localCurrency
    Deposited)    rows='.result[] | "\(.topics[2]) \(.data[0:66])"' ;;    # beneficiary, token(data)
  esac
  while read -r a b; do
    addr="$(norm_addr "$a")"
    if [ "$name" = "Deposited" ]; then
      cur="$(cast call "$VAULT" "tokenCurrency(address)(bytes32)" "0x${b: -40}" --rpc-url "$RPC")"
    else
      cur="$b"
    fi
    echo "$addr $cur" >> "$pairs"; total=$((total+1))
    if [ "$name" = "UsdPurchased" ]; then echo "$addr $USDC_CODE" >> "$pairs"; total=$((total+1)); fi
  done < <(echo "$resp" | jq -r "$rows")
  sleep 0.25
done

echo
if [ "$total" = 0 ]; then
  echo "RESULT: no balance-creating events since deploy → ledger is EMPTY. Safe to upgrade. ✅"
  exit 0
fi

echo "Reading live unifiedBalance for touched pairs…"
sort -u "$pairs" > "$pairs.u"; nonzero=0; checked=0
while read -r addr cur; do
  [ -z "$addr" ] && continue
  bal="$(cast call "$VAULT" "unifiedBalance(address,bytes32)(uint256)" "$addr" "$cur" --rpc-url "$RPC")"; bal="${bal%% *}"
  checked=$((checked+1))
  [ "$bal" != 0 ] && { echo "  NON-ZERO: $addr cur=$cur bal=$bal"; nonzero=$((nonzero+1)); }
done < "$pairs.u"

echo
if [ "$nonzero" = 0 ]; then
  echo "RESULT: $checked pair(s) checked, all zero → ledger is EMPTY. Safe to upgrade. ✅"
  exit 0
fi
echo "RESULT: $nonzero non-zero balance(s) → DO NOT upgrade with slot reinterpretation. ❌"
exit 1
