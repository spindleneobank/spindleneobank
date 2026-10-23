#!/bin/sh
# Builds the Spindle node images from app/node.
#   default            local --load build of the ollama image (host arch) -> spindle-node:ollama-local
#   TARGET=vllm        local build of the vllm image (amd64; large)       -> spindle-node:vllm-local
#   PUSH=1 IMAGE=...   multi-arch build + push (owner-gated; asks you to type the image name)
# Docker invocation can be prefixed via DOCKER (e.g. DOCKER="sudo docker").
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
NODE_DIR=$(dirname "$HERE")
APP_DIR=$(dirname "$NODE_DIR")
DOCKER=${DOCKER:-docker}
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$NODE_DIR/package.json" | head -n 1)
TARGET=${TARGET:-ollama}
LOCAL_NAME=${LOCAL_NAME:-spindle-node}

case "$TARGET" in ollama|vllm|all) ;; *) echo "TARGET must be ollama, vllm or all" >&2; exit 2 ;; esac
[ -n "$VERSION" ] || { echo "cannot read version from package.json" >&2; exit 2; }

if [ "${PUSH:-0}" = "1" ]; then
  if [ -z "${IMAGE:-}" ]; then
    echo "PUSH=1 requires IMAGE=<namespace>/spindle-node (Docker Hub namespace not set)" >&2
    exit 2
  fi
  echo "About to PUSH $IMAGE:{ollama,ollama-$VERSION,vllm,vllm-$VERSION} to a registry."
  printf 'Type the image name (%s) to confirm: ' "$IMAGE"
  read -r answer
  [ "$answer" = "$IMAGE" ] || { echo "confirmation mismatch; nothing pushed" >&2; exit 1; }
fi

build_ollama() {
  if [ "${PUSH:-0}" = "1" ]; then
    $DOCKER buildx build --platform linux/amd64,linux/arm64 -f "$NODE_DIR/Dockerfile.ollama" \
      -t "$IMAGE:ollama" -t "$IMAGE:ollama-$VERSION" --push "$APP_DIR"
  else
    $DOCKER buildx build --load -f "$NODE_DIR/Dockerfile.ollama" \
      -t "$LOCAL_NAME:ollama-local" "$APP_DIR"
  fi
}

build_vllm() {
  if [ "${PUSH:-0}" = "1" ]; then
    $DOCKER buildx build --platform linux/amd64 -f "$NODE_DIR/Dockerfile.vllm" \
      -t "$IMAGE:vllm" -t "$IMAGE:vllm-$VERSION" --push "$APP_DIR"
  else
    $DOCKER buildx build --load --platform linux/amd64 -f "$NODE_DIR/Dockerfile.vllm" \
      -t "$LOCAL_NAME:vllm-local" "$APP_DIR"
  fi
}

case "$TARGET" in
  ollama) build_ollama ;;
  vllm) build_vllm ;;
  all) build_ollama; build_vllm ;;
esac
