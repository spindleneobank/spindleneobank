import { z } from 'zod';
import { Address, IsoTime } from './common';

export const GetAuthNonceReq = z.void();
export const GetAuthNonceRes = z.object({ nonce: z.string() });

export const PostAuthVerifyReq = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
export const PostAuthVerifyRes = z.object({ address: Address, expiresAt: IsoTime });

export const GetAuthSessionReq = z.void();
export const GetAuthSessionRes = z.object({
  address: Address,
  chainId: z.number().int(),
  fresh: z.boolean(),
});

export const PostAuthReauthReq = PostAuthVerifyReq;
export const PostAuthReauthRes = z.object({ freshUntil: IsoTime });

export const PostAuthLogoutReq = z.void();
export const PostAuthLogoutRes = z.void();

/** Fixed SIWE statements. */
export const SIWE_STATEMENT_LOGIN = 'Sign in to Spindle.';
export const SIWE_STATEMENT_REAUTH = 'Confirm a sensitive Spindle action.';
