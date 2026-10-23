import { z } from 'zod';
import { X402Status } from '../enums';
import { MicrosString } from '../money';
import { Address, IsoTime, TxHash } from './common';

export const SESSION_MAX_CAP_MICROS_DEFAULT = 5_000_000n;
export const SESSION_MAX_TTL_SEC = 3600;
export const HEADER_SESSION = 'X-Spindle-Session';

export const PostX402SessionsReq = z.object({
  payer: Address,
  capMicros: MicrosString,
  ttlSec: z.number().int().min(60).max(SESSION_MAX_TTL_SEC),
});

/** JSON-safe Permit2 typed data (uint256 values are decimal strings). */
export const JsonTypedData = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});
export const PostX402SessionsRes = z.object({
  sessionId: z.string(),
  typedData: JsonTypedData,
  surchargeMicros: MicrosString,
  expiresAt: IsoTime,
});

export const PostX402SessionOpenReq = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });
export const PostX402SessionOpenRes = z.object({
  sessionToken: z.string(),
  capMicros: MicrosString,
  surchargeMicros: MicrosString,
  spendableMicros: MicrosString,
  expiresAt: IsoTime,
});

export const GetX402SessionReq = z.void();
export const GetX402SessionRes = z.object({
  status: z.enum(X402Status),
  usedMicros: MicrosString,
  spendableMicros: MicrosString,
  settleTx: TxHash.nullable(),
});

export const PostX402SessionCloseReq = z.void();
export const PostX402SessionCloseRes = z.object({ status: z.literal('closing') });
