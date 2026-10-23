# Spindle node

The node agent connects outbound to the Spindle API (works behind NAT), serves inference from a local engine
(Ollama or vLLM) and signs a receipt for every job. It ships as a Docker image; one command installs it.

> Image namespace and API URL below are placeholders until the owner publishes them
> (`SPINDLE_IMAGE`, `SPINDLE_API_URL`).

A node receives jobs only after it is **registered on-chain** (dashboard, Compute tab). Until then it stays
online and logs `Registered: no`.

## Quick start

Get an enrollment token in the dashboard (Compute tab), or omit `--token` and approve the pairing code the node
prints in its log (`docker logs -f spindle-node`).

### Linux

Requires Docker. For GPUs: NVIDIA driver + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
```sh
curl -fsSL https://<host>/install.sh | sh -s -- --token <TOKEN>
# vLLM (NVIDIA only, serves one model):
sh install.sh --token <TOKEN> --engine vllm --model Qwen/Qwen2.5-7B-Instruct
```
Without a usable GPU the node runs in CPU mode and is only offered small models.

### Windows (Docker Desktop + WSL2)

Install Docker Desktop with the WSL2 backend and, for GPUs, the current NVIDIA Windows driver.
```powershell
.\install.ps1 -Token <TOKEN>
```

### macOS

Containers cannot use the Apple GPU, so the node uses a **native Ollama** on the host (Metal):
```sh
brew install ollama && brew services start ollama
sh install.sh --token <TOKEN>
```
The container talks to the host through `host.docker.internal:11434`; `--gpus` is never used on macOS.

### Compose

`compose.example.yml` is a single-service alternative: `SPINDLE_TOKEN=<token> docker compose -f compose.example.yml up -d`.

## Installer options

`--token --engine ollama|vllm --model --name --api --image --tag --no-pull --dry-run --uninstall --purge`
(PowerShell: `-Token -Engine -Model -Name -Api -Image -Tag -NoPull -DryRun -Uninstall -Purge`).

Re-running the installer replaces the container and keeps the volume, so the node keeps its identity.
`--uninstall` removes only the container. `--purge` also deletes the volume after you type its name.

## Data volume and key backup

Volume `spindle-node` mounts at `/data` and holds `node-key.json` (the node identity, mode 0600) and the Ollama
models (`/data/ollama`). **Losing the volume makes this a new node** that must re-enroll and re-register. Back up the key:
```sh
docker run --rm -v spindle-node:/data -v "$PWD":/backup alpine cp /data/node-key.json /backup/
```
The Ollama image runs as uid 10001; bind-mounted host directories must be writable by that uid.

## Update

```sh
docker pull <image>:ollama   # or :vllm
sh install.sh ...            # same arguments; replaces the container, keeps the volume
```
If the log says `agent too old`, update this way.

## Troubleshooting

- **`Cannot reach the Docker daemon`**: start Docker (Desktop), or add your user to the `docker` group.
- **CPU mode on a GPU machine (Linux)**: `nvidia-smi` must work on the host and `docker info | grep -i nvidia` must list the runtime; install the container toolkit and `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`.
- **Windows**: Docker Desktop must use Linux containers and the WSL2 engine; update the NVIDIA Windows driver (do not install a Linux driver inside WSL). Test: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
- **Apple Silicon**: use the native Ollama (see macOS). The container image itself is arm64 and CPU-only.
- **`Registered: no` in the log**: register the node in the dashboard Compute tab.
- **vLLM exits at start**: it needs an NVIDIA GPU and `--model`; first start downloads the model (`SPINDLE_VLLM_START_TIMEOUT`, default 900 s).

## Probes

The server may send `probe.start`: `hardware` re-detects the GPUs; `bench` runs a fixed prompt (`max_tokens 200`,
`temperature 0`) and reports tok/s (decode phase), time to first token and the model digest. Probes queue behind a
running job. All probe data is self-reported (see the verification page).

## Building the images (maintainers)

```sh
make -C node node-image                 # local ollama image for the host arch -> spindle-node:ollama-local
make -C node node-image-vllm            # local vllm image (amd64, large)
make -C node node-image-push IMAGE=<ns>/spindle-node PUSH=1   # owner only; asks you to type the image name
```
Set `DOCKER="sudo docker"` if needed. The build context is the `app/` root (the agent resolves dependencies from
the root `bun.lock`). Base images are pinned by version and digest in the Dockerfiles.
