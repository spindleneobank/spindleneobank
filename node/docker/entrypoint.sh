#!/bin/sh
# Spindle node entrypoint: starts the inference engine (unless an external one is configured),
# waits for it, then runs the agent in the foreground (SIGTERM is forwarded).
set -eu

log() { echo "[entrypoint] $*" >&2; }

# allow `docker run <image> spindle-node --version`
[ "${1:-}" = "spindle-node" ] && shift
case "${1:-}" in
  --version|-v|--help|-h) exec spindle-node "$@" ;;
esac

ENGINE="${SPINDLE_ENGINE:-ollama}"
PIDS=""

# shellcheck disable=SC2329  # invoked via trap
term() {
  log "stopping"
  for p in $PIDS; do kill -TERM "$p" 2>/dev/null || true; done
  [ -n "${AGENT_PID:-}" ] && kill -TERM "$AGENT_PID" 2>/dev/null || true
}
trap term TERM INT

is_local() {
  case "${SPINDLE_ENGINE_URL:-}" in
    ""|http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for() { # name, command..., 60 s max
  name="$1"; shift
  i=0
  while ! "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "${WAIT_SECS:-60}" ]; then log "$name did not become ready in ${WAIT_SECS:-60}s"; exit 1; fi
    sleep 1
  done
  log "$name is ready"
}

has_gpu() { command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; }

if is_local; then
  case "$ENGINE" in
    ollama)
      if ! has_gpu; then log "CPU mode — only small models will be offered"; fi
      ollama serve &
      PIDS="$PIDS $!"
      wait_for ollama ollama list
      ;;
    vllm)
      : "${SPINDLE_VLLM_MODEL:?SPINDLE_VLLM_MODEL is required for the vllm image}"
      has_gpu || { log "no NVIDIA GPU visible: the vllm image needs one (use the ollama image for CPU)"; exit 1; }
      python3 -m vllm.entrypoints.openai.api_server \
        --model "$SPINDLE_VLLM_MODEL" --port 8000 \
        --gpu-memory-utilization "${SPINDLE_VLLM_GPU_UTIL:-0.90}" &
      PIDS="$PIDS $!"
      WAIT_SECS="${SPINDLE_VLLM_START_TIMEOUT:-900}" wait_for vllm \
        python3 -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/v1/models', timeout=3)"
      ;;
    *) log "unknown SPINDLE_ENGINE '$ENGINE'"; exit 2 ;;
  esac
else
  log "using external engine at ${SPINDLE_ENGINE_URL}; not starting a local one"
fi

spindle-node "$@" &
AGENT_PID=$!
# `wait` returns early on a trapped signal; loop until the agent is really gone.
while kill -0 "$AGENT_PID" 2>/dev/null; do
  wait "$AGENT_PID" && rc=0 || rc=$?
done
for p in $PIDS; do kill -TERM "$p" 2>/dev/null || true; done
exit "${rc:-0}"
