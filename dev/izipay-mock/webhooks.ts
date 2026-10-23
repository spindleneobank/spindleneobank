import { createHmac } from 'node:crypto';
import type { MockState } from './state';

export interface WebhookConfig {
  url: string;
  secret: string;
  /** Delay between card.paid and card.issued / topup.completed (default 2000). */
  stepDelayMs: number;
}

/** hex HMAC-SHA256(raw body, secret): identical to pingapp `verifyWebhook`. */
export const signWebhook = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

export class Webhooks {
  private running = new Set<Promise<void>>();

  constructor(
    private cfg: WebhookConfig,
    private state: MockState,
  ) {}

  setUrl(url: string) {
    this.cfg.url = url;
  }

  /** Sends one signed event now. With `dup`, sends the same body (same event id) twice. */
  async send(type: string, data: Record<string, unknown>, dup = false, created?: number): Promise<void> {
    const body = JSON.stringify({
      id: this.state.nextEventId(),
      type,
      created: created ?? Math.floor(Date.now() / 1000),
      data,
    });
    const times = dup ? 2 : 1;
    for (let i = 0; i < times; i++) {
      try {
        await fetch(this.cfg.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-izipay-signature': signWebhook(this.cfg.secret, body),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        console.error(`[izipay-mock] webhook ${type} to ${this.cfg.url} failed: ${(e as Error).message}`);
      }
    }
  }

  /** Runs events in order, each after `delayMs`. Sequences run independently of each other. */
  sequence(
    steps: {
      delayMs: number;
      type: string;
      /** Runs right before the event is built (state changes that the event announces). */
      before?: () => void;
      data: Record<string, unknown> | (() => Record<string, unknown>);
      dup?: boolean;
    }[],
  ): void {
    const run = (async () => {
      for (const s of steps) {
        if (s.delayMs > 0) await new Promise((r) => setTimeout(r, s.delayMs));
        s.before?.();
        await this.send(s.type, typeof s.data === 'function' ? s.data() : s.data, s.dup);
      }
    })().finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /** Resolves when every queued delivery has finished (tests). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }
}
