#!/bin/sh
# Spindle node installer for Linux and macOS (POSIX sh).
#   curl -fsSL <api>/v1/node/install.sh | sh -s -- --token <TOKEN> --engine ollama
#
# Nothing is pulled from a Spindle registry: this script downloads OUR compiled agent as a docker build
# context from the API (token-gated, sha256-verified), then builds the node image on this machine on top of
# the pinned official base image (ollama/ollama or vllm/vllm-openai from Docker Hub).
set -eu

# The API serves this script with its own URL templated in. (Split so the server's substitution leaves the test alone.)
API_HTTP="__SPINDLE_API_URL__"
PLACEHOLDER="__SPINDLE_API""_URL__"
CONTAINER=spindle-node
VOLUME=spindle-node
ENGINE=ollama
TOKEN="${SPINDLE_TOKEN:-}"
UPDATE_TOKEN=""
MODEL=""
MODELS="${SPINDLE_MODELS:-}"
NAME=""
GPUS=auto
ACTION=install
DRY=0
UPDATE=0

say() { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: install.sh [options]
  --token <t>         enrollment token from the dashboard (Compute tab)
  --engine <e>        ollama (default) | vllm (NVIDIA GPU, Linux only)
  --model <m>         model for vllm (required with --engine vllm), e.g. Qwen/Qwen2.5-7B-Instruct
  --models <a,b>      restrict the models an ollama node pulls (SPINDLE_MODELS)
  --name <n>          display name for this node
  --gpus <mode>       auto (default: only when nvidia-smi and the NVIDIA container toolkit work) | none
  --update            rebuild the image from the latest agent and replace the container (keeps the node key)
  --update-token <t>  token for --update, from "Update node" in the dashboard
  --api <url>         API base URL (default: the server this script came from, or $SPINDLE_API_URL)
  --dry-run           print the commands without downloading or running anything
  --uninstall         remove the container (the data volume, and so the node key, is kept)
  --purge             remove the container AND the volume (asks for confirmation)
  -h, --help
USAGE
}

need_arg() { [ "$#" -ge 2 ] || die "option $1 needs a value"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --token) need_arg "$@"; TOKEN="$2"; shift 2 ;;
    --update-token) need_arg "$@"; UPDATE_TOKEN="$2"; shift 2 ;;
    --engine) need_arg "$@"; ENGINE="$2"; shift 2 ;;
    --model) need_arg "$@"; MODEL="$2"; shift 2 ;;
    --models) need_arg "$@"; MODELS="$2"; shift 2 ;;
    --name) need_arg "$@"; NAME="$2"; shift 2 ;;
    --gpus) need_arg "$@"; GPUS="$2"; shift 2 ;;
    --api) need_arg "$@"; API_HTTP="$2"; shift 2 ;;
    --update) UPDATE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --uninstall) ACTION=uninstall; shift ;;
    --purge) ACTION=purge; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
done

case "$ENGINE" in ollama|vllm) ;; *) die "--engine must be ollama or vllm" ;; esac
case "$GPUS" in auto|none) ;; *) die "--gpus must be auto or none" ;; esac
OS=$(uname -s)
case "$OS" in Linux|Darwin) ;; *) die "unsupported OS $OS (Windows: use install.ps1)" ;; esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported CPU architecture $(uname -m)" ;;
esac
IMAGE="spindle-node:$ENGINE"

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

# ---- API url ----
case "$API_HTTP" in "$PLACEHOLDER"|"") API_HTTP="${SPINDLE_API_URL:-}" ;; esac
[ -n "$API_HTTP" ] || die "unknown API URL: fetch this script from your Spindle API (.../v1/node/install.sh) or pass --api <url>"
API_HTTP=$(printf '%s' "$API_HTTP" | sed 's#^wss://#https://#; s#^ws://#http://#; s#/*$##')
API_WS=$(printf '%s' "$API_HTTP" | sed 's#^https://#wss://#; s#^http://#ws://#')

# ---- validate install args ----
if [ "$ENGINE" = vllm ]; then
  [ "$OS" = Linux ] || die "the vllm engine needs an NVIDIA GPU on Linux; use --engine ollama"
  [ "$ARCH" = amd64 ] || die "the vllm engine is amd64 only"
  [ -n "$MODEL" ] || die "--model is required with --engine vllm"
fi
if [ "$UPDATE" = 1 ]; then
  [ -z "$TOKEN" ] || warn "--token is ignored with --update (the node already has its identity)"
  TOKEN=""
  if [ "$DRY" != 1 ] && ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    die "no node data volume '$VOLUME' here: nothing to update. Use an install command from the dashboard."
  fi
fi
DL_TOKEN="${UPDATE_TOKEN:-$TOKEN}"

# ---- GPU / engine host detection ----
GPU_ARGS=""
ENGINE_URL=""
if [ "$OS" = Linux ]; then
  have_gpu=0
  if [ "$GPUS" = auto ] && command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    if [ "$DRY" = 1 ] || docker info 2>/dev/null | grep -qi nvidia; then
      have_gpu=1
    else
      warn "NVIDIA GPU found but the NVIDIA container toolkit does not look configured."
      warn "Install it: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    fi
  fi
  if [ "$have_gpu" = 1 ]; then
    GPU_ARGS="--gpus all"
    say "NVIDIA GPU detected: enabling --gpus all."
  elif [ "$ENGINE" = vllm ]; then
    die "the vllm engine requires a working NVIDIA GPU with the container toolkit"
  else
    warn "No usable GPU for containers: running the node in CPU mode (only small models are offered)."
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

# ---- a localhost API (development) is not reachable from inside a container ----
NET_ARGS=""
HOST_PART=$(printf '%s' "$API_WS" | sed 's#^[a-z]*://##; s#[:/].*##')
case "$HOST_PART" in
  localhost|127.0.0.1|0.0.0.0)
    if [ "$OS" = Linux ]; then
      NET_ARGS="--network host"
      say "API is on localhost: running the container with --network host."
    else
      API_WS=$(printf '%s' "$API_WS" | sed "s#//$HOST_PART#//host.docker.internal#")
    fi
    ;;
esac

# ---- the node image: download our agent, verify, build locally ----
want_sha=""
want_ver=""
if [ "$DRY" != 1 ]; then
  command -v curl >/dev/null 2>&1 || die "curl is required"
  manifest=$(curl -fsS --max-time 30 "$API_HTTP/v1/node/dist/manifest.json") ||
    die "cannot fetch $API_HTTP/v1/node/dist/manifest.json (is the API URL right, and the node distribution built?)"
  want_sha=$(printf '%s\n' "$manifest" | awk -v k="\"$ENGINE/$ARCH\":" '$1==k {f=1} f && /"sha256"/ {gsub(/[",]/,"",$2); print $2; exit}')
  want_ver=$(printf '%s\n' "$manifest" | awk '/"agentVersion"/ {gsub(/[",]/,"",$2); print $2; exit}')
  [ -n "$want_sha" ] || die "no $ENGINE build for $ARCH on this server"
fi
have_sha=""
if [ "$DRY" != 1 ]; then
  have_sha=$(docker image inspect -f '{{ index .Config.Labels "spindle.context-sha256" }}' "$IMAGE" 2>/dev/null || true)
fi

if [ "$DRY" = 1 ]; then
  say "+ curl -fsSL -H 'Authorization: Bearer ***' -o context.tar.gz $API_HTTP/v1/node/dist/$ENGINE/$ARCH/context.tar.gz"
  say "+ (verify the sha256 against $API_HTTP/v1/node/dist/manifest.json)"
  say "+ docker build -t $IMAGE --label spindle.context-sha256=<sha256> - < context.tar.gz"
elif [ "$have_sha" = "$want_sha" ]; then
  say "Image $IMAGE is already up to date (agent $want_ver); skipping the download."
else
  [ -n "$DL_TOKEN" ] || die "a token is needed to download the agent. Generate a command in the dashboard (Compute tab)."
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  say "Downloading the Spindle node agent $want_ver ($ENGINE, $ARCH)..."
  progress=-sS
  [ -t 2 ] && progress=-#
  curl -fL $progress --retry 3 -H "Authorization: Bearer $DL_TOKEN" -o "$tmp/context.tar.gz" \
    "$API_HTTP/v1/node/dist/$ENGINE/$ARCH/context.tar.gz" ||
    die "download failed. The command may have expired (they last 15 minutes): generate a new one in the dashboard."
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/context.tar.gz" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then got=$(shasum -a 256 "$tmp/context.tar.gz" | awk '{print $1}')
  else die "sha256sum or shasum is required to verify the download"; fi
  [ "$got" = "$want_sha" ] || die "sha256 mismatch (got $got, expected $want_sha): refusing to build"
  say "sha256 verified. Building $IMAGE locally on the official base image (the first build downloads about 2 GB from Docker Hub)..."
  docker build -t "$IMAGE" --label "spindle.context-sha256=$got" --label "spindle.agent-version=$want_ver" - <"$tmp/context.tar.gz" ||
    die "docker build failed"
  rm -rf "$tmp"; trap - EXIT INT TERM
fi

# ---- (re)create the container; the volume is never touched ----
if [ "$DRY" = 1 ] || docker inspect "$CONTAINER" >/dev/null 2>&1; then
  say "Replacing existing container $CONTAINER (data volume $VOLUME is kept)."
  docker_run rm -f "$CONTAINER" >/dev/null 2>&1 || true
fi

# shellcheck disable=SC2086  # GPU_ARGS and NET_ARGS are intentionally word-split
set -- run -d --name "$CONTAINER" --restart unless-stopped -v "$VOLUME:/data" $GPU_ARGS $NET_ARGS \
  -e "SPINDLE_API_URL=$API_WS" -e "SPINDLE_ENGINE=$ENGINE"
[ -z "$TOKEN" ] || set -- "$@" -e "SPINDLE_TOKEN=$TOKEN"
[ -z "$NAME" ] || set -- "$@" -e "SPINDLE_NAME=$NAME"
[ -z "$MODEL" ] || set -- "$@" -e "SPINDLE_VLLM_MODEL=$MODEL"
[ -z "$MODELS" ] || set -- "$@" -e "SPINDLE_MODELS=$MODELS"
if [ -n "$ENGINE_URL" ]; then
  set -- "$@" -e "SPINDLE_ENGINE_URL=$ENGINE_URL" --add-host host.docker.internal:host-gateway
fi
set -- "$@" "$IMAGE"

if [ "$DRY" = 1 ]; then
  # never echo the token
  say "+ docker $(printf '%s ' "$@" | sed 's/SPINDLE_TOKEN=[^ ]*/SPINDLE_TOKEN=***/')"
else
  docker "$@" >/dev/null
  say "Spindle node started. Follow the log with:  docker logs -f $CONTAINER"
  if [ "$UPDATE" = 1 ]; then
    say "Updated to agent ${want_ver:-latest}; the node keeps its identity."
  else
    [ -n "$TOKEN" ] || say "No token given: the log will show a pairing code and URL; open it and approve the node."
    say "Then register the node in the dashboard (Compute tab); it receives jobs only once registered on-chain."
  fi
fi
