import type { ProbeResultMsg, ProbeStartMsg } from '@spindle/shared/node-protocol';
import { runBenchmark } from './bench';
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
}

/** Handles probe.start. Probes run one at a time and only while no job is in flight. */
export class ProbeRunner {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly o: ProbeRunnerOptions) {}

  /** Queue a probe; the returned promise settles after the result was sent. */
  handle(m: ProbeStartMsg): Promise<void> {
    const next = this.chain.then(() => this.run(m)).catch(() => {});
    this.chain = next;
    return next;
  }

  private async run(m: ProbeStartMsg): Promise<void> {
    const { send, log } = this.o;
    while (this.o.busy()) await this.o.idle();
    try {
      const msg: ProbeResultMsg = { v: 1, type: 'probe.result', probeId: m.probeId };
      if (m.kind === 'hardware') msg.hardware = await (this.o.hardware ?? detectHardware)();
      else msg.bench = await runBenchmark(this.o.engine, m.params.model);
      send(msg);
    } catch (e) {
      // Send an empty result so the server counts a miss instead of waiting for a timeout.
      log.warn(`probe ${m.probeId} (${m.kind}) failed: ${(e as Error).message}`);
      send({ v: 1, type: 'probe.result', probeId: m.probeId });
    }
  }
}
