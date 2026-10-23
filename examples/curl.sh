#!/usr/bin/env bash
# Spindle API-key quickstart with curl: models, chat, streaming chat, embeddings.
#   SPINDLE_API_URL  default http://127.0.0.1:7200
#   SPINDLE_API_KEY  required (sk-spdl-...), from Dashboard > Developers
#   SPINDLE_MODEL / SPINDLE_EMBED_MODEL  optional, otherwise the first available chat / embeddings model
set -euo pipefail

API="${SPINDLE_API_URL:-http://127.0.0.1:7200}/v1"
: "${SPINDLE_API_KEY:?set SPINDLE_API_KEY (create one in Dashboard > Developers)}"
AUTH="Authorization: Bearer $SPINDLE_API_KEY"
fail() { echo "FAIL curl.sh: $*" >&2; exit 1; }

echo "== GET /models"
MODELS=$(curl -fsS "$API/models") || fail "GET /models"
echo "$MODELS" | jq -r '.data[] | "\(.id)\t\(.kind)\tavailable=\(.available)"'
CHAT_MODEL="${SPINDLE_MODEL:-$(echo "$MODELS" | jq -r '[.data[] | select(.kind=="chat" and .available)][0].id // empty')}"
EMBED_MODEL="${SPINDLE_EMBED_MODEL:-$(echo "$MODELS" | jq -r '[.data[] | select(.kind=="embeddings" and .available)][0].id // empty')}"
[ -n "$CHAT_MODEL" ] || fail "no available chat model (is a node connected?)"

echo "== POST /chat/completions (non-stream) model=$CHAT_MODEL"
RES=$(curl -fsS -D /tmp/spindle-headers.$$ "$API/chat/completions" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"model\":\"$CHAT_MODEL\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in five words.\"}]}") || fail "chat"
echo "$RES" | jq -r '.choices[0].message.content'
JOB=$(grep -i '^x-spindle-job-id:' /tmp/spindle-headers.$$ | tr -d '\r' | cut -d' ' -f2)
grep -i '^x-spindle-\(job-id\|receipt\|charge-micros\):' /tmp/spindle-headers.$$ | tr -d '\r'
rm -f /tmp/spindle-headers.$$
[ -n "$JOB" ] || fail "missing X-Spindle-Job-Id"
echo "$RES" | jq -e '.spindle.chargeMicros' >/dev/null || fail "missing spindle.chargeMicros"

echo "== POST /chat/completions (stream)"
STREAM=$(curl -fsSN "$API/chat/completions" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"model\":\"$CHAT_MODEL\",\"stream\":true,\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"Count to five.\"}]}") || fail "stream"
echo "$STREAM" | grep '^data: {' | sed 's/^data: //' | jq -rj '.choices[0].delta.content // empty'; echo
echo "$STREAM" | grep -q '^data: \[DONE\]' || fail "stream did not end with [DONE]"
echo "$STREAM" | grep '^data: {' | sed 's/^data: //' | jq -e 'select(.spindle) | .spindle.jobId' >/dev/null || fail "no spindle meta in final chunk"

if [ -n "$EMBED_MODEL" ]; then
  echo "== POST /embeddings model=$EMBED_MODEL"
  curl -fsS "$API/embeddings" -H "$AUTH" -H 'content-type: application/json' \
    -d "{\"model\":\"$EMBED_MODEL\",\"input\":[\"hello\",\"world\"]}" | jq -e '.data | length == 2' >/dev/null || fail "embeddings"
else
  echo "== skipping embeddings (no embeddings model available)"
fi

echo "PASS curl.sh (job $JOB, receipt $API/receipts/$JOB)"
