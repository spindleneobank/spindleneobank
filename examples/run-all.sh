#!/usr/bin/env bash
# Runs every example against the dev stack and exits non-zero if any fails.
#   Needs: dev stack up and bootstrapped, a connected node, SPINDLE_API_KEY (prepaid balance) and
#   PRIVATE_KEY (an anvil test key holding USDG), plus python3 with `pip install -r requirements.txt` for the Python example.
#   Optional: OWNER_ADDRESS, CLAIMS_ADDRESS for verify-receipt.
set -uo pipefail
cd "$(dirname "$0")"
export SPINDLE_API_URL="${SPINDLE_API_URL:-http://127.0.0.1:7200}"
export RPC_URL="${RPC_URL:-http://127.0.0.1:7245}"
export PATH="$HOME/.bun/bin:$PATH"
failed=0
step() { echo; echo "##### $*"; }
run() { local name=$1; shift; step "$name"; if "$@"; then echo "[ok] $name"; else echo "[FAILED] $name"; failed=$((failed + 1)); fi; }

run offline-tests bun test
run curl ./curl.sh
run openai-node node openai-node.mjs
if python3 -c 'import openai' 2>/dev/null; then run openai-python python3 openai-python.py; else echo "[skip] openai-python (pip install -r requirements.txt)"; fi
run x402-exact bun x402-client.ts
run x402-session bun x402-session.ts

step "verify-receipt"
# Any finished job works; epochs close hourly, so a fresh job is verified up to the signature.
JOB=$(curl -fsS "${SPINDLE_API_URL}/v1/chat/completions" -H "Authorization: Bearer ${SPINDLE_API_KEY:-}" -H 'content-type: application/json' -D - -o /dev/null \
  -d "{\"model\":\"${SPINDLE_MODEL:-$(curl -fsS "$SPINDLE_API_URL/v1/models" | jq -r '[.data[]|select(.kind=="chat" and .available)][0].id')}\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="x-spindle-job-id"{print $2}')
if [ -n "$JOB" ]; then
  sleep 2
  run verify-receipt bun verify-receipt.ts "$JOB"
else
  echo "[FAILED] verify-receipt (could not create a job)"; failed=$((failed + 1))
fi

echo
if [ "$failed" -eq 0 ]; then echo "ALL PASS"; else echo "$failed example(s) FAILED"; exit 1; fi
