/**
 * Sealed lane buyer example (S1, "in testing"). Reference implementation for the docs.
 *
 *   SPINDLE_API_URL=https://api.example SPINDLE_API_KEY=sk-spdl-... bun examples/sealed-client.ts "Why is the sky blue?"
 *
 * Flow: GET /v1/sealed/keys -> pick a node and inspect its attestation summary -> seal the request to the node's
 * attested HPKE key (RFC 9180, X25519 / HKDF-SHA256 / AES-128-GCM) -> POST with `X-Spindle-Lane: sealed` ->
 * open the sealed response frames locally. The gateway only ever sees the opaque envelope.
 *
 * Trust: the gateway (and its attestation verifier) tells you which key is attested. To not trust the operator
 * for that, verify the quote and NVIDIA token yourself from the receipt/attestation bundle (see docs/plan/sealed-testing.md).
 */
import { sealRequest } from '../src/shared/sealed';

const API = process.env.SPINDLE_API_URL ?? 'http://localhost:7200';
const KEY = process.env.SPINDLE_API_KEY ?? '';
const MODEL = process.env.SPINDLE_MODEL ?? 'qwen2.5:7b';

interface SealedKey {
  nodeId: string;
  nodeKey: string;
  hpkePublicKey: string;
  attestationRef: string;
  attestationSummary: {
    quoteHash: string;
    rtmr3: string;
    composeHash: string;
    tcbStatus: string;
    gpuArch: string;
  };
  expiresAt: string;
}

export async function fetchKeys(model: string, api = API): Promise<SealedKey[]> {
  const res = await fetch(`${api}/v1/sealed/keys?model=${encodeURIComponent(model)}`);
  if (!res.ok) throw new Error(`sealed keys: HTTP ${res.status} (is the sealed lane enabled?)`);
  return (await res.json()) as SealedKey[];
}

/** Seals a chat request to `node`, calls the gateway and returns the decrypted assistant text. */
export async function sealedChat(opts: {
  node: SealedKey;
  prompt: string;
  model?: string;
  apiKey?: string;
  api?: string;
  onToken?: (t: string) => void;
}): Promise<{ text: string; jobId: string; chargeMicros: string }> {
  const model = opts.model ?? MODEL;
  const api = opts.api ?? API;
  const sealed = await sealRequest({
    nodePublicKey: opts.node.hpkePublicKey,
    nodeKey: opts.node.nodeKey,
    model,
    request: { model, messages: [{ role: 'user', content: opts.prompt }] },
  });
  const res = await fetch(`${api}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey ?? KEY}`,
      'X-Spindle-Lane': 'sealed',
    },
    body: JSON.stringify({ model, stream: true, sealed: sealed.envelope }),
  });
  if (!res.ok || !res.body) throw new Error(`sealed chat: HTTP ${res.status} ${await res.text()}`);
  const jobId = res.headers.get('X-Spindle-Job-Id') ?? '';
  let text = '';
  let charge = '0';
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(part, { stream: true });
    for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const ev = JSON.parse(line.slice(6)) as {
        sealed?: string | null;
        final?: boolean;
        spindle?: { chargeMicros: string };
        error?: { message: string };
      };
      if (ev.error) throw new Error(ev.error.message);
      if (ev.sealed) {
        const frame = await sealed.openResponse.open<{ delta?: { content?: string } }>(ev.sealed, jobId);
        if (frame.delta?.content) {
          text += frame.delta.content;
          opts.onToken?.(frame.delta.content);
        }
      }
      if (ev.final) charge = ev.spindle?.chargeMicros ?? charge;
    }
  }
  return { text, jobId, chargeMicros: charge };
}

if (import.meta.main) {
  const prompt = process.argv.slice(2).join(' ') || 'Say hello from inside a confidential VM.';
  const keys = await fetchKeys(MODEL);
  const node = keys[0];
  if (!node) {
    console.error('No attested sealed node is available for this model.');
    process.exit(1);
  }
  console.error(
    `sealing to node ${node.nodeKey}\n  attestation ${node.attestationRef} expires ${node.expiresAt}\n  TCB ${node.attestationSummary.tcbStatus}, GPU ${node.attestationSummary.gpuArch}, compose ${node.attestationSummary.composeHash}`,
  );
  const r = await sealedChat({ node, prompt, onToken: (t) => process.stdout.write(t) });
  console.error(`\njob ${r.jobId}, charged ${r.chargeMicros} USDG micros (GPU-hour billing)`);
}
