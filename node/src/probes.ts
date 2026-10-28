import type { ProbeResultMsg, ProbeStartMsg } from '@spindle/shared/node-protocol';
import { BenchAborted, runBenchmark } from './bench';
import type { Engine } from './engine';
import { detectHardware, type Hardware } from './hardware';
import type { Logger } from './log';
import type { SendFn } from './send';

export interface ProbeRunnerOptions {
  engine: Engine;
  send: SendFn;
  log: Logger;
  /** resolves when no job is running (JobRunner.idle) */
  idle: () => Promise<void>;
  busy: () => boolean;
  hardware?: () => Promise<Hardware>;
  /** benchmark wall-clock budget (default BENCH_MAX_MS) */
  benchMaxMs?: number;
}

interface Running {
  kind: ProbeStartMsg['kind'];
  stop: AbortController;
  done: Promise<void>;
}

/**
 * Handles probe.start. Probes run one at a time and only while no job is in flight. Jobs always win:
 * `beforeJob` stops a running benchmark (reported as aborted, which the server treats as inconclusive)
 * and queued probes wait until the job is done, so a probe never turns a paying job away.
 */
export class ProbeRunner {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;
  private current: Running | null = null;
  /** job.start calls between arrival and JobRunner.start: queued probes must not slip in. */
  private jobsArriving = 0;

  constructor(private readonly o: ProbeRunnerOptions) {}

  /** Queue a probe; the returned promise settles after the result was sent. */
  handle(m: ProbeStartMsg): Promise<void> {
    this.pending++;
    const next = this.chain
      .then(() => this.run(m))
      .catch(() => {})
      .finally(() => this.pending--);
    this.chain = next;
    return next;
  }

  /** True while a probe is running or queued. */
  get active(): boolean {
    return this.pending > 0;
  }

  /**
   * Clears the way for a job, then calls `start` (which must mark the job runner busy synchronously).
   * A running benchmark is stopped; a running hardware probe (seconds) is waited for up to `maxMs`.
   * Returns false, without calling `start`, only if the running probe did not finish in time (caller
   * replies BUSY).
   */
  async beforeJob(start: () => void, maxMs = 5000): Promise<boolean> {
    this.jobsArriving++;
    try {
      const cur = this.current;
      if (cur) {
        if (cur.kind === 'bench') cur.stop.abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ok = await Promise.race([
          cur.done.then(() => true),
          new Promise<boolean>((r) => {
            timer = setTimeout(() => r(false), maxMs);
          }),
        ]);
        clearTimeout(timer);
        if (!ok) return false;
      }
      start();
      return true;
    } finally {
      this.jobsArriving--;
    }
  }

  private async waitForJobs(): Promise<void> {
    while (this.o.busy() || this.jobsArriving > 0) {
      if (this.o.busy()) await this.o.idle();
      else await Bun.sleep(50);
    }
  }

  private async run(m: ProbeStartMsg): Promise<void> {
    const { send, log } = this.o;
    await this.waitForJobs();
    const stop = new AbortController();
    let finish!: () => void;
    this.current = { kind: m.kind, stop, done: new Promise<void>((r) => (finish = r)) };
    try {
      const msg: ProbeResultMsg = { v: 1, type: 'probe.result', probeId: m.probeId };
      if (m.kind === 'hardware') msg.hardware = await (this.o.hardware ?? detectHardware)();
      else
        msg.bench = await runBenchmark(this.o.engine, m.params.model, undefined, {
          signal: stop.signal,
          ...(this.o.benchMaxMs ? { maxMs: this.o.benchMaxMs } : {}),
        });
      send(msg);
    } catch (e) {
      if (e instanceof BenchAborted) {
        log.info(`probe ${m.probeId} stopped for a job`);
        send({ v: 1, type: 'probe.result', probeId: m.probeId, aborted: true });
        return;
      }
      // Send an empty result so the server counts a miss instead of waiting for a timeout.
      log.warn(`probe ${m.probeId} (${m.kind}) failed: ${(e as Error).message}`);
      send({ v: 1, type: 'probe.result', probeId: m.probeId });
    } finally {
      this.current = null;
      finish();
    }
  }
}
