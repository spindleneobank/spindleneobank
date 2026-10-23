import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { type Address, erc20Abi } from 'viem';
import { nodes, users } from '../../db/schema';
import { requireAddress } from '../../lib/contracts';
import { AppError } from '../../lib/errors';
import type { Env } from '../../lib/http';
import { clientIp, rateLimit } from '../../lib/ratelimit';
import { publicClient } from '../../lib/viem';
import { upgradeWebSocket } from '../../lib/ws';
import {
  GetNodeStakeCallReq,
  PatchNodeReq,
  PostNodesEnrollReq,
  PostNodesPairReq,
} from '../../shared/api/nodes';
import { dbRef } from '../auth/constants';
import { requireSession } from '../auth/middleware';
import { approvePairing, createEnrollment } from './enroll';
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

function wsBase(): string {
  return nodeSettings.apiUrl.replace(/^http/, 'ws');
}

export function enrollCommands(token: string, engine: string, os: string) {
  const image = nodeSettings.nodeImage;
  const api = wsBase();
  const docker =
    `docker run -d --name spindle-node --restart unless-stopped --gpus all -v spindle-node:/data ` +
    `-e SPINDLE_API_URL=${api} -e SPINDLE_TOKEN=${token} -e SPINDLE_ENGINE=${engine} ${image}`;
  const installer =
    os === 'windows'
      ? `& ([scriptblock]::Create((irm ${nodeSettings.appUrl}/install.ps1))) -Token ${token}`
      : `curl -fsSL ${nodeSettings.appUrl}/install.sh | sh -s -- --token ${token}`;
  return { docker, installer };
}

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
      commands: enrollCommands(token, req.engine, req.os),
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
