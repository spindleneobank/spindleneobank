#!/bin/sh
# Spindle node installer for Linux and macOS (POSIX sh).
#   curl -fsSL <url>/install.sh | sh -s -- --token <TOKEN>
set -eu

# TODO(owner): set the Docker Hub namespace and the production API URL before publishing.
IMAGE="${SPINDLE_IMAGE:-spindle/spindle-node}"
API="${SPINDLE_API_URL:-wss://api.spindle.example}"
CONTAINER=spindle-node
VOLUME=spindle-node
ENGINE=ollama
TOKEN="${SPINDLE_TOKEN:-}"
MODEL=""
NAME=""
ACTION=install
DRY=0
NO_PULL="${SPINDLE_NO_PULL:-0}"
TAG=""

say() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: install.sh [options]
  --token <t>        enrollment token from the dashboard (omit to pair with a code)
  --engine <e>       ollama (default) | vllm (NVIDIA GPU, Linux only)
  --model <m>        model for vllm (required with --engine vllm), e.g. Qwen/Qwen2.5-7B-Instruct
  --name <n>         display name for this node
  --api <url>        API websocket URL (default: $SPINDLE_API_URL or the production API)
  --image <img>      image repository (default: $SPINDLE_IMAGE or spindle/spindle-node)
  --tag <tag>        image tag (default: the engine name)
  --no-pull          use the local image without pulling
  --dry-run          print the docker commands without running them
  --uninstall        remove the container (the data volume, and so the node key, is kept)
  --purge            remove the container AND the volume (asks for confirmation)
  -h, --help
USAGE
}

need_arg() { [ "$#" -ge 2 ] || die "option $1 needs a value"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --token) need_arg "$@"; TOKEN="$2"; shift 2 ;;
    --engine) need_arg "$@"; ENGINE="$2"; shift 2 ;;
    --model) need_arg "$@"; MODEL="$2"; shift 2 ;;
    --name) need_arg "$@"; NAME="$2"; shift 2 ;;
    --api) need_arg "$@"; API="$2"; shift 2 ;;
    --image) need_arg "$@"; IMAGE="$2"; shift 2 ;;
    --tag) need_arg "$@"; TAG="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    --uninstall) ACTION=uninstall; shift ;;
    --purge) ACTION=purge; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

case "$ENGINE" in ollama|vllm) ;; *) die "--engine must be ollama or vllm" ;; esac
[ -n "$TAG" ] || TAG="$ENGINE"
OS=$(uname -s)
case "$OS" in Linux|Darwin) ;; *) die "unsupported OS $OS (Windows: use install.ps1)" ;; esac

docker_run() { if [ "$DRY" = 1 ]; then say "+ docker $*"; else docker "$@"; fi; }

# ---- docker present and reachable ----
if [ "$DRY" != 1 ]; then
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. Install it first:
  Linux: https://docs.docker.com/engine/install/
  macOS: https://docs.docker.com/desktop/setup/install/mac-install/"
  docker info >/dev/null 2>&1 || die "Cannot reach the Docker daemon. Start Docker (Desktop) and make sure your user may run docker (or re-run with sudo)."
fi

# ---- uninstall / purge ----
if [ "$ACTION" != install ]; then
  docker_run rm -f "$CONTAINER" >/dev/null 2>&1 || true
  say "Container $CONTAINER removed."
  if [ "$ACTION" = purge ]; then
    say "This deletes volume '$VOLUME', including the node key. The node can never be recovered;"
    say "it would have to re-enroll and re-register as a NEW node."
    if [ "$DRY" = 1 ]; then
      say "+ (would ask for confirmation, then) docker volume rm $VOLUME"
    else
      [ -r /dev/tty ] || die "--purge needs an interactive terminal for confirmation"
      printf "Type '%s' to delete the volume: " "$VOLUME" >/dev/tty
      read -r answer </dev/tty
      [ "$answer" = "$VOLUME" ] || die "confirmation mismatch; volume kept"
      docker volume rm "$VOLUME"
      say "Volume removed."
    fi
  else
    say "Data volume '$VOLUME' kept (node key preserved). Re-run the installer to bring the node back."
  fi
  exit 0
fi

# ---- validate install args ----
if [ "$ENGINE" = vllm ]; then
  [ "$OS" = Linux ] || die "the vllm engine needs an NVIDIA GPU on Linux; use --engine ollama"
  [ -n "$MODEL" ] || die "--model is required with --engine vllm"
fi

# ---- GPU / engine host detection ----
GPU_ARGS=""
ENGINE_URL=""
if [ "$OS" = Linux ]; then
  have_gpu=0
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    if [ "$DRY" = 1 ] || docker info 2>/dev/null | grep -qi nvidia; then
      have_gpu=1
    else
      warn "NVIDIA GPU found but the nvidia-container-toolkit does not look configured."
      warn "Install it: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    fi
  fi
  if [ "$have_gpu" = 1 ]; then
    GPU_ARGS="--gpus all"
    say "NVIDIA GPU detected: enabling --gpus all."
  elif [ "$ENGINE" = vllm ]; then
    die "the vllm engine requires a working NVIDIA GPU with the container toolkit"
  else
    warn "No usable GPU for containers: running in CPU mode. Only small models will be offered."
  fi
else
  # macOS: containers cannot see the Apple GPU, so use the native Ollama (Metal) on the host.
  if curl -fsS -m 3 http://localhost:11434/api/version >/dev/null 2>&1; then
    say "Found native Ollama on the host (Metal acceleration)."
  elif [ "$DRY" = 1 ]; then
    warn "Native Ollama is not answering on localhost:11434 (continuing: dry run)."
  else
    die "Native Ollama is not running. For GPU speed on Apple Silicon:
  brew install ollama && brew services start ollama
then re-run this installer."
  fi
  ENGINE_URL="http://host.docker.internal:11434"
fi

# ---- (re)create the container; the volume is never touched ----
if [ "$NO_PULL" != 1 ]; then docker_run pull "$IMAGE:$TAG"; fi
if [ "$DRY" = 1 ] || docker inspect "$CONTAINER" >/dev/null 2>&1; then
  say "Replacing existing container $CONTAINER (data volume $VOLUME is kept)."
  docker_run rm -f "$CONTAINER" >/dev/null 2>&1 || true
fi

# shellcheck disable=SC2086  # GPU_ARGS is intentionally word-split
set -- run -d --name "$CONTAINER" --restart unless-stopped -v "$VOLUME:/data" $GPU_ARGS \
  -e "SPINDLE_API_URL=$API" -e "SPINDLE_ENGINE=$ENGINE"
[ -z "$TOKEN" ] || set -- "$@" -e "SPINDLE_TOKEN=$TOKEN"
[ -z "$NAME" ] || set -- "$@" -e "SPINDLE_NAME=$NAME"
[ -z "$MODEL" ] || set -- "$@" -e "SPINDLE_VLLM_MODEL=$MODEL"
if [ -n "$ENGINE_URL" ]; then
  set -- "$@" -e "SPINDLE_ENGINE_URL=$ENGINE_URL" --add-host host.docker.internal:host-gateway
fi
set -- "$@" "$IMAGE:$TAG"

if [ "$DRY" = 1 ]; then
  # never echo the token
  say "+ docker $(printf '%s ' "$@" | sed 's/SPINDLE_TOKEN=[^ ]*/SPINDLE_TOKEN=***/')"
else
  docker "$@" >/dev/null
  say "Spindle node started. Follow the log with:  docker logs -f $CONTAINER"
  if [ -z "$TOKEN" ]; then
    say "No token given: the log will show a pairing code and URL; open it and approve the node."
  fi
  say "Then register the node in the dashboard (Compute tab); it receives jobs only once registered on-chain."
fi
