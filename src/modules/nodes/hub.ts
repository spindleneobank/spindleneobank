import { randomBytes } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { type Hex, recoverMessageAddress, recoverTypedDataAddress } from 'viem';
import { publicKeyToAddress } from 'viem/utils';
import { enrollments, nodes, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createRedis } from '../../lib/redis';
import { nodeBindingTypedData } from '../../shared/binding';
import { fitModels } from '../../shared/catalog';
import {
  CLOSE_CODES,
  type EligibilityMsg,
  type HelloBody,
  helloSigningMessage,
  type JobAcceptedMsg,
  type JobChunkMsg,
  type JobDoneMsg,
  type JobErrorMsg,
  type ModelsReadyMsg,
  NodeToServer,
  type ProbeResultMsg,
  type ProbeStartMsg,
  type ServerToNode,
  type StatusMsg,
  type WelcomeMsg,
} from '../../shared/node-protocol';
import { dbRef } from '../auth/constants';
import { markAvailable } from '../floor/availability';
import {
  consumeTokenTx,
  createPairing,
  dropPairing,
  PAIRING_TTL_MS,
  type Pairing,
  readEnrollmentMeta,
  sweepPairings,
} from './enroll';
import {
  ChunkStream,
  CMD_CHANNEL,
  evtChannel,
  type JobFailCode,
  JobFailure,
  type JobHandle,
  type JobStartInput,
  type WorkerCmd,
  type WorkerEvt,
} from './jobs';
import {
  catalogIdForEngineModel,
  classifyHello,
  isEligible,
  isStaked,
  loadCatalog,
  loadNodeById,
  loadNodeByKey,
  loadNodesByIds,
  maybeRefreshMinStakes,
  type NodeRow,
  nodeSettings,
  refreshMinStakes,
  toEnsure,
} from './service';

/** Minimal socket surface (hono WSContext satisfies it); tests may pass fakes. */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type Phase = 'challenge' | 'authenticating' | 'pairing' | 'ready' | 'closed';

interface JobCtx {
  jobId: string;
  chunks: ChunkStream;
  resolve: (d: import('./jobs').JobDone) => void;
  reject: (e: JobFailure) => void;
  resolveAccepted: (v: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  chunksSent: number;
  accepted: boolean;
  settled: boolean;
}

interface ProbeCtx {
  resolve: (r: ProbeResultMsg) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface Session {
  id: string;
  socket: HubSocket;
  ip: string;
  phase: Phase;
  nonce: string;
  openedAt: number;
  helloTimer?: ReturnType<typeof setTimeout>;
  hello?: HelloBody;
  nodeKey?: string;
  node?: NodeRow;
  /** catalog ids whose models.ready was reported (cumulative). */
  models: Set<string>;
  /** catalog ids sent in models.ensure; models.ready outside this set is ignored. */
  ensured: Set<string>;
  inflight: Map<string, JobCtx>;
  probes: Map<string, ProbeCtx>;
  state: 'idle' | 'busy' | 'loading';
  lastSeen: number;
  lastFlush: number;
  lastPing: number;
  /** deadlines (unix s) we asked the node to sign and have not received yet. */
  pendingBindings: Map<number, { owner: string; gpuClass: number; ccCapable: boolean }>;
  bindingWaiters: ((ok: boolean) => void)[];
  chain: Promise<void>;
}

export interface NodeCandidate {
  nodeId: string;
  nodeKey: string;
  owner: string;
  lane: 'sealed' | 'open';
  gpuClass: number;
  engine: string;
  isHouse: boolean;
  registered: boolean;
  staked: boolean;
  stake: bigint;
  reputation: number;
  inflight: number;
  capacity: number;
  lastSeen: number;
}

export interface CandidateFilter {
  model: string;
  lane: 'sealed' | 'open';
  kind: 'chat' | 'embeddings' | 'images';
  /** default false: unregistered nodes never receive jobs. */
  includeUnregistered?: boolean;
}

export interface NodeLostEvent {
  jobId: string;
  nodeId: string;
  /** true when no chunk had streamed, so the job may be re-routed once. */
  requeue: boolean;
}

type HubEvents = {
  nodeOnline: (nodeId: string) => void;
  nodeOffline: (nodeId: string) => void;
  eligibility: (nodeId: string, e: { registered: boolean; eligible: boolean; staked: boolean }) => void;
  nodeLost: (e: NodeLostEvent) => void;
  probeResult: (nodeId: string, r: ProbeResultMsg) => void;
};

const lower = (s: string) => s.toLowerCase();

function semverLt(a: string, b: string): boolean {
  const pa = a
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .replace(/^v/, '')
    .split(/[.-]/)
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

export class NodeHub {
  /** Authenticated, welcomed sessions by node id. */
  private sessions = new Map<string, Session>();
  private conns = new Set<Session>();
  private jobOwners = new Map<string, string>();
  private listeners: { [K in keyof HubEvents]: HubEvents[K][] } = {
    nodeOnline: [],
    nodeOffline: [],
    eligibility: [],
    nodeLost: [],
    probeResult: [],
  };
  private sweepTimer?: ReturnType<typeof setInterval>;
  private sub?: Redis;
  private pub?: Redis;
  private started = false;

  // ---- events -----------------------------------------------------------------------------------

  on<K extends keyof HubEvents>(event: K, fn: HubEvents[K]): () => void {
    this.listeners[event].push(fn);
    return () => {
      const list = this.listeners[event] as HubEvents[K][];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private emit<K extends keyof HubEvents>(event: K, ...args: Parameters<HubEvents[K]>): void {
    for (const fn of [...this.listeners[event]]) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (err) {
        logger.error({ err, event }, 'node hub listener failed');
      }
    }
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  /** Starts timers and the Redis bridge. Call once from server.ts. */
  async start(opts: { redis?: boolean } = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.sweepTimer = setInterval(
      () => void this.sweep().catch((err) => logger.error({ err }, 'sweep failed')),
      nodeSettings.sweepMs,
    );
    void refreshMinStakes();
    if (opts.redis !== false) await this.startBridge();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const s of [...this.conns]) this.closeConn(s, 1001, 'server shutting down');
    this.sub?.disconnect();
    this.pub?.disconnect();
    this.sub = this.pub = undefined;
  }

  // ---- connection entry points ------------------------------------------------------------------

  onOpen(socket: HubSocket, ip: string): Session {
    const s: Session = {
      id: randomBytes(8).toString('hex'),
      socket,
      ip,
      phase: 'challenge',
      nonce: randomBytes(24).toString('base64url'),
      openedAt: Date.now(),
      models: new Set(),
      ensured: new Set(),
      inflight: new Map(),
      probes: new Map(),
      state: 'idle',
      lastSeen: Date.now(),
      lastFlush: Date.now(),
      lastPing: Date.now(),
      pendingBindings: new Map(),
      bindingWaiters: [],
      chain: Promise.resolve(),
    };
    // Cheap pre-auth cap so an IP cannot hold unlimited unauthenticated sockets.
    let sameIp = 0;
    for (const c of this.conns) if (c.ip === ip) sameIp++;
    this.conns.add(s);
    if (sameIp >= nodeSettings.maxPerIp * 4) {
      this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'too many connections');
      return s;
    }
    s.helloTimer = setTimeout(() => {
      if (s.phase === 'challenge') this.closeConn(s, CLOSE_CODES.AUTH_FAILED, 'hello timeout');
    }, nodeSettings.helloTimeoutMs);
    this.send(s, { v: 1, type: 'challenge', nonce: s.nonce, serverTime: Date.now() });
    return s;
  }

  onMessage(s: Session, data: string): void {
    // Messages from one socket are handled strictly in order.
    s.chain = s.chain
      .then(() => this.handle(s, data))
      .catch((err) => {
        logger.error({ err, session: s.id }, 'node message handler failed');
        this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'internal error');
      });
  }

  onClose(s: Session): void {
    this.detach(s);
  }

  // ---- message handling -------------------------------------------------------------------------

  private async handle(s: Session, data: string): Promise<void> {
    if (s.phase === 'closed') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'invalid json');
    }
    const parsed = NodeToServer.safeParse(json);
    if (!parsed.success) {
      logger.warn({ session: s.id, issues: parsed.error.issues.slice(0, 3) }, 'invalid node message');
      return this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'invalid message');
    }
    const msg = parsed.data;
    if (s.phase === 'challenge') {
      if (msg.type !== 'hello') return this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'hello expected');
      s.phase = 'authenticating';
      if (s.helloTimer) clearTimeout(s.helloTimer);
      return this.onHello(s, json as Record<string, unknown>, msg);
    }
    if (s.phase !== 'ready') return; // pairing / authenticating: nothing else is accepted
    s.lastSeen = Date.now();
    switch (msg.type) {
      case 'hello':
        return this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'unexpected hello');
      case 'pong':
        return;
      case 'status':
        return this.onStatus(s, msg);
      case 'binding':
        return this.onBinding(s, msg);
      case 'models.progress':
        return;
      case 'models.ready':
        return this.onModelsReady(s, msg);
      case 'job.accepted':
        return this.onJobAccepted(s, msg);
      case 'job.chunk':
        return this.onJobChunk(s, msg);
      case 'job.done':
        return this.onJobDone(s, msg);
      case 'job.error':
        return this.onJobError(s, msg);
      case 'probe.result':
        return this.onProbeResult(s, msg);
      case 'attest.refresh':
        return; // sealed lane (S1)
    }
  }

  // ---- auth flow --------------------------------------------------------------------------------

  private async onHello(
    s: Session,
    raw: Record<string, unknown>,
    hello: HelloBody & { sig: string },
  ): Promise<void> {
    const { sig, ...withoutSig } = raw as { sig: string } & Record<string, unknown>;
    let ok = false;
    try {
      const recovered = await recoverMessageAddress({
        message: helloSigningMessage(s.nonce, withoutSig),
        signature: sig as Hex,
      });
      ok =
        lower(recovered) === lower(hello.nodeKey) &&
        lower(publicKeyToAddress(hello.publicKey as Hex)) === lower(hello.nodeKey);
    } catch {
      ok = false;
    }
    if (!ok) return this.closeConn(s, CLOSE_CODES.AUTH_FAILED, 'authentication failed');

    const { sig: _sig, ...helloBody } = hello;
    s.hello = helloBody as HelloBody;
    s.nodeKey = lower(hello.nodeKey);

    if (semverLt(hello.agentVersion, nodeSettings.minAgentVersion)) {
      this.send(s, { v: 1, type: 'upgrade_required', minAgentVersion: nodeSettings.minAgentVersion });
      return this.closeConn(s, CLOSE_CODES.UPGRADE_REQUIRED, 'upgrade required');
    }

    const known = await loadNodeByKey(s.nodeKey);
    if (known) return this.admit(s, known);

    if (hello.enrollToken) {
      const cls = classifyHello(hello);
      let created: NodeRow | null = null;
      try {
        created = await dbRef.db.transaction(async (tx) => {
          const consumed = await consumeTokenTx(tx, hello.enrollToken as string, s.nodeKey as string);
          if (!consumed) return null;
          const meta = await readEnrollmentMeta(consumed.enrollmentId);
          return this.insertNode(tx, s, consumed.userId, cls, meta?.name);
        });
      } catch (err) {
        logger.warn({ err: String(err), session: s.id }, 'token enrollment failed');
      }
      if (!created) return this.closeConn(s, CLOSE_CODES.AUTH_FAILED, 'invalid or expired enrollment token');
      return this.admit(s, created);
    }

    // Unknown key, no token: pairing.
    if (this.limitsExceeded(s, null)) return;
    const pairing = await createPairing(s.nodeKey);
    s.phase = 'pairing';
    this.send(s, {
      v: 1,
      type: 'pairing',
      code: pairing.code,
      url: `${nodeSettings.appUrl}/dashboard/compute?pair=${pairing.code}`,
      expiresAt: pairing.expiresAt.toISOString(),
    });
  }

  private async insertNode(
    tx: Pick<typeof dbRef.db, 'insert' | 'select'>,
    s: Session,
    userId: string,
    cls: ReturnType<typeof classifyHello>,
    requestedName?: string,
  ): Promise<NodeRow> {
    const hello = s.hello as HelloBody;
    const [user] = await tx
      .select({ address: users.address })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new AppError('NOT_FOUND', 'User not found.');
    const name = (requestedName?.trim() || `${cls.gpuModel ?? 'CPU'} node`).slice(0, 64);
    const [row] = await tx
      .insert(nodes)
      .values({
        owner: lower(user.address),
        userId,
        nodeKey: s.nodeKey as string,
        nodePubkey: hello.publicKey,
        name,
        engine: hello.engine,
        gpuModel: cls.gpuModel,
        gpuCount: cls.gpuCount,
        vramGb: cls.vramGb,
        gpuClass: cls.gpuClass,
        ccCapable: cls.ccCapable,
        lane: cls.lane,
        status: 'offline',
        agentVersion: hello.agentVersion,
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'Could not create the node.');
    return row;
  }

  /** Approving a pairing code: creates the node for `userId` and welcomes the live pairing socket. */
  async completePairing(pairing: Pairing, userId: string): Promise<NodeRow | null> {
    let target: Session | undefined;
    for (const c of this.conns) if (c.phase === 'pairing' && c.nodeKey === pairing.nodeKey) target = c;
    if (!target?.hello) return null;
    const s = target;
    const hello = s.hello as HelloBody;
    const cls = classifyHello(hello);
    const node = await dbRef.db.transaction(async (tx) => {
      const existing = await tx.select().from(nodes).where(eq(nodes.nodeKey, pairing.nodeKey)).limit(1);
      if (existing[0]) return null;
      const row = await this.insertNode(tx, s, userId, cls);
      await tx.insert(enrollments).values({
        userId,
        kind: 'pairing',
        pairingCode: pairing.code,
        nodeKey: pairing.nodeKey,
        status: 'approved',
        expiresAt: pairing.expiresAt,
        approvedAt: new Date(),
      });
      return row;
    });
    if (!node) return null;
    await this.admit(s, node);
    return (await loadNodeById(node.id)) ?? node;
  }

  /** IP / owner limits; the house node is exempt. Returns true (and closes) when exceeded. */
  private limitsExceeded(s: Session, node: NodeRow | null): boolean {
    if (node?.isHouse) return false;
    let perIp = 0;
    let perOwner = 0;
    for (const c of this.conns) {
      if (c === s || c.phase === 'closed' || c.phase === 'challenge' || c.phase === 'authenticating')
        continue;
      if (c.nodeKey === s.nodeKey) continue; // will be replaced
      if (c.node?.isHouse) continue;
      if (c.ip === s.ip) perIp++;
      if (node && c.node && c.node.owner === node.owner && c.phase === 'ready') perOwner++;
    }
    if (perIp >= nodeSettings.maxPerIp) {
      this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'too many nodes from this address');
      return true;
    }
    if (perOwner >= nodeSettings.maxPerOwner) {
      this.closeConn(s, CLOSE_CODES.PROTOCOL_ERROR, 'too many nodes for this owner');
      return true;
    }
    return false;
  }

  private async admit(s: Session, row: NodeRow): Promise<void> {
    if (s.phase === 'closed') return;
    if (row.status === 'suspended' || row.status === 'deactivated') {
      return this.closeConn(s, CLOSE_CODES.SUSPENDED, row.suspendedReason ?? row.status);
    }
    if (this.limitsExceeded(s, row)) return;
    const hello = s.hello as HelloBody;
    dropPairing(row.nodeKey);

    // A newer connection for the same key replaces the old one.
    const old = this.sessions.get(row.id);
    if (old && old !== s) {
      this.sessions.delete(row.id); // so detach() does not mark the node offline under the new session
      this.closeConn(old, CLOSE_CODES.REPLACED, 'replaced by a newer connection');
    }

    // Hardware class is server-computed; it only changes for nodes not registered yet.
    const cls = classifyHello(hello);
    const patch: Partial<typeof nodes.$inferInsert> = {
      status: 'online',
      lastSeenAt: new Date(),
      agentVersion: hello.agentVersion,
      engine: hello.engine,
      nodePubkey: hello.publicKey,
    };
    if (!row.registered) {
      Object.assign(patch, {
        gpuModel: cls.gpuModel,
        gpuCount: cls.gpuCount,
        vramGb: cls.vramGb,
        gpuClass: cls.gpuClass,
        ccCapable: cls.ccCapable,
        lane: cls.lane,
      });
    }
    const [fresh] = await dbRef.db.update(nodes).set(patch).where(eq(nodes.id, row.id)).returning();
    const node = fresh ?? row;
    if ((s.phase as Phase) === 'closed') {
      // closed while we were awaiting the DB
      await this.markOffline(node.id);
      return;
    }

    const catalog = await loadCatalog();
    s.node = node;
    const ensure = this.ensureFor(node, hello, catalog);
    s.ensured = new Set(ensure.map((m) => m.id));
    for (const m of hello.models) {
      const id = catalogIdForEngineModel(catalog, hello.engine, m.id);
      if (id && s.ensured.has(id)) s.models.add(id);
    }
    const deadline = Math.floor(Date.now() / 1000) + nodeSettings.bindingValiditySec;
    const binding = this.bindingFor(s, node, deadline);
    const welcome: WelcomeMsg = {
      v: 1,
      type: 'welcome',
      nodeId: node.id,
      owner: node.owner as `0x${string}`,
      name: node.name,
      gpuClass: node.gpuClass,
      lane: node.lane as 'open',
      ccCapable: node.ccCapable,
      registered: node.registered,
      eligible: isEligible(node),
      staked: isStaked(node),
      binding,
      catalog: ensure,
      minAgentVersion: nodeSettings.minAgentVersion,
    };
    this.send(s, welcome);
    this.send(s, { v: 1, type: 'models.ensure', models: ensure });
    // Only now may jobs be dispatched to this session.
    if ((s.phase as Phase) === 'closed') {
      await this.markOffline(node.id);
      return;
    }
    s.phase = 'ready';
    s.lastSeen = Date.now();
    this.sessions.set(node.id, s);
    await this.persistModels(s);
    this.emit('nodeOnline', node.id);
  }

  private ensureFor(node: NodeRow, hello: HelloBody, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
    const gpuMb = hello.hardware.gpus.reduce((a, g) => a + g.vramMb, 0);
    // CPU-only nodes (house, dev) use half their RAM as the fit budget.
    const budget = gpuMb > 0 ? gpuMb : Math.floor(hello.hardware.ramMb / 2);
    return toEnsure(fitModels(budget, catalog), node.engine, node.lane);
  }

  private bindingFor(s: Session, node: NodeRow, deadline: number): WelcomeMsg['binding'] {
    s.pendingBindings.set(deadline, {
      owner: node.owner,
      gpuClass: node.gpuClass,
      ccCapable: node.ccCapable,
    });
    const td = nodeBindingTypedData({
      registry: nodeSettings.registry,
      chainId: nodeSettings.chainId,
      owner: node.owner as `0x${string}`,
      nodeKey: node.nodeKey as `0x${string}`,
      gpuClass: node.gpuClass,
      ccCapable: node.ccCapable,
      deadline,
    });
    return {
      domain: td.domain as WelcomeMsg['binding']['domain'],
      types: td.types as unknown as WelcomeMsg['binding']['types'],
      primaryType: 'NodeBinding',
      message: {
        owner: node.owner as `0x${string}`,
        nodeKey: node.nodeKey as `0x${string}`,
        gpuClass: node.gpuClass,
        ccCapable: node.ccCapable,
        deadline,
      },
    };
  }

  private async onBinding(s: Session, msg: { sig: string; deadline: number }): Promise<void> {
    const node = s.node;
    const expected = s.pendingBindings.get(msg.deadline);
    if (!node || !expected) {
      logger.warn({ session: s.id }, 'unsolicited binding dropped');
      return;
    }
    s.pendingBindings.delete(msg.deadline);
    try {
      const td = nodeBindingTypedData({
        registry: nodeSettings.registry,
        chainId: nodeSettings.chainId,
        owner: expected.owner as `0x${string}`,
        nodeKey: node.nodeKey as `0x${string}`,
        gpuClass: expected.gpuClass,
        ccCapable: expected.ccCapable,
        deadline: msg.deadline,
      });
      const signer = await recoverTypedDataAddress({ ...td, signature: msg.sig as Hex });
      if (lower(signer) !== lower(node.nodeKey)) throw new Error('signer mismatch');
    } catch (err) {
      logger.warn({ err: String(err), nodeId: node.id }, 'invalid binding signature');
      for (const w of s.bindingWaiters.splice(0)) w(false);
      return;
    }
    const [row] = await dbRef.db
      .update(nodes)
      .set({ bindingSig: msg.sig, bindingDeadline: BigInt(msg.deadline) })
      .where(eq(nodes.id, node.id))
      .returning();
    if (row) s.node = { ...row };
    for (const w of s.bindingWaiters.splice(0)) w(true);
  }

  /** Asks the node for a fresh binding signature (binding.request). Resolves false on timeout / invalid. */
  async requestBinding(nodeId: string, timeoutMs = 15_000): Promise<boolean> {
    const s = this.sessions.get(nodeId);
    if (!s?.node) return false;
    const deadline = Math.floor(Date.now() / 1000) + nodeSettings.bindingValiditySec;
    const binding = this.bindingFor(s, s.node, deadline);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const i = s.bindingWaiters.indexOf(waiter);
        if (i >= 0) s.bindingWaiters.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      const waiter = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      s.bindingWaiters.push(waiter);
      this.send(s, { v: 1, type: 'binding.request', binding });
    });
  }

  // ---- status / models ----------------------------------------------------------------------------

  private async onStatus(s: Session, msg: StatusMsg): Promise<void> {
    const prev = s.state;
    s.state = msg.state;
    if (prev !== msg.state && s.node && (msg.state === 'busy') !== (prev === 'busy')) {
      await dbRef.db
        .update(nodes)
        .set({ status: msg.state === 'busy' ? 'busy' : 'online' })
        .where(eq(nodes.id, s.node.id));
    }
  }

  private async onModelsReady(s: Session, msg: ModelsReadyMsg): Promise<void> {
    const accepted = msg.models.filter((m) => s.ensured.has(m.id));
    const ignored = msg.models.filter((m) => !s.ensured.has(m.id)).map((m) => m.id);
    if (ignored.length > 0)
      logger.warn({ nodeId: s.node?.id, ignored }, 'models.ready outside the ensure set ignored');
    s.models = new Set(accepted.map((m) => m.id)); // cumulative
    await this.persistModels(s, accepted);
  }

  private async persistModels(s: Session, ready?: { id: string; digest: string }[]): Promise<void> {
    if (!s.node) return;
    const digests = new Map(ready?.map((m) => [m.id, m.digest]));
    for (const m of s.hello?.models ?? []) {
      // hello digests are keyed by engine name; fall back to them when models.ready did not give one
      if (!ready) digests.set(m.id, m.digest);
    }
    const list = [...s.models].map((id) => ({ id, digest: digests.get(id) ?? null }));
    await dbRef.db.update(nodes).set({ models: list }).where(eq(nodes.id, s.node.id));
  }

  /** Re-sends models.ensure to every connected node (admin model changes). */
  async refreshCatalog(): Promise<void> {
    const catalog = await loadCatalog();
    for (const s of this.sessions.values()) {
      if (!s.node || !s.hello) continue;
      const ensure = this.ensureFor(s.node, s.hello, catalog);
      s.ensured = new Set(ensure.map((m) => m.id));
      this.send(s, { v: 1, type: 'models.ensure', models: ensure });
    }
  }

  // ---- eligibility --------------------------------------------------------------------------------

  /** Reloads the node row and forwards `eligibility` to its socket. */
  async refreshEligibility(nodeId: string): Promise<void> {
    const s = this.sessions.get(nodeId);
    if (!s) return;
    const row = await loadNodeById(nodeId);
    if (!row) return;
    s.node = row;
    const e = { registered: row.registered, eligible: isEligible(row), staked: isStaked(row) };
    const msg: EligibilityMsg = {
      v: 1,
      type: 'eligibility',
      ...e,
      onchainId: row.onchainId == null ? null : row.onchainId.toString(),
    };
    this.send(s, msg);
    this.emit('eligibility', nodeId, e);
  }

  // ---- queries ------------------------------------------------------------------------------------

  isOnline(nodeId: string): boolean {
    return this.sessions.has(nodeId);
  }

  getSession(nodeId: string): Session | undefined {
    return this.sessions.get(nodeId);
  }

  onlineNodeIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Online, idle-capable nodes with `model` ready. Unregistered nodes are excluded unless asked for. */
  candidates(filter: CandidateFilter): NodeCandidate[] {
    const out: NodeCandidate[] = [];
    for (const s of this.sessions.values()) {
      const node = s.node;
      const hello = s.hello;
      if (!node || !hello || s.phase !== 'ready') continue;
      if (node.status === 'suspended' || node.status === 'deactivated') continue;
      if (node.lane !== filter.lane) continue;
      if (!s.models.has(filter.model)) continue;
      if (!hello.capabilities.includes(filter.kind)) continue;
      if (!filter.includeUnregistered && !isEligible(node)) continue;
      if (s.inflight.size >= hello.capacity) continue;
      out.push({
        nodeId: node.id,
        nodeKey: node.nodeKey,
        owner: node.owner,
        lane: node.lane as 'open',
        gpuClass: node.gpuClass,
        engine: node.engine,
        isHouse: node.isHouse,
        registered: node.registered,
        staked: isStaked(node),
        stake: BigInt(node.stakeSpdl),
        reputation: node.reputation,
        inflight: s.inflight.size,
        capacity: hello.capacity,
        lastSeen: s.lastSeen,
      });
    }
    return out;
  }

  closeNode(nodeId: string, code: number = CLOSE_CODES.SUSPENDED, reason = 'closed by server'): void {
    const s = this.sessions.get(nodeId);
    if (s) this.closeConn(s, code, reason);
  }

  // ---- jobs ---------------------------------------------------------------------------------------

  dispatch(nodeId: string, job: JobStartInput): JobHandle {
    // Reject duplicates before anything attaches.
    if (this.jobOwners.has(job.jobId)) {
      throw new AppError('CONFLICT', `Job ${job.jobId} is already in flight.`);
    }
    const s = this.sessions.get(nodeId);
    if (!s || s.phase !== 'ready' || !s.node) throw new AppError('NO_CAPACITY', 'Node is not online.');
    if (!isEligible(s.node)) throw new AppError('NO_CAPACITY', 'Node is not registered on-chain.');

    const chunks = new ChunkStream();
    let resolveDone!: (d: import('./jobs').JobDone) => void;
    let rejectDone!: (e: JobFailure) => void;
    let resolveAccepted!: (v: boolean) => void;
    const done = new Promise<import('./jobs').JobDone>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    done.catch(() => {}); // never an unhandled rejection if the caller only reads chunks
    const accepted = new Promise<boolean>((res) => {
      resolveAccepted = res;
    });
    const ctx: JobCtx = {
      jobId: job.jobId,
      chunks,
      resolve: resolveDone,
      reject: rejectDone,
      resolveAccepted,
      chunksSent: 0,
      accepted: false,
      settled: false,
      timer: setTimeout(() => {
        this.sendRaw(s, { v: 1, type: 'job.cancel', jobId: job.jobId });
        this.failJob(s, ctx, 'TIMEOUT', 'Job timed out.', false);
      }, nodeSettings.jobTimeoutMs),
    };
    s.inflight.set(job.jobId, ctx);
    this.jobOwners.set(job.jobId, nodeId);
    this.send(s, { v: 1, type: 'job.start', ...job });
    return {
      jobId: job.jobId,
      nodeId,
      chunks,
      done,
      accepted,
      cancel: () => {
        if (ctx.settled) return;
        this.sendRaw(s, { v: 1, type: 'job.cancel', jobId: job.jobId });
        this.failJob(s, ctx, 'CANCELLED', 'Job cancelled.', false);
      },
    };
  }

  private settle(s: Session, ctx: JobCtx): boolean {
    if (ctx.settled) return false;
    ctx.settled = true;
    clearTimeout(ctx.timer);
    s.inflight.delete(ctx.jobId);
    this.jobOwners.delete(ctx.jobId);
    ctx.chunks.close();
    ctx.resolveAccepted(ctx.accepted);
    return true;
  }

  private failJob(s: Session, ctx: JobCtx, code: JobFailCode, message: string, requeueable: boolean): void {
    if (!this.settle(s, ctx)) return;
    ctx.reject(new JobFailure(code, message, requeueable && ctx.chunksSent === 0, ctx.chunksSent));
  }

  /** Ownership check: only the connection the job was dispatched to may speak for it. */
  private ownedJob(s: Session, jobId: string, what: string): JobCtx | null {
    const ctx = s.inflight.get(jobId);
    if (!ctx) {
      logger.warn(
        { session: s.id, nodeId: s.node?.id, jobId, what },
        'dropped message for a job this node does not own',
      );
      return null;
    }
    return ctx;
  }

  private onJobAccepted(s: Session, m: JobAcceptedMsg): void {
    const ctx = this.ownedJob(s, m.jobId, 'accepted');
    if (!ctx) return;
    ctx.accepted = true;
    ctx.resolveAccepted(true);
  }

  private onJobChunk(s: Session, m: JobChunkMsg): void {
    const ctx = this.ownedJob(s, m.jobId, 'chunk');
    if (!ctx) return;
    ctx.accepted = true;
    ctx.resolveAccepted(true);
    ctx.chunksSent++;
    ctx.chunks.push({ seq: m.seq, delta: m.delta, ...(m.sealed ? { sealed: true } : {}) });
  }

  private onJobDone(s: Session, m: JobDoneMsg): void {
    const ctx = this.ownedJob(s, m.jobId, 'done');
    if (!ctx) return;
    if (!this.settle(s, ctx)) return;
    ctx.resolve({
      output: m.output,
      usage: m.usage,
      receipt: m.receipt,
      ...(m.sealed ? { sealed: true } : {}),
    });
  }

  private onJobError(s: Session, m: JobErrorMsg): void {
    const ctx = this.ownedJob(s, m.jobId, 'error');
    if (!ctx) return;
    // BUSY may arrive without job.accepted; MODEL_NOT_READY means the node dropped the model.
    const reroute = m.code === 'BUSY' || m.code === 'MODEL_NOT_READY';
    if (m.code === 'MODEL_NOT_READY') this.dropModels(s, ctx.jobId);
    this.failJob(s, ctx, m.code, m.message, reroute);
  }

  private dropModels(_s: Session, _jobId: string): void {
    // models.ready is cumulative; the next report from the node corrects our view.
  }

  // ---- probes -------------------------------------------------------------------------------------

  /** Sends probe.start and resolves with the node's probe.result (120 s timeout). */
  probe(
    nodeId: string,
    probe: Omit<ProbeStartMsg, 'v' | 'type'>,
    timeoutMs = 120_000,
  ): Promise<ProbeResultMsg> {
    const s = this.sessions.get(nodeId);
    if (!s || s.phase !== 'ready' || !s.node)
      return Promise.reject(new AppError('NO_CAPACITY', 'Node is not online.'));
    if (!isEligible(s.node))
      return Promise.reject(new AppError('NO_CAPACITY', 'Node is not registered on-chain.'));
    if (s.probes.has(probe.probeId))
      return Promise.reject(new AppError('CONFLICT', 'Probe already running.'));
    return new Promise<ProbeResultMsg>((resolve, reject) => {
      const timer = setTimeout(() => {
        s.probes.delete(probe.probeId);
        reject(new AppError('UPSTREAM_UNAVAILABLE', 'Probe timed out.'));
      }, timeoutMs);
      s.probes.set(probe.probeId, { resolve, reject, timer });
      this.send(s, { v: 1, type: 'probe.start', ...probe });
    });
  }

  private onProbeResult(s: Session, m: ProbeResultMsg): void {
    const ctx = s.probes.get(m.probeId);
    if (!ctx) {
      logger.warn({ session: s.id, probeId: m.probeId }, 'dropped unknown probe result');
      return;
    }
    clearTimeout(ctx.timer);
    s.probes.delete(m.probeId);
    ctx.resolve(m);
    if (s.node) this.emit('probeResult', s.node.id, m);
  }

  // ---- liveness -----------------------------------------------------------------------------------

  async sweep(now = Date.now()): Promise<void> {
    sweepPairings(now);
    void maybeRefreshMinStakes(now);
    const flushIds: string[] = [];
    for (const s of [...this.conns]) {
      if (s.phase === 'pairing') {
        // an expired code ends the wait; the node reconnects and gets a fresh code
        if (now - s.openedAt > PAIRING_TTL_MS) this.closeConn(s, 1001, 'pairing expired');
        continue;
      }
      if (s.phase !== 'ready' || !s.node) continue;
      if (now - s.lastSeen > nodeSettings.livenessTimeoutMs) {
        logger.info({ nodeId: s.node.id }, 'node silent, marking offline');
        this.closeConn(s, 1001, 'liveness timeout');
        continue;
      }
      void markAvailable(s.node.id, now).catch(() => {}); // availability floor: one bit per minute
      if (now - s.lastPing >= nodeSettings.pingMs) {
        s.lastPing = now;
        this.send(s, { v: 1, type: 'ping' });
      }
      if (now - s.lastFlush >= nodeSettings.flushMs) {
        s.lastFlush = now;
        flushIds.push(s.node.id);
      }
    }
    if (flushIds.length > 0) {
      await dbRef.db
        .update(nodes)
        .set({ lastSeenAt: new Date(now) })
        .where(inArray(nodes.id, flushIds));
      // Pick up registration / stake changes the indexer wrote, in case an event was missed.
      const rows = await loadNodesByIds(flushIds);
      for (const row of rows) {
        const s = this.sessions.get(row.id);
        if (!s?.node) continue;
        const changed =
          s.node.registered !== row.registered ||
          s.node.stakeSpdl !== row.stakeSpdl ||
          s.node.onchainId !== row.onchainId;
        s.node = row;
        if (changed) await this.refreshEligibility(row.id);
      }
    }
  }

  // ---- teardown -----------------------------------------------------------------------------------

  private closeConn(s: Session, code: number, reason: string): void {
    const wasAttached = s.phase !== 'closed';
    this.detach(s);
    if (wasAttached) {
      try {
        s.socket.close(code, reason.slice(0, 100));
      } catch {
        // already closed
      }
    }
  }

  /** Removes the connection, fails its jobs, clears timers, marks the node offline. Idempotent. */
  private detach(s: Session): void {
    if (s.phase === 'closed') return;
    s.phase = 'closed';
    if (s.helloTimer) clearTimeout(s.helloTimer);
    this.conns.delete(s);
    if (s.nodeKey) dropPairing(s.nodeKey);
    for (const w of s.bindingWaiters.splice(0)) w(false);
    for (const p of s.probes.values()) {
      clearTimeout(p.timer);
      p.reject(new AppError('UPSTREAM_UNAVAILABLE', 'Node disconnected.'));
    }
    s.probes.clear();
    const nodeId = s.node?.id;
    for (const ctx of [...s.inflight.values()]) {
      const requeue = ctx.chunksSent === 0;
      this.failJob(s, ctx, 'NODE_LOST', 'Node disconnected.', true);
      if (nodeId) this.emit('nodeLost', { jobId: ctx.jobId, nodeId, requeue });
    }
    if (nodeId && this.sessions.get(nodeId) === s) {
      this.sessions.delete(nodeId);
      void this.markOffline(nodeId).catch((err) => logger.error({ err, nodeId }, 'mark offline failed'));
      this.emit('nodeOffline', nodeId);
    }
  }

  private async markOffline(nodeId: string): Promise<void> {
    if (this.sessions.has(nodeId)) return; // a newer connection already took over
    await dbRef.db
      .update(nodes)
      .set({ status: 'offline', lastSeenAt: new Date() })
      .where(sql`${nodes.id} = ${nodeId} and ${nodes.status} in ('online','busy')`);
  }

  // ---- sending ------------------------------------------------------------------------------------

  private send(s: Session, msg: ServerToNode): void {
    this.sendRaw(s, msg);
  }

  private sendRaw(s: Session, msg: ServerToNode): void {
    if (s.phase === 'closed') return;
    try {
      s.socket.send(JSON.stringify(msg));
    } catch (err) {
      logger.warn({ err: String(err), session: s.id }, 'send failed');
    }
  }

  // ---- redis bridge -------------------------------------------------------------------------------

  private async startBridge(): Promise<void> {
    this.sub = createRedis();
    this.pub = createRedis();
    this.sub.on('message', (channel, raw) => {
      void this.onBridgeMessage(channel, raw).catch((err) =>
        logger.warn({ err: String(err), channel }, 'bridge message failed'),
      );
    });
    await this.sub.subscribe(CMD_CHANNEL, 'node:evt');
  }

  private reply(requestId: string, evt: WorkerEvt): void {
    void this.pub?.publish(evtChannel(requestId), JSON.stringify(evt)).catch(() => {});
  }

  private async onBridgeMessage(channel: string, raw: string): Promise<void> {
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (channel === 'node:evt') {
      if (body.type !== 'eligibility') return;
      const ids = new Set<string>();
      if (typeof body.nodeId === 'string') ids.add(body.nodeId);
      if (typeof body.nodeKey === 'string') {
        const row = await loadNodeByKey(body.nodeKey);
        if (row) ids.add(row.id);
      }
      if (body.onchainId != null) {
        for (const s of this.sessions.values()) {
          if (s.node?.onchainId != null && String(s.node.onchainId) === String(body.onchainId))
            ids.add(s.node.id);
        }
      }
      if (ids.size === 0) for (const id of this.sessions.keys()) ids.add(id); // unknown target: refresh all
      for (const id of ids) await this.refreshEligibility(id);
      return;
    }
    if (channel !== CMD_CHANNEL) return;
    const cmd = body as unknown as { requestId: string } & WorkerCmd;
    const { requestId } = cmd;
    const fail = (err: unknown) => {
      if (err instanceof JobFailure) {
        this.reply(requestId, {
          type: 'error',
          code: err.code,
          message: err.message,
          requeueable: err.requeueable,
          chunksSent: err.chunksSent,
        });
      } else {
        const e = err as { code?: string; message?: string };
        this.reply(requestId, { type: 'error', code: e.code ?? 'INTERNAL', message: e.message ?? 'failed' });
      }
    };
    try {
      if (cmd.type === 'dispatch') {
        const handle = this.dispatch(cmd.nodeId, cmd.job);
        const pump = (async () => {
          for await (const chunk of handle.chunks) this.reply(requestId, { type: 'chunk', chunk });
        })();
        // publish the final event only after every chunk went out, so the worker sees them in order
        handle.done.then(
          async (done) => {
            await pump;
            this.reply(requestId, { type: 'done', done });
          },
          async (err) => {
            await pump;
            fail(err);
          },
        );
      } else if (cmd.type === 'probe') {
        this.reply(requestId, { type: 'result', result: await this.probe(cmd.nodeId, cmd.probe) });
      } else if (cmd.type === 'close') {
        this.closeNode(cmd.nodeId, cmd.code ?? CLOSE_CODES.SUSPENDED);
        this.reply(requestId, { type: 'result', result: { ok: true } });
      } else if (cmd.type === 'candidates') {
        const list = this.candidates(cmd.filter).map((c) => ({ ...c, stake: c.stake.toString() }));
        this.reply(requestId, { type: 'result', result: list });
      }
    } catch (err) {
      fail(err);
    }
  }
}

export const nodeHub = new NodeHub();
