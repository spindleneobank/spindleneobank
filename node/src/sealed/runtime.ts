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
  /** Waits until every queued chunk is sealed and sent; returns the text the receipt's output digest covers
   *  (the sealed chunk frames, i.e. ciphertext: a verifier can recompute it from what the gateway relayed). */
  settle(): Promise<string>;
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

  /** Retry delays after a failed local collection (dstack / GPU tools hiccup); the next scheduled refresh is 50 min away. */
  retryDelaysMs = [60_000, 120_000, 300_000];

  async refreshNow(attempt = 0): Promise<boolean> {
    try {
      const c = await this.collect();
      const ok = this.o.send({ v: 1, type: 'attest.refresh', attestation: c.bundle });
      if (ok) this.current = c.receipt;
      this.o.log.info('sealed attestation refreshed');
      return ok;
    } catch (e) {
      this.o.log.warn(`attestation refresh failed: ${(e as Error).message}`);
      const delay = this.retryDelaysMs[attempt];
      if (delay !== undefined) {
        const t = setTimeout(() => void this.refreshNow(attempt + 1), delay);
        t.unref?.();
      }
      return false;
    }
  }

  /** Opens a sealed `job.start`; throws if it cannot be decrypted (wrong key, wrong node/model, tampering). */
  async open(job: JobStartMsg): Promise<SealedJobCtx> {
    if (!job.sealed) throw new Error('not a sealed job');
    if (!this.current) throw new Error('node has no attestation yet');
    const { request, responseSecret } = await this.hpke.open(
      job.sealed.enc,
      job.sealed.ciphertext,
      this.o.nodeKey,
      job.model,
    );
    const sealer = await this.hpke.sealer(responseSecret, job.jobId);
    // Frames are sealed asynchronously but must reach the wire in order: chain them.
    let chain: Promise<unknown> = Promise.resolve();
    const chunkFrames: string[] = [];
    const raw = this.o.send;
    const send: SendFn = (msg) => {
      chain = chain
        .then(async () => {
          if (msg.type === 'job.chunk') {
            const frame = await sealer.seal({ delta: msg.delta });
            chunkFrames.push(frame);
            raw({ ...msg, delta: { content: frame }, sealed: true });
          } else if (msg.type === 'job.done') {
            const frame = await sealer.seal({ output: msg.output, usage: msg.usage });
            const end = await sealer.end(); // frame count lets the buyer detect truncation
            // token counts stay inside the ciphertext: billing is per GPU-hour
            raw({
              ...msg,
              output: { sealed: frame, end },
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
      settle: async () => {
        await chain;
        return chunkFrames.join('\n');
      },
      attestation: this.current,
    };
  }
}

export const envelopeDigest = (e: { enc: string; ciphertext: string }): string => sha256Hex(canonicalJson(e));
export const sealedEnabled = (): boolean => process.env.SPINDLE_SEALED === '1';
