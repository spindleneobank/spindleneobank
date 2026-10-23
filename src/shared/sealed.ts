/**
 * Sealed lane crypto (S1): HPKE (RFC 9180) base mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
 * Used by the buyer helper (examples/sealed-client.ts), the node (inside the CVM) and the tests. The
 * gateway never imports this file: it relays the opaque strings produced here.
 *
 * Request:  buyer seals `{ request, ephemeralPub }` to the node's attested HPKE key. AAD binds the
 *           node key and the model so the (untrusted) gateway cannot re-target a ciphertext.
 * Response: the node opens ONE HPKE sender context towards the buyer's ephemeral key and seals every
 *           frame (chunks, then the final output) with it, in order. The first frame carries `enc`.
 *           A dropped, reordered or replayed frame fails AEAD decryption (the sequence number is
 *           part of the nonce).
 */
import { AeadId, Aes128Gcm, CipherSuite, HkdfSha256, KdfId } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';

export const SEALED_VERSION = 'spindle-sealed-v1';
const enc8 = new TextEncoder();
const dec8 = new TextDecoder();

export const suite = (): CipherSuite =>
  new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
export const SUITE_IDS = { kem: 0x0020, kdf: KdfId.HkdfSha256, aead: AeadId.Aes128Gcm } as const;

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64'));

export interface SealedKeyPair {
  /** raw 32-byte X25519 public key, base64 */
  publicKey: string;
  privateKey: CryptoKey;
}

export async function generateKeyPair(): Promise<SealedKeyPair> {
  const kp = await suite().kem.generateKeyPair();
  return { publicKey: b64(new Uint8Array(await suite().kem.serializePublicKey(kp.publicKey))), privateKey: kp.privateKey };
}

const requestAad = (nodeKey: string, model: string): Uint8Array =>
  enc8.encode(`${SEALED_VERSION}|${nodeKey.toLowerCase()}|${model}`);

/** The `sealed` object a buyer sends to the gateway (all fields opaque or public routing data). */
export interface SealedEnvelope {
  nodeKey: string;
  enc: string;
  ciphertext: string;
  /** Redundant routing copy of the buyer's response key; the node only trusts the copy inside the ciphertext. */
  ephemeralPub: string;
}

export interface SealedRequest {
  envelope: SealedEnvelope;
  /** Opens the sealed response frames, in order. */
  openResponse: ResponseOpener;
}

/** Buyer: seal an OpenAI-style request to the node's attested HPKE public key. */
export async function sealRequest(p: {
  nodePublicKey: string;
  nodeKey: string;
  model: string;
  request: unknown;
}): Promise<SealedRequest> {
  const s = suite();
  const eph = await generateKeyPair();
  const pk = await s.kem.deserializePublicKey(unb64(p.nodePublicKey));
  const sender = await s.createSenderContext({ recipientPublicKey: pk, info: enc8.encode(`${SEALED_VERSION}/request`) });
  const plaintext = enc8.encode(JSON.stringify({ request: p.request, ephemeralPub: eph.publicKey }));
  const ct = await sender.seal(plaintext, requestAad(p.nodeKey, p.model));
  return {
    envelope: { nodeKey: p.nodeKey, enc: b64(new Uint8Array(sender.enc)), ciphertext: b64(new Uint8Array(ct)), ephemeralPub: eph.publicKey },
    openResponse: new ResponseOpener(eph.privateKey),
  };
}

/** Node (inside the CVM): open a sealed request. Throws on any tampering or AAD mismatch. */
export async function openRequest(
  privateKey: CryptoKey,
  sealed: { enc: string; ciphertext: string },
  nodeKey: string,
  model: string,
): Promise<{ request: Record<string, unknown>; ephemeralPub: string }> {
  const s = suite();
  const ctx = await s.createRecipientContext({
    recipientKey: privateKey,
    enc: unb64(sealed.enc),
    info: enc8.encode(`${SEALED_VERSION}/request`),
  });
  const pt = await ctx.open(unb64(sealed.ciphertext), requestAad(nodeKey, model));
  const j = JSON.parse(dec8.decode(pt)) as { request?: Record<string, unknown>; ephemeralPub?: string };
  if (!j.request || typeof j.ephemeralPub !== 'string') throw new Error('malformed sealed request');
  return { request: j.request, ephemeralPub: j.ephemeralPub };
}

const respAad = (jobId: string): Uint8Array => enc8.encode(`${SEALED_VERSION}/response|${jobId}`);

/** Node: seals response frames to the buyer's ephemeral key with one sender context. */
export class ResponseSealer {
  private first = true;
  private constructor(
    private readonly ctx: Awaited<ReturnType<CipherSuite['createSenderContext']>>,
    private readonly jobId: string,
  ) {}

  static async create(buyerEphemeralPub: string, jobId: string): Promise<ResponseSealer> {
    const s = suite();
    const pk = await s.kem.deserializePublicKey(unb64(buyerEphemeralPub));
    const ctx = await s.createSenderContext({ recipientPublicKey: pk, info: enc8.encode(`${SEALED_VERSION}/response`) });
    return new ResponseSealer(ctx, jobId);
  }

  /** Returns an opaque string: `<b64 enc>:<b64 ct>` for the first frame, `<b64 ct>` afterwards. */
  async seal(frame: unknown): Promise<string> {
    const ct = b64(new Uint8Array(await this.ctx.seal(enc8.encode(JSON.stringify(frame)), respAad(this.jobId))));
    if (!this.first) return ct;
    this.first = false;
    return `${b64(new Uint8Array(this.ctx.enc))}:${ct}`;
  }
}

/** Buyer: opens response frames in the order they arrive. */
export class ResponseOpener {
  private ctx: Awaited<ReturnType<CipherSuite['createRecipientContext']>> | null = null;
  constructor(private readonly privateKey: CryptoKey) {}

  async open<T = unknown>(frame: string, jobId: string): Promise<T> {
    let body = frame;
    if (!this.ctx) {
      const i = frame.indexOf(':');
      if (i < 0) throw new Error('first sealed frame must carry enc');
      this.ctx = await suite().createRecipientContext({
        recipientKey: this.privateKey,
        enc: unb64(frame.slice(0, i)),
        info: enc8.encode(`${SEALED_VERSION}/response`),
      });
      body = frame.slice(i + 1);
    }
    return JSON.parse(dec8.decode(await this.ctx.open(unb64(body), respAad(jobId)))) as T;
  }
}
