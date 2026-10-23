/**
 * dstack / TDX helpers shared by the backend verifier and the node's attestation collector, so that both sides
 * compute the report_data binding and the RTMR3 replay with the same code.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export class AttestError extends Error {
  constructor(
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'AttestError';
  }
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');
export const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};
const sha384 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('sha384');
  for (const p of parts) h.update(p);
  return h.digest();
};

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** report_data = sha256(hpkePub || nodeKey(20 bytes) || nonce(32 bytes)) zero-padded to 64 bytes. */
export function expectedReportData(hpkePublicKeyB64: string, nodeKey: string, nonceHex: string): string {
  if (!ADDR.test(nodeKey)) throw new AttestError('BAD_NODE_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(nonceHex)) throw new AttestError('BAD_NONCE', 'nonce must be 32 bytes hex');
  const pub = Buffer.from(hpkePublicKeyB64, 'base64');
  if (pub.length !== 32) throw new AttestError('BAD_HPKE_KEY', 'HPKE public key must be 32 bytes (X25519)');
  const digest = sha256(pub, Buffer.from(nodeKey.slice(2), 'hex'), Buffer.from(nonceHex, 'hex'));
  return hex(Buffer.concat([digest, Buffer.alloc(32)]));
}

// ---- dstack RTMR3 event log -----------------------------------------------------------------------------

export const DstackEvent = z.object({
  imr: z.number().int(),
  event_type: z.number().int(),
  digest: z.string(),
  event: z.string().default(''),
  event_payload: z.string().default(''),
});
export type DstackEvent = z.infer<typeof DstackEvent>;
export const DSTACK_RUNTIME_EVENT_TYPE = 0x08000001;

export function parseEventLog(raw: unknown): DstackEvent[] {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new AttestError('EVENT_LOG_MALFORMED');
    }
  }
  const r = z.array(DstackEvent).safeParse(v);
  if (!r.success) throw new AttestError('EVENT_LOG_MALFORMED', r.error.issues[0]?.message);
  return r.data;
}

/** Runtime event digest as dstack computes it: sha384(u32le(type) ":" event ":" payload). */
export function runtimeEventDigest(e: DstackEvent): string {
  const t = Buffer.alloc(4);
  t.writeUInt32LE(e.event_type >>> 0);
  return hex(
    sha384(t, Buffer.from(':'), Buffer.from(e.event), Buffer.from(':'), Buffer.from(e.event_payload, 'hex')),
  );
}

/**
 * Replays RTMR3 from the event log (extend = sha384(rtmr || digest)). Runtime events must carry the digest that
 * their (event, payload) content hashes to, so named events like `compose-hash` cannot be forged independently
 * of the measured digest. Returns the replayed RTMR3 and the named events.
 */
export function replayRtmr3(events: DstackEvent[]): { rtmr3: string; named: Map<string, string> } {
  let rtmr: Uint8Array = Buffer.alloc(48);
  const named = new Map<string, string>();
  for (const e of events) {
    if (e.imr !== 3) continue;
    if (!/^[0-9a-fA-F]{96}$/.test(e.digest))
      throw new AttestError('EVENT_LOG_MALFORMED', 'digest must be sha384');
    if (e.event_type === DSTACK_RUNTIME_EVENT_TYPE) {
      if (runtimeEventDigest(e) !== e.digest.toLowerCase())
        throw new AttestError('EVENT_LOG_DIGEST', `event ${e.event} digest does not match its content`);
      const payload = e.event_payload.toLowerCase();
      const prev = named.get(e.event);
      // the guest app can emit its own runtime events later; a conflicting duplicate is never accepted
      if (prev !== undefined && prev !== payload)
        throw new AttestError('EVENT_LOG_DUPLICATE', `conflicting ${e.event} events`);
      named.set(e.event, payload);
    }
    rtmr = sha384(rtmr, Buffer.from(e.digest, 'hex'));
  }
  return { rtmr3: hex(rtmr), named };
}
