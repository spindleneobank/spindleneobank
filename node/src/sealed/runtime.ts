import { canonicalJson, sha256Hex } from '@spindle/shared/canonical-json';
import type { AttestationBundle, JobStartMsg } from '@spindle/shared/node-protocol';
import type { SendFn } from '../send';
import {
  type CollectDeps,
  type Collected,
  collectAttestation,
  defaultCollectDeps,
  type ReceiptAttestation,
} from './attest';
import { CvmHpke } from './hpke';

/** What the job runner needs for one sealed job. */
export interface SealedJobCtx {
  /** The decrypted job (`request` = the buyer's plaintext request). Never leaves the CVM. */
  plain: JobStartMsg;
  /** `job.start` as the gateway sent it, with `request` = the sealed envelope (this is what receipts digest). */
  receiptJob: JobStartMsg;
  /** Wraps the node connection: seals `job.chunk` deltas and the `job.done` output to the buyer, in order. */
  send: SendFn;
  attestation: ReceiptAttestation;
}

export const REFRESH_INTERVAL_MS = 50 * 60_000;

export interface SealedRuntimeOptions {
  nodeKey: string;
  send: SendFn;
  log: { info(m: string): void; warn(m: string): void };
  collectDeps?: CollectDeps;
  refreshMs?: number;
}

/** Sealed-lane state of a node running inside a dstack CVM: the HPKE key, the current attestation, sealed jobs. */
export class SealedRuntime {
  private current: ReceiptAttestation | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private readonly hpke: CvmHpke,
    private readonly o: SealedRuntimeOptions,
  ) {}

  static async create(o: SealedRuntimeOptions): Promise<SealedRuntime> {
    return new SealedRuntime(await CvmHpke.generate(), o);
  }

  get publicKey(): string {
    return this.hpke.publicKey;
  }

  private async collect(): Promise<Collected> {
    return collectAttestation(this.hpke.publicKey, this.o.nodeKey, this.o.collectDeps ?? defaultCollectDeps);
  }

  /** Fresh bundle for `hello`. */
  async attestForHello(): Promise<AttestationBundle> {
    const c = await this.collect();
    this.current = c.receipt;
    return c.bundle;
  }

  /** Sends `attest.refresh` every 50 minutes (the backend treats attestations as valid for 1 h). */
  startRefresh(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refreshNow(), this.o.refreshMs ?? REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refreshNow(): Promise<boolean> {
    try {
      const c = await this.collect();
      const ok = this.o.send({ v: 1, type: 'attest.refresh', attestation: c.bundle });
      if (ok) this.current = c.receipt;
      this.o.log.info('sealed attestation refreshed');
      return ok;
    } catch (e) {
      this.o.log.warn(`attestation refresh failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Opens a sealed `job.start`; throws if it cannot be decrypted (wrong key, wrong node/model, tampering). */
  async open(job: JobStartMsg): Promise<SealedJobCtx> {
    if (!job.sealed) throw new Error('not a sealed job');
    if (!this.current) throw new Error('node has no attestation yet');
    const { request, ephemeralPub } = await this.hpke.open(
      job.sealed.enc,
      job.sealed.ciphertext,
      this.o.nodeKey,
      job.model,
    );
    const sealer = await this.hpke.sealer(ephemeralPub, job.jobId);
    // Frames are sealed asynchronously but must reach the wire in order: chain them.
    let chain: Promise<unknown> = Promise.resolve();
    const raw = this.o.send;
    const send: SendFn = (msg) => {
      chain = chain
        .then(async () => {
          if (msg.type === 'job.chunk') {
            raw({ ...msg, delta: { content: await sealer.seal({ delta: msg.delta }) }, sealed: true });
          } else if (msg.type === 'job.done') {
            const frame = await sealer.seal({ output: msg.output, usage: msg.usage });
            // token counts stay inside the ciphertext: billing is per GPU-hour
            raw({
              ...msg,
              output: { sealed: frame },
              usage: { promptTokens: 0, completionTokens: 0 },
              sealed: true,
            });
          } else raw(msg);
        })
        .catch(() => {
          raw({ v: 1, type: 'job.error', jobId: job.jobId, code: 'ENGINE_ERROR', message: 'sealing failed' });
        });
      return true;
    };
    const envelope = { enc: job.sealed.enc, ciphertext: job.sealed.ciphertext };
    return {
      plain: { ...job, request: { ...request, model: job.model }, sealed: undefined },
      receiptJob: { ...job, request: envelope },
      send,
      attestation: this.current,
    };
  }
}

export const envelopeDigest = (e: { enc: string; ciphertext: string }): string => sha256Hex(canonicalJson(e));
export const sealedEnabled = (): boolean => process.env.SPINDLE_SEALED === '1';
