import type { EnsureModel } from '@spindle/shared/node-protocol';
import type { Engine } from './engine';
import type { Logger } from './log';
import type { SendFn } from './send';

export interface ModelSyncOptions {
  engine: Engine;
  send: SendFn;
  log: Logger;
  /** progress throttle */
  minIntervalMs?: number;
  minDeltaPct?: number;
}

/** Handles models.ensure: sequential pulls, throttled progress, then models.ready. */
export class ModelSync {
  private chain: Promise<void> = Promise.resolve();
  private active = 0;
  /** catalog id -> digest */
  readonly ready = new Map<string, string>();

  constructor(private readonly o: ModelSyncOptions) {}

  get loading(): boolean {
    return this.active > 0;
  }

  ensure(models: EnsureModel[]): Promise<void> {
    this.active++;
    const run = this.chain.then(() => this.runBatch(models));
    this.chain = run.catch(() => {}).then(() => {
      this.active--;
    });
    return this.chain;
  }

  private async runBatch(models: EnsureModel[]): Promise<void> {
    const { engine, send, log } = this.o;
    const minInterval = this.o.minIntervalMs ?? 1000;
    const minDelta = this.o.minDeltaPct ?? 5;
    for (const m of models) {
      let lastAt = 0;
      let lastPct = -100;
      try {
        const digest = await engine.ensureModel(m.engineModel, (pct) => {
          const now = Date.now();
          if (pct < 100 && now - lastAt < minInterval && pct - lastPct < minDelta) return;
          lastAt = now;
          lastPct = pct;
          send({ v: 1, type: 'models.progress', id: m.id, pct: Math.max(0, Math.min(100, pct)) });
        });
        this.ready.set(m.id, digest);
        log.info(`model ready: ${m.id} (${m.engineModel})`);
      } catch (e) {
        log.error(`failed to ensure model ${m.id} (${m.engineModel}): ${(e as Error).message}`);
      }
    }
    send({
      v: 1,
      type: 'models.ready',
      models: [...this.ready].map(([id, digest]) => ({ id, digest })),
    });
  }
}
