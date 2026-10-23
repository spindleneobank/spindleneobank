import { nodeBindingTypedData } from '@spindle/shared/binding';
import {
  CLOSE_CODES,
  type HelloBody,
  HelloMsg,
  helloSigningMessage,
  type JobCancelMsg,
  type JobStartMsg,
  type ModelsEnsureMsg,
  NodeToServer,
  type PairingMsg,
  type ProbeStartMsg,
  ServerToNode,
  type StatusMsg,
  type WelcomeMsg,
} from '@spindle/shared/node-protocol';
import type { NodeKey } from './key';
import type { Logger } from './log';

export interface ConnectionHandlers {
  onWelcome?(w: WelcomeMsg): void;
  onJobStart?(m: JobStartMsg): void;
  onJobCancel?(m: JobCancelMsg): void;
  onModelsEnsure?(m: ModelsEnsureMsg): void;
  onProbeStart?(m: ProbeStartMsg): void;
  /** called on every (re)connect before hello is signed */
  onConnected?(): void;
}

export interface ConnectionOptions {
  url: string;
  key: NodeKey;
  log: Logger;
  buildHello: () => Promise<HelloBody>;
  getStatus: () => Promise<Omit<StatusMsg, 'v' | 'type'>>;
  handlers?: ConnectionHandlers;
  /** called for fatal closes; the process should exit with `code` */
  onFatal: (code: number) => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  replacedDelayMs?: number;
  statusIntervalMs?: number;
  pairingBannerMs?: number;
  eligibilityLogMs?: number;
  /** test seam */
  createSocket?: (url: string) => WebSocket;
}

type Phase = 'idle' | 'connecting' | 'authenticating' | 'pairing' | 'ready' | 'closed';

export class NodeConnection {
  private ws: WebSocket | null = null;
  private phase: Phase = 'idle';
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private pairingTimer: ReturnType<typeof setInterval> | null = null;
  private eligibleTimer: ReturnType<typeof setInterval> | null = null;
  private eligible = true;
  private fatal = false;

  constructor(private readonly o: ConnectionOptions) {}

  get state(): Phase {
    return this.phase;
  }
  get isEligible(): boolean {
    return this.eligible;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Closes the socket (normal closure by default) and stops reconnecting. */
  stop(code = 1000, reason = 'shutdown'): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.phase = 'closed';
    try {
      ws?.close(code, reason);
    } catch {}
  }

  send(msg: NodeToServer): boolean {
    const parsed = NodeToServer.safeParse(msg);
    if (!parsed.success) {
      this.o.log.error(
        `refusing to send invalid ${(msg as { type?: string }).type} message`,
        parsed.error.message,
      );
      return false;
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(parsed.data));
    return true;
  }

  private connect(): void {
    if (this.ws || this.stopped) return; // never two sockets at once
    this.phase = 'connecting';
    this.o.log.info(`connecting to ${this.o.url}`);
    let ws: WebSocket;
    try {
      ws = this.o.createSocket ? this.o.createSocket(this.o.url) : new WebSocket(this.o.url);
    } catch (e) {
      this.o.log.error(`cannot open socket: ${(e as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.o.log.info('connected, waiting for challenge');
      this.o.handlers?.onConnected?.();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.onRaw(typeof ev.data === 'string' ? ev.data : String(ev.data));
    };
    ws.onerror = () => {
      if (this.ws === ws) this.o.log.warn('socket error');
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.onClosed(ev.code, ev.reason);
    };
  }

  private onClosed(code: number, reason: string): void {
    this.clearTimers();
    this.phase = 'closed';
    if (this.stopped) return;
    const why = reason ? ` (${reason})` : '';
    switch (code) {
      case CLOSE_CODES.UPGRADE_REQUIRED:
        this.o.log.error(
          `agent too old${why}. Update with: docker pull <spindle-node image> and restart the container.`,
        );
        this.fatal = true;
        this.o.onFatal(3);
        return;
      case CLOSE_CODES.SUSPENDED:
        this.o.log.error(`this node is suspended${why}. Contact support or check the dashboard.`);
        this.fatal = true;
        this.o.onFatal(4);
        return;
      case CLOSE_CODES.AUTH_FAILED:
        this.o.log.error(`authentication failed${why}; will retry (is the enrollment token valid?)`);
        break;
      case CLOSE_CODES.REPLACED:
        this.o.log.warn(
          `replaced by a newer connection for the same node key${why}; is another agent running with this key?`,
        );
        this.scheduleReconnect(this.o.replacedDelayMs ?? 10_000);
        return;
      case CLOSE_CODES.PROTOCOL_ERROR:
        this.o.log.error(`server reported a protocol error${why}`);
        break;
      default:
        this.o.log.warn(`disconnected: code=${code}${why}`);
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(minDelay = 0): void {
    if (this.stopped || this.fatal || this.reconnectTimer || this.ws) return;
    const min = this.o.minBackoffMs ?? 1000;
    const max = this.o.maxBackoffMs ?? 60_000;
    const base = Math.min(max, min * 2 ** this.attempt);
    this.attempt++;
    const delay = Math.max(minDelay, base * (0.5 + Math.random() * 0.5));
    this.o.log.info(`reconnecting in ${Math.round(delay)} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    for (const t of [this.statusTimer, this.pairingTimer, this.eligibleTimer]) if (t) clearInterval(t);
    this.statusTimer = this.pairingTimer = this.eligibleTimer = null;
  }

  private onRaw(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.o.log.warn('ignoring non-JSON message from server');
      return;
    }
    const parsed = ServerToNode.safeParse(json);
    if (!parsed.success) {
      this.o.log.warn(
        `ignoring invalid server message (${(json as { type?: string })?.type ?? '?'})`,
        parsed.error.message,
      );
      return;
    }
    this.dispatch(parsed.data).catch((e) => this.o.log.error(`handler failed: ${(e as Error).message}`));
  }

  private async dispatch(m: ServerToNode): Promise<void> {
    switch (m.type) {
      case 'challenge':
        return this.onChallenge(m.nonce);
      case 'pairing':
        return this.onPairing(m);
      case 'welcome':
        return this.onWelcome(m);
      case 'eligibility':
        this.setEligible(m.eligible);
        return;
      case 'binding.request':
        return this.signBinding(m.binding);
      case 'upgrade_required':
        this.o.log.error(
          `agent too old: server requires >= ${m.minAgentVersion}. Update with: docker pull <spindle-node image> and restart.`,
        );
        this.fatal = true;
        this.o.onFatal(3);
        return;
      case 'ping':
        this.send({ v: 1, type: 'pong' });
        return;
      case 'models.ensure':
        this.o.handlers?.onModelsEnsure?.(m);
        return;
      case 'job.start':
        this.o.handlers?.onJobStart?.(m);
        return;
      case 'job.cancel':
        this.o.handlers?.onJobCancel?.(m);
        return;
      case 'probe.start':
        this.o.handlers?.onProbeStart?.(m);
        return;
    }
  }

  private async onChallenge(nonce: string): Promise<void> {
    this.phase = 'authenticating';
    const hello = await this.o.buildHello();
    const msg = helloSigningMessage(nonce, hello as unknown as Record<string, unknown>);
    const sig = await this.o.key.account.signMessage({ message: msg });
    const full = HelloMsg.parse({ ...hello, sig });
    this.send(full);
  }

  private onPairing(m: PairingMsg): void {
    this.phase = 'pairing';
    const banner = () => {
      const lines = [`PAIR THIS NODE`, `Code: ${m.code}`, `Open: ${m.url}`, `Expires: ${m.expiresAt}`];
      const w = Math.max(...lines.map((l) => l.length));
      const bar = `+${'-'.repeat(w + 2)}+`;
      this.o.log.info(`\n${[bar, ...lines.map((l) => `| ${l.padEnd(w)} |`), bar].join('\n')}`);
    };
    banner();
    if (this.pairingTimer) clearInterval(this.pairingTimer);
    this.pairingTimer = setInterval(banner, this.o.pairingBannerMs ?? 60_000);
  }

  private async onWelcome(w: WelcomeMsg): Promise<void> {
    if (this.pairingTimer) clearInterval(this.pairingTimer);
    this.pairingTimer = null;
    this.attempt = 0;
    this.o.log.info(
      `welcome: node ${w.nodeId} "${w.name}" class=${w.gpuClass} lane=${w.lane} registered=${w.registered} eligible=${w.eligible} staked=${w.staked}`,
    );
    await this.signBinding(w.binding);
    this.phase = 'ready';
    this.setEligible(w.eligible);
    this.startStatus();
    this.o.handlers?.onWelcome?.(w);
  }

  private setEligible(eligible: boolean): void {
    const was = this.eligible;
    this.eligible = eligible;
    if (this.eligibleTimer) clearInterval(this.eligibleTimer);
    this.eligibleTimer = null;
    if (eligible) {
      if (!was) this.o.log.info('node is now registered on-chain and eligible for jobs');
      return;
    }
    const note = () =>
      this.o.log.warn('Registered: no — open the dashboard Compute tab to register this node');
    note();
    this.eligibleTimer = setInterval(note, this.o.eligibilityLogMs ?? 5 * 60_000);
  }

  private async signBinding(b: WelcomeMsg['binding']): Promise<void> {
    if (b.message.nodeKey.toLowerCase() !== this.o.key.address.toLowerCase()) {
      this.o.log.error('server binding is for a different node key; refusing to sign');
      return;
    }
    const td = nodeBindingTypedData(
      { chainId: b.domain.chainId, verifyingContract: b.domain.verifyingContract as `0x${string}` },
      {
        owner: b.message.owner as `0x${string}`,
        nodeKey: b.message.nodeKey as `0x${string}`,
        gpuClass: b.message.gpuClass,
        ccCapable: b.message.ccCapable,
        deadline: b.message.deadline,
      },
    );
    const sig = await this.o.key.account.signTypedData(td);
    this.send({ v: 1, type: 'binding', sig, deadline: b.message.deadline });
  }

  private startStatus(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    const tick = async () => {
      try {
        this.send({ v: 1, type: 'status', ...(await this.o.getStatus()) });
      } catch (e) {
        this.o.log.warn(`status failed: ${(e as Error).message}`);
      }
    };
    void tick();
    this.statusTimer = setInterval(tick, this.o.statusIntervalMs ?? 15_000);
  }
}
