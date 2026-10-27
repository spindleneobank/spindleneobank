# Spindle node

The node agent connects outbound to the Spindle API (works behind NAT), serves inference from a local engine
(Ollama or vLLM) and signs a receipt for every job.

**There is no published node image.** The installer downloads only our compiled agent from the API (a docker build
context, gated by your enrollment token and verified by sha256) and builds the image **on your machine** on top of
the official `ollama/ollama` or `vllm/vllm-openai` base image from Docker Hub (pinned by digest). The first build
downloads the base image (about 2 GB for Ollama, much more for vLLM) and takes a few minutes.

A node receives jobs only after it is **registered on-chain** (dashboard, Compute tab). Until then it stays
online and logs `Registered: no`.

## Quick start

Get an enrollment token in the dashboard (Compute tab), or omit `--token` and approve the pairing code the node
prints in its log (`docker logs -f spindle-node`).

Copy the command from the dashboard (Compute tab); it already contains your token, engine and API URL.

### Linux

Requires Docker (the user must be allowed to run `docker`). For GPUs: NVIDIA driver +
[nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
```sh
curl -fsSL https://<api>/v1/node/install.sh | sh -s -- --token <TOKEN> --engine ollama
# vLLM (NVIDIA only, amd64, serves one model):
curl -fsSL https://<api>/v1/node/install.sh | sh -s -- --token <TOKEN> --engine vllm --model Qwen/Qwen2.5-7B-Instruct
```
`--gpus all` is added only when `nvidia-smi` works and Docker lists the NVIDIA runtime; otherwise the node runs on CPU
(Ollama, only small models are offered) and the installer says so. vLLM without a GPU is an error.

### Windows (Docker Desktop + WSL2)

Install Docker Desktop with the WSL2 backend and, for GPUs, the current NVIDIA Windows driver.
```powershell
& ([scriptblock]::Create((irm https://<api>/v1/node/install.ps1))) -Token <TOKEN> -Engine ollama
```

### macOS

Containers cannot use the Apple GPU, so the node uses a **native Ollama** on the host (Metal):
```sh
brew install ollama && brew services start ollama
curl -fsSL https://<api>/v1/node/install.sh | sh -s -- --token <TOKEN>
```
The container talks to the host through `host.docker.internal:11434`; `--gpus` is never used on macOS.

### Compose

`compose.example.yml` is a single-service alternative: `SPINDLE_TOKEN=<token> docker compose -f compose.example.yml up -d`.

## Installer options

`--token --engine ollama|vllm --model --models --name --gpus auto|none --update --update-token --api --dry-run --uninstall --purge`
(PowerShell: `-Token -Engine -Model -Models -Name -Api -Update -UpdateToken -DryRun -Uninstall -Purge`).

- `--models a,b` restricts the models an Ollama node pulls (`SPINDLE_MODELS`).
- The API URL comes from where the script was fetched; `--api <url>` overrides it. An API on `localhost` is reached with
  `--network host` on Linux (and `host.docker.internal` elsewhere).
- If the image `spindle-node:<engine>` already matches the server's agent build (checked through the image label
  `spindle.context-sha256`), the download and build are skipped.
- Re-running the installer replaces the container and keeps the volume, so the node keeps its identity.
  `--uninstall` removes only the container. `--purge` also deletes the volume after you type its name.

## Data volume and key backup

Volume `spindle-node` mounts at `/data` and holds `node-key.json` (the node identity, mode 0600) and the Ollama
models (`/data/ollama`). **Losing the volume makes this a new node** that must re-enroll and re-register. Back up the key:
```sh
docker run --rm -v spindle-node:/data -v "$PWD":/backup alpine cp /data/node-key.json /backup/
```
The Ollama image runs as uid 10001; bind-mounted host directories must be writable by that uid.

## Update

In the dashboard, node list: **Update node** shows a one-time command (valid 15 minutes):
```sh
curl -fsSL https://<api>/v1/node/install.sh | sh -s -- --update --update-token <TOKEN> --engine ollama
```
It downloads the latest agent, rebuilds the image locally and replaces the container; the volume and node key are kept.
If the log says `agent too old`, update this way.

## Troubleshooting

- **`Cannot reach the Docker daemon`**: start Docker (Desktop), or add your user to the `docker` group.
- **CPU mode on a GPU machine (Linux)**: `nvidia-smi` must work on the host and `docker info | grep -i nvidia` must list the runtime; install the container toolkit and `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`.
- **Windows**: Docker Desktop must use Linux containers and the WSL2 engine; update the NVIDIA Windows driver (do not install a Linux driver inside WSL). Test: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
- **Apple Silicon**: use the native Ollama (see macOS). The image built on an arm64 Mac is arm64 and CPU-only.
- **`Registered: no` in the log**: register the node in the dashboard Compute tab.
- **vLLM exits at start**: it needs an NVIDIA GPU and `--model`; first start downloads the model (`SPINDLE_VLLM_START_TIMEOUT`, default 900 s).

## Probes

The server may send `probe.start`: `hardware` re-detects the GPUs; `bench` runs a fixed prompt (`max_tokens 200`,
`temperature 0`) and reports tok/s (decode phase), time to first token and the model digest. Probes queue behind a
running job. All probe data is self-reported (see the verification page).

## Building the distribution and images (maintainers)

```sh
bun run node:dist          # in app/: writes data/node-dist (NODE_DIST_DIR): manifest.json, install.*, <engine>/<arch>/context.tar.gz
make -C node node-image    # local ollama image for the host arch -> spindle-node:ollama-local (house node)
make -C node node-image-vllm
```
`node/docker/Dockerfile.ollama` and `Dockerfile.vllm` are the single source of the pinned base images; both the
maintainer build and the context tarballs served to testers use them (`node:dist` copies them in as `Dockerfile`).
The API serves `NODE_DIST_DIR` at `/v1/node/*`; the backend image builds it. We never push images anywhere.
Set `DOCKER="sudo docker"` if needed.
