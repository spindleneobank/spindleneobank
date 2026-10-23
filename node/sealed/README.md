# Spindle sealed-lane node (TDX CVM via dstack) -- "in testing"

The sealed lane runs the node agent and vLLM inside an Intel TDX confidential VM (dstack) on a host with NVIDIA
Confidential Computing (H100/H200 Hopper or B200 Blackwell). The agent generates an HPKE (X25519) key pair inside the
CVM, attaches an attestation bundle (TDX quote, RTMR3 event log, NVIDIA evidence, HPKE public key) to `hello` and every
50 minutes as `attest.refresh`, and decrypts buyer requests that the gateway relays without being able to read them.
Everything is behind `SEALED_LANE_ENABLED=false` on the backend by default.

Files:

| File | Purpose |
|---|---|
| `Dockerfile.sealed` | vLLM + agent + NVIDIA attestation tooling, `SPINDLE_SEALED=1` |
| `app-compose.json` | dstack app-compose; its hash is measured into RTMR3 and pinned in the backend allowlist |
| `compose-hash.sh` | prints `sha256(app-compose.json)` |
| `collect_gpu_evidence.py` | GPU evidence for NRAS (called by `src/sealed/nvidia.ts`) |
| `../src/sealed/*` | agent side: dstack quote, evidence, HPKE, job sealing |

## Operator steps (TDX host with H100/H200 in CC mode)

1. Host: TDX-enabled platform firmware and kernel, GPU passthrough via VFIO, dstack prerequisites.
   Follow the dstack docs (Phala-Network/dstack) for "bare metal TDX + GPU".
2. Enable GPU confidential computing mode on each GPU (host, before binding to VFIO):
   `nvidia-smi conf-compute -scc on` (ready state), then check with
   `nvidia-smi conf-compute -f` (CC status ON) and `nvidia-smi conf-compute -grs` (ready state).
   Hopper needs the `ppcie`/`cc` mode switch per NVIDIA's "Confidential Computing deployment guide" for your driver.
3. Build the image (amd64) from `app/`:
   `docker build -f node/sealed/Dockerfile.sealed --build-arg NV_ATTESTATION_SDK_VERSION=<pin> --build-arg NVTRUST_REF=<tag> -t REGISTRY/spindle-node-sealed .`
   Push it and note the digest.
4. Put the digest into `app-compose.json` (`image: ...@sha256:<digest>`), then
   `./compose-hash.sh` and send the hash plus the CVM's MRTD / RTMR0-2 (printed by the first quote, see the runbook in
   `docs/plan/sealed-testing.md`) to the Spindle operator for `src/modules/attest/allowlist.json`.
5. Deploy with dstack-vmm (`vmm-cli.py deploy --compose app-compose.json --image <dstack-nvidia-dev-or-prod-image> --gpu <pci-addr> --vcpu .. --memory .. -e SPINDLE_API_URL=... -e SPINDLE_TOKEN=... -e SPINDLE_VLLM_MODEL=...`).
   Env vars are encrypted to the CVM (`allowed_envs`).
6. The agent logs `sealed attestation refreshed` every 50 minutes. If the backend rejects the attestation the node is
   simply not eligible for sealed jobs; the reason is stored in `node_attestations.reason`.

## Threat model and honest limits

- TDX protects the CVM memory from the host and the operator; the GPU is protected by Hopper/Blackwell CC mode
  (bounce-buffer encrypted PCIe). **TDX only. No TDISP/TEE-IO.** Physical attacks on DDR5 are out of scope.
- The model weights are downloaded at runtime and are not measured by RTMR3; pin them with `SPINDLE_VLLM_MODEL` at an exact
  revision and rely on the compose hash that pins the image/arguments (model digest allowlisting is a future hardening).
- Billing is per GPU-hour from the attested receipt; the gateway cannot read token counts.

## Untested (UNVERIFIED ON HARDWARE)

Verified in unit tests with real public fixtures: DCAP verification of a real TDX quote with recorded Intel collateral,
HPKE end to end. Verified with synthetic fixtures: binding, event-log replay, allowlist, NRAS JWT handling, relay and billing.
**Not exercised on real hardware** (listed in detail with runbook steps in `docs/plan/sealed-testing.md`):

1. `src/sealed/dstack.ts`: the `/var/run/dstack.sock` `GetQuote` request/response shape.
2. A real dstack RTMR3 event log (event names, digest recipe, `compose-hash` payload) replayed by `replayRtmr3`.
3. `report_data` acceptance by a real quote (64-byte layout) through the full verifier.
4. `collect_gpu_evidence.py` and the local verifier against a real CC-mode H100/H200/B200, and the NRAS response/JWT claims.
5. Intel PCS collateral fetch (`getCollateral`) for a fresh platform, and the TCB status mapping of a real machine.
6. `Dockerfile.sealed` (never built), `app-compose.json` (placeholders), dstack-vmm deployment, GPU passthrough.
7. The allowlist values (MRTD, RTMR0-2, compose hash) of a real dstack guest image.
