#!/bin/sh
# Builds a node image locally (maintainers: the house node). It goes through the same dist build and the
# same Dockerfile (node/docker/Dockerfile.<engine>) that testers get, so there is no second recipe.
#   default            ollama image for the host arch -> spindle-node:ollama-local
#   TARGET=vllm        vllm image (amd64; large)      -> spindle-node:vllm-local
# We never push images anywhere. Needs bun on the host. Prefix docker via DOCKER (e.g. DOCKER="sudo docker").
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(dirname "$(dirname "$HERE")")
DOCKER=${DOCKER:-docker}
TARGET=${TARGET:-ollama}
LOCAL_NAME=${LOCAL_NAME:-spindle-node}

case "$TARGET" in ollama|vllm) ;; *) echo "TARGET must be ollama or vllm" >&2; exit 2 ;; esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported CPU architecture $(uname -m)" >&2; exit 2 ;;
esac

OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT INT TERM
(cd "$APP_DIR" && bun run scripts/node-dist.ts --out "$OUT" --engine "$TARGET" --arch "$ARCH")
$DOCKER build -t "$LOCAL_NAME:$TARGET-local" - <"$OUT/$TARGET/$ARCH/context.tar.gz"
