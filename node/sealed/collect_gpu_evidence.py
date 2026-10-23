#!/usr/bin/env python3
"""Collect NVIDIA GPU attestation evidence for NRAS (remote verification happens on the Spindle backend).

Usage: collect_gpu_evidence.py <nonce-hex-32-bytes>
Prints JSON: {"arch": "HOPPER"|"BLACKWELL", "evidence_list": [{"evidence": "<b64>", "certificate": "<b64>"}, ...]}

UNVERIFIED ON HARDWARE. Written against nv-attestation-sdk (NVIDIA/nvtrust guest_tools/attestation_sdk). The SDK API
changes between releases; the tester pins NV_ATTESTATION_SDK_VERSION and fixes this script if needed.
"""
import json
import re
import subprocess
import sys

from nv_attestation_sdk import attestation


def gpu_arch() -> str:
    out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, check=True).stdout
    name = out.splitlines()[0].upper()
    if re.search(r"H100|H200|H800", name):
        return "HOPPER"
    if re.search(r"B100|B200|B300|GB200", name):
        return "BLACKWELL"
    raise SystemExit(f"unsupported GPU for sealed lane: {name}")


def main() -> None:
    nonce = sys.argv[1]
    if not re.fullmatch(r"[0-9a-fA-F]{64}", nonce):
        raise SystemExit("nonce must be 32 bytes hex")
    client = attestation.Attestation()
    client.set_name("spindle-sealed-node")
    client.set_nonce(nonce)
    client.add_verifier(attestation.Devices.GPU, attestation.Environment.REMOTE, "https://nras.attestation.nvidia.com/v3/attest/gpu", "")
    evidence = client.get_evidence()
    print(json.dumps({"arch": gpu_arch(), "evidence_list": evidence}))


if __name__ == "__main__":
    main()
