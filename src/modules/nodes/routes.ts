import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { type Address, erc20Abi } from 'viem';
import { z } from 'zod';
import { nodes, users } from '../../db/schema';
import { requireAddress, stakingEnabled } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, rateLimit } from '../../lib/ratelimit';
import { publicClient } from '../../lib/viem';
import { upgradeWebSocket } from '../../lib/ws';
import {
  GetNodeStakeCallReq,
  PostNodesPairReq,
  PostNodesEnrollReq as SharedEnrollReq,
  PatchNodeReq as SharedPatchNodeReq,
} from '../../shared/api/nodes';
import { dbRef } from '../auth/constants';
import { requireSession } from '../auth/middleware';
import nodeDistRoutes from './dist';
import { approvePairing, createEnrollment, issueUpdateToken } from './enroll';
import { nodeHub } from './hub';
import {
  loadNodeById,
  nodeDetail,
  nodeSettings,
  ownedNode,
  stakingParams,
  toNodeViews,
  ZERO_BYTES32,
} from './service';

async function body<T>(
  c: Context<Env>,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: unknown[] } } },
): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('VALIDATION', 'Invalid request body.', 400, parsed.error?.issues);
  return parsed.data as T;
}

async function currentUserId(c: Context<Env>): Promise<string> {
  const address = c.get('user')?.address;
  if (!address) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  const [row] = await dbRef.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.address, address.toLowerCase()))
    .limit(1);
  if (!row) throw new AppError('UNAUTHENTICATED', 'Please sign in with your wallet.');
  return row.id;
}

export interface InstallCommandOpts {
  engine: string;
  /** Enrollment token (fresh install). */
  token?: string;
  /** Update token (re-install of an existing node: reuses the volume and node key, no enrollment). */
  updateToken?: string;
}

/** The one-liners shown in the dashboard. The API origin is where the scripts are fetched from. */
export function installCommands(o: InstallCommandOpts) {
  const api = nodeSettings.apiUrl;
  const models = nodeSettings.nodeModels;
  const sh = [
    o.updateToken ? `--update --update-token ${o.updateToken}` : `--token ${o.token}`,
    `--engine ${o.engine}`,
    ...(models ? [`--models ${models}`] : []),
  ].join(' ');
  const ps = [
    o.updateToken ? `-Update -UpdateToken ${o.updateToken}` : `-Token ${o.token}`,
    `-Engine ${o.engine}`,
    ...(models ? [`-Models ${models}`] : []),
  ].join(' ');
  return {
    installer: `curl -fsSL ${api}/v1/node/install.sh | sh -s -- ${sh}`,
    powershell: `& ([scriptblock]::Create((irm ${api}/v1/node/install.ps1))) ${ps}`,
  };
}

// names are trimmed before validation, so whitespace-only names are rejected
const PatchNodeReq = SharedPatchNodeReq.extend({ name: z.string().trim().min(1).max(64) });
const PostNodesEnrollReq = SharedEnrollReq.extend({ name: z.string().trim().min(1).max(64).optional() });

const updateLimit = rateLimit({
  name: 'node_update_cmd',
  key: (c) => c.get('user')?.address ?? '',
  points: 20,
  windowSec: 60,
});

const pairLimit = rateLimit({
  name: 'node_pair',
  key: (c) => c.get('user')?.address ?? '',
  points: 10,
  windowSec: 60,
});

export default function nodesRoutes(app: Hono<Env>): void {
  // ---- node websocket ------------------------------------------------------------------------
  app.get(
    '/v1/node/ws',
    upgradeWebSocket((c) => {
      const ip = clientIp(c);
      let session: ReturnType<typeof nodeHub.onOpen> | undefined;
      return {
        onOpen(_evt, ws) {
          session = nodeHub.onOpen(ws, ip);
        },
        onMessage(evt) {
          if (session && typeof evt.data === 'string') nodeHub.onMessage(session, evt.data);
        },
        onClose() {
          if (session) nodeHub.onClose(session);
        },
        onError() {
          if (session) nodeHub.onClose(session);
        },
      };
    }),
  );

  nodeDistRoutes(app);

  // ---- dashboard -------------------------------------------------------------------------------
  const guard = requireSession;

  app.post('/v1/app/nodes/enroll', guard, async (c) => {
    const req = await body(c, PostNodesEnrollReq);
    const userId = await currentUserId(c);
    const { enrollmentId, token, expiresAt } = await createEnrollment(userId, req);
    return c.json({
      enrollmentId,
      token,
      expiresAt: expiresAt.toISOString(),
      commands: installCommands({ engine: req.engine, token }),
    });
  });

  // Re-install command for an existing node: same volume and node key, no enrollment token.
  app.post('/v1/app/nodes/:id/update-command', guard, updateLimit, async (c) => {
    const row = await ownedNode(await currentUserId(c), c.req.param('id'));
    const { token, expiresAt } = await issueUpdateToken(row.id);
    return c.json({
      expiresAt: expiresAt.toISOString(),
      commands: installCommands({ engine: row.engine, updateToken: token }),
    });
  });

  app.post('/v1/app/nodes/pair', guard, pairLimit, async (c) => {
    const { code } = await body(c, PostNodesPairReq);
    const userId = await currentUserId(c);
    const row = await approvePairing(userId, code);
    const [node] = await toNodeViews([row]);
    return c.json({ node });
  });

  app.get('/v1/app/staking/params', guard, async (c) => {
    try {
      return c.json(await stakingParams());
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not read staking parameters from the chain.');
    }
  });

  app.get('/v1/app/nodes', guard, async (c) => {
    const userId = await currentUserId(c);
    const rows = await dbRef.db.select().from(nodes).where(eq(nodes.userId, userId));
    return c.json(await toNodeViews(rows));
  });

  app.get('/v1/app/nodes/:id', guard, async (c) => {
    const row = await ownedNode(await currentUserId(c), c.req.param('id'));
    return c.json(await nodeDetail(row));
  });

  app.patch('/v1/app/nodes/:id', guard, async (c) => {
    const row = await ownedNode(await currentUserId(c), c.req.param('id'));
    const { name } = await body(c, PatchNodeReq);
    const [updated] = await dbRef.db
      .update(nodes)
      .set({ name: name.trim() })
      .where(eq(nodes.id, row.id))
      .returning();
    const [view] = await toNodeViews([updated ?? row]);
    return c.json(view);
  });

  app.get('/v1/app/nodes/:id/register-call', guard, async (c) => {
    let row = await ownedNode(await currentUserId(c), c.req.param('id'));
    if (row.registered) throw new AppError('CHAIN_STATE', 'This node is already registered.');
    const nowSec = Math.floor(Date.now() / 1000);
    const stale =
      !row.bindingSig ||
      row.bindingDeadline == null ||
      Number(row.bindingDeadline) < nowSec + nodeSettings.bindingRefreshBelowSec;
    if (stale) {
      if (!nodeHub.isOnline(row.id)) {
        throw new AppError(
          'CHAIN_STATE',
          'The node must be online to sign a fresh registration. Start it and retry.',
        );
      }
      const ok = await nodeHub.requestBinding(row.id);
      if (!ok)
        throw new AppError('CHAIN_STATE', 'The node did not return a valid signature. Retry in a moment.');
      row = (await loadNodeById(row.id)) ?? row;
    }
    if (!row.bindingSig || row.bindingDeadline == null) {
      throw new AppError('CHAIN_STATE', 'No node signature on file yet.');
    }
    return c.json({
      to: requireAddress('registry'),
      functionName: 'registerNode' as const,
      args: [
        row.nodeKey,
        row.gpuClass,
        row.ccCapable,
        ZERO_BYTES32,
        row.bindingDeadline.toString(),
        row.bindingSig,
      ],
    });
  });

  app.get('/v1/app/nodes/:id/stake-call', guard, async (c) => {
    const row = await ownedNode(await currentUserId(c), c.req.param('id'));
    const parsed = GetNodeStakeCallReq.safeParse({ amount: c.req.query('amount') });
    if (!parsed.success || BigInt(parsed.data.amount) <= 0n) {
      throw new AppError('VALIDATION', 'amount must be a positive integer (SPDL wei).');
    }
    const amount = BigInt(parsed.data.amount);
    if (!stakingEnabled()) {
      throw new AppError('CHAIN_STATE', 'Staking is not available yet.', 409);
    }
    if (!row.registered || row.onchainId == null) {
      throw new AppError('CHAIN_STATE', 'Register this node on-chain before staking.');
    }
    const staking = requireAddress('staking');
    const spdl = requireAddress('spdl');
    const owner = (c.get('user')?.address ?? row.owner) as Address;
    let needsApprove = true;
    try {
      const allowance = await publicClient.readContract({
        address: spdl,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, staking],
      });
      needsApprove = allowance < amount;
    } catch {
      // unknown allowance: include the approve step, it is harmless
    }
    return c.json({
      ...(needsApprove
        ? { approve: { to: spdl, functionName: 'approve', args: [staking, amount.toString()] } }
        : {}),
      stake: { to: staking, functionName: 'stake', args: [row.onchainId.toString(), amount.toString()] },
    });
  });
}
