/**
 * GPU evidence collection with NVIDIA's attestation tooling (nvTrust / nv-attestation-sdk) inside the CVM.
 * UNVERIFIED ON HARDWARE (needs an H100/H200/B200 in confidential-computing mode).
 *
 * 1. Pre-flight: the local GPU verifier (`python3 -m verifier.cc_admin --user_mode`) must pass, otherwise the node
 *    refuses to attest (no point sending evidence NRAS will reject).
 * 2. Evidence: `collect_gpu_evidence.py <nonce>` prints `{ arch, evidence_list: [{evidence, certificate}] }`; the
 *    backend forwards it to NRAS.
 */
export interface NvidiaEvidence {
  nonce: string;
  arch: 'HOPPER' | 'BLACKWELL';
  evidence_list: { evidence: string; certificate: string }[];
}

export interface GpuTools {
  run(cmd: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }>;
}

export const bunTools: GpuTools = {
  async run(cmd, timeoutMs) {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
      ]);
      return { code: await p.exited, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  },
};

export const LOCAL_VERIFIER = ['python3', '-m', 'verifier.cc_admin', '--user_mode'];
export const EVIDENCE_SCRIPT =
  process.env.SPINDLE_GPU_EVIDENCE_SCRIPT ?? '/opt/spindle/collect_gpu_evidence.py';

export async function collectNvidiaEvidence(
  nonceHex: string,
  tools: GpuTools = bunTools,
): Promise<NvidiaEvidence> {
  const local = await tools.run([...LOCAL_VERIFIER, '--nonce', nonceHex], 120_000);
  if (local.code !== 0) throw new Error(`NVIDIA local GPU verifier failed: ${local.stderr.slice(0, 300)}`);
  const ev = await tools.run(['python3', EVIDENCE_SCRIPT, nonceHex], 120_000);
  if (ev.code !== 0) throw new Error(`GPU evidence collection failed: ${ev.stderr.slice(0, 300)}`);
  const parsed = JSON.parse(ev.stdout) as {
    arch: 'HOPPER' | 'BLACKWELL';
    evidence_list: NvidiaEvidence['evidence_list'];
  };
  return { nonce: nonceHex, arch: parsed.arch, evidence_list: parsed.evidence_list };
}
