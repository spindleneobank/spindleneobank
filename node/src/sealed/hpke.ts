/**
 * HPKE for the sealed lane, inside the CVM. The key pair is generated at start-up and lives only in this
 * process's memory (never written to disk or logged) and dies with the CVM.
 */
import { generateKeyPair, openRequest, ResponseSealer, type SealedKeyPair } from '@spindle/shared/sealed';

export class CvmHpke {
  private constructor(private readonly kp: SealedKeyPair) {}

  static async generate(): Promise<CvmHpke> {
    return new CvmHpke(await generateKeyPair());
  }

  /** Raw X25519 public key, base64: what goes into the attestation bundle. */
  get publicKey(): string {
    return this.kp.publicKey;
  }

  /** `open(enc, ciphertext)`: decrypts a buyer's sealed request. AAD binds this node's key and the model. */
  open(enc: string, ciphertext: string, nodeKey: string, model: string) {
    return openRequest(this.kp.privateKey, { enc, ciphertext }, nodeKey, model);
  }

  /** `sealResponse`: frames are keyed from the request's HPKE context, so only this key's holder can produce them. */
  sealer(responseSecret: Uint8Array, jobId: string): Promise<ResponseSealer> {
    return ResponseSealer.create(responseSecret, jobId);
  }
}
