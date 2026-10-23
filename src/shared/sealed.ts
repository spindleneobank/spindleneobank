/**
 * Sealed lane crypto (S1): HPKE (RFC 9180) base mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
 * Used by the buyer helper (examples/sealed-client.ts), the node (inside the CVM) and the tests. The
 * gateway never imports this file: it relays the opaque strings produced here.
 *
 * Request:  buyer seals `{ request }` to the node's attested HPKE key. AAD binds the node key and the model so
 *           the (untrusted) gateway cannot re-target a ciphertext.
 * Response: keyed from the REQUEST's HPKE context (RFC 9180 secret export -> AES-128-GCM key + base nonce), so only
 *           the holder of the node's attested private key can produce valid frames; the gateway cannot forge them.
 *           Frame i is sealed with nonce = baseNonce xor i and AAD (jobId, i): a dropped, reordered, replayed or
 *           injected frame fails. The stream ends with a sealed end frame carrying the frame count, so a truncated
 *           stream is detected by the buyer.
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
  return {
    publicKey: b64(new Uint8Array(await suite().kem.serializePublicKey(kp.publicKey))),
    privateKey: kp.privateKey,
  };
}

const requestAad = (nodeKey: string, model: string): Uint8Array =>
  enc8.encode(`${SEALED_VERSION}|${nodeKey.toLowerCase()}|${model}`);

/** The `sealed` object a buyer sends to the gateway (opaque ciphertext plus public routing data). */
export interface SealedEnvelope {
  nodeKey: string;
  enc: string;
  ciphertext: string;
}

export interface SealedRequest {
  envelope: SealedEnvelope;
  /** Opens the sealed response frames, in order. */
  openResponse: ResponseOpener;
}

const EXPORT_CONTEXT = enc8.encode(`${SEALED_VERSION}/response-secret`);

/** Buyer: seal an OpenAI-style request to the node's attested HPKE public key. */
export async function sealRequest(p: {
  nodePublicKey: string;
  nodeKey: string;
  model: string;
  request: unknown;
}): Promise<SealedRequest> {
  const s = suite();
  const pk = await s.kem.deserializePublicKey(unb64(p.nodePublicKey));
  const sender = await s.createSenderContext({
    recipientPublicKey: pk,
    info: enc8.encode(`${SEALED_VERSION}/request`),
  });
  const ct = await sender.seal(
    enc8.encode(JSON.stringify({ request: p.request })),
    requestAad(p.nodeKey, p.model),
  );
  const secret = new Uint8Array(await sender.export(EXPORT_CONTEXT, 28));
  return {
    envelope: {
      nodeKey: p.nodeKey,
      enc: b64(new Uint8Array(sender.enc)),
      ciphertext: b64(new Uint8Array(ct)),
    },
    openResponse: new ResponseOpener(secret),
  };
}

/** Node (inside the CVM): open a sealed request. Throws on any tampering or AAD mismatch. */
export async function openRequest(
  privateKey: CryptoKey,
  sealed: { enc: string; ciphertext: string },
  nodeKey: string,
  model: string,
): Promise<{ request: Record<string, unknown>; responseSecret: Uint8Array }> {
  const s = suite();
  const ctx = await s.createRecipientContext({
    recipientKey: privateKey,
    enc: unb64(sealed.enc),
    info: enc8.encode(`${SEALED_VERSION}/request`),
  });
  const pt = await ctx.open(unb64(sealed.ciphertext), requestAad(nodeKey, model));
  const j = JSON.parse(dec8.decode(pt)) as { request?: Record<string, unknown> };
  if (!j.request) throw new Error('malformed sealed request');
  return { request: j.request, responseSecret: new Uint8Array(await ctx.export(EXPORT_CONTEXT, 28)) };
}

// ---- response frames --------------------------------------------------------------------------------------

class FrameCipher {
  private key: Promise<CryptoKey>;
  private base: Uint8Array<ArrayBuffer>;
  constructor(
    secret: Uint8Array,
    private readonly jobId: string,
  ) {
    this.key = crypto.subtle.importKey('raw', new Uint8Array(secret.slice(0, 16)), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
    this.base = new Uint8Array(secret.slice(16, 28));
  }
  private params(i: number) {
    const iv = this.base.slice();
    const v = new DataView(iv.buffer);
    v.setUint32(8, (v.getUint32(8) ^ i) >>> 0);
    return {
      name: 'AES-GCM',
      iv,
      additionalData: enc8.encode(`${SEALED_VERSION}/response|${this.jobId}|${i}`) as Uint8Array<ArrayBuffer>,
    };
  }
  async encrypt(i: number, plaintext: Uint8Array<ArrayBuffer>): Promise<string> {
    return b64(new Uint8Array(await crypto.subtle.encrypt(this.params(i), await this.key, plaintext)));
  }
  async decrypt(i: number, frame: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.decrypt(this.params(i), await this.key, unb64(frame)));
  }
}

/** Node: seals response frames, in order, with keys derived from the request's HPKE context. */
export class ResponseSealer {
  private n = 0;
  private cipher: FrameCipher;
  constructor(responseSecret: Uint8Array, jobId: string) {
    this.cipher = new FrameCipher(responseSecret, jobId);
  }
  static create(responseSecret: Uint8Array, jobId: string): Promise<ResponseSealer> {
    return Promise.resolve(new ResponseSealer(responseSecret, jobId));
  }
  /** Opaque base64 string. Frames must be delivered in the order they were sealed. */
  seal(frame: unknown): Promise<string> {
    return this.cipher.encrypt(this.n++, enc8.encode(JSON.stringify(frame)));
  }
  /** The end-of-stream frame: carries the number of frames sealed before it. Call exactly once, last. */
  end(): Promise<string> {
    const count = this.n;
    return this.cipher.encrypt(this.n++, enc8.encode(JSON.stringify({ end: true, count })));
  }
}

/** Buyer: opens response frames in the order they arrive and verifies the end frame. */
export class ResponseOpener {
  private n = 0;
  private cipher: FrameCipher | null = null;
  private ended = false;
  constructor(private readonly secret: Uint8Array) {}

  private c(jobId: string): FrameCipher {
    this.cipher ??= new FrameCipher(this.secret, jobId);
    return this.cipher;
  }

  async open<T = unknown>(frame: string, jobId: string): Promise<T> {
    if (this.ended) throw new Error('frame after the end of the stream');
    const v = JSON.parse(dec8.decode(await this.c(jobId).decrypt(this.n, frame))) as T;
    this.n++;
    return v;
  }

  /** Opens the end frame and checks the count; throws if the stream was truncated or padded. */
  async close(frame: string | null | undefined, jobId: string): Promise<void> {
    if (!frame) throw new Error('sealed stream truncated: no end frame');
    let v: { end?: boolean; count?: number };
    try {
      v = JSON.parse(dec8.decode(await this.c(jobId).decrypt(this.n, frame)));
    } catch {
      throw new Error('sealed stream truncated: end frame does not authenticate at this position');
    }
    if (v.end !== true || v.count !== this.n)
      throw new Error('sealed stream truncated: frame count mismatch');
    this.ended = true;
  }
}
