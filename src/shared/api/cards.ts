import { z } from 'zod';
import { CardNetwork, CardOpKind, CardOpStatus, CardStatus, RelayStatus } from '../enums';
import { MicrosString } from '../money';
import { Address, CentsString, Hex, IsoTime, PageQuery, Paginated, TxHash } from './common';

export const CardProduct = z.object({
  id: z.string(),
  label: z.string(),
  issueFeeUsdCents: CentsString,
  available: z.boolean(),
});
export const GetCardsPricingReq = z.void();
export const GetCardsPricingRes = z.object({
  products: z.array(CardProduct),
  topupFeeNote: z.string(),
  minTopupCents: CentsString,
  maxTopupCents: CentsString,
});

export const Invoice = z.object({
  payAddress: z.string(),
  payAmount: z.string(),
  payCurrency: z.string(),
  network: z.enum(CardNetwork),
  expiresAt: IsoTime,
});

export const CardOperation = z.object({
  id: z.string(),
  kind: z.enum(CardOpKind),
  status: z.enum(CardOpStatus),
  amountUsdCents: CentsString,
  invoice: Invoice.nullable(),
  error: z.string().nullable(),
});
export type CardOperation = z.infer<typeof CardOperation>;

export const CardView = z.object({
  id: z.string(),
  product: z.string(),
  last4: z.string().nullable(),
  status: z.enum(CardStatus),
  balanceUsdCents: CentsString,
  finish: z.string().nullable(),
  createdAt: IsoTime,
  pendingOperation: CardOperation.optional(),
  /**
   * A provider event (e.g. a completed top-up) scheduled a fresh balance read that has not landed yet.
   * Clients keep polling while it is true; the card sync loop clears it within seconds.
   */
  balanceRefreshPending: z.boolean(),
});
export type CardView = z.infer<typeof CardView>;

export const GetCardsReq = z.void();
export const GetCardsRes = z.array(CardView);

export const PostCardsReq = z.object({
  product: z.string(),
  email: z.string().email(),
  /** Sent to izipay as `cardholder_alias`, its only name field (shown as the card's display name). */
  cardholderName: z.string().min(2).max(64),
  finish: z.string().optional(),
});
export const PostCardsRes = z.object({ card: CardView, operation: CardOperation });

export const PostCardTopupsReq = z.object({ amountUsdCents: CentsString });
export const PostCardTopupsRes = z.object({ operation: CardOperation });

export const RelayOrder = z.object({
  id: z.string(),
  requestId: z.string(),
  status: z.enum(RelayStatus),
  originAmountMicros: MicrosString,
  depositTx: TxHash.nullable(),
  expiresAt: IsoTime.nullable(),
});
export const GetCardOperationReq = z.void();
export const GetCardOperationRes = z.object({ operation: CardOperation, relay: RelayOrder.nullable() });

export const RelayStep = z.object({
  id: z.string(),
  kind: z.literal('transaction'),
  items: z.array(z.object({ to: Address, data: Hex, value: z.string(), chainId: z.number().int() })),
});
export const PostRelayQuoteReq = z.void();
export const PostRelayQuoteRes = z.object({
  relayOrderId: z.string(),
  requestId: z.string(),
  originAmountMicros: MicrosString,
  feesUsd: z.string(),
  timeEstimateSec: z.number().int(),
  steps: z.array(RelayStep),
  expiresAt: IsoTime,
});

export const PostRelayOrderSubmittedReq = z.object({ step: z.enum(['approve', 'deposit']), txHash: TxHash });
export const PostRelayOrderSubmittedRes = z.object({ status: z.enum(RelayStatus) });

export const CardTransaction = z.object({
  id: z.string(),
  amountCents: z.string(),
  currency: z.string(),
  merchant: z.string().nullable(),
  status: z.string(),
  occurredAt: IsoTime,
});
export const GetCardTransactionsReq = PageQuery;
export const GetCardTransactionsRes = Paginated(CardTransaction);

export const PostCardRevealReq = z.void();
/** Sent with `cache-control: no-store`; never logged. */
export const PostCardRevealRes = z.object({
  number: z.string(),
  exp: z.string(),
  cvv: z.string(),
  holder: z.string(),
});

export const PostCardApplePayReq = z.void();
/** Same state as the GET; POST only opens a per-card waiting window. */
export const GetCardApplePayRes = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('waiting'), expiresAt: IsoTime, expiresInSec: z.number().int().min(0) }),
  z.object({
    status: z.literal('delivered'),
    code: z.string(),
    receivedAt: IsoTime,
    expiresAt: IsoTime,
    /** Server-computed remaining lifetime: clients count down from this, never from their own clock. */
    expiresInSec: z.number().int().min(0),
  }),
]);
export const PostCardApplePayRes = GetCardApplePayRes;
export const GetCardApplePayReq = z.void();

/** Raw body, header `x-izipay-signature` (HMAC-SHA256 hex). */
export const PostWebhookIzipayReq = z.unknown();
export const PostWebhookIzipayRes = z.object({ received: z.literal(true) });
