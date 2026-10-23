import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  BuyerLedgerKind,
  CardNetwork,
  CardOpKind,
  CardOpStatus,
  CardStatus,
  ClaimStatus,
  EarningKind,
  Engine,
  EnrollmentKind,
  EnrollmentStatus,
  EpochStatus,
  JobKind,
  JobStatus,
  Lane,
  NodeStatus,
  PayMode,
  RelayStatus,
  SlashStatus,
  UnitKind,
  X402Scheme,
  X402Status,
} from '../shared/enums';
import { inList, inListOrNull, isAddress, isAddressOrNull } from './checks';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const micros = (name: string) => bigint(name, { mode: 'bigint' });
const wei = (name: string) => numeric(name, { precision: 78, scale: 0 });
const id = () => uuid('id').primaryKey().defaultRandom();

// ---------------------------------------------------------------- identity

export const users = pgTable(
  'users',
  {
    id: id(),
    address: text('address').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at'),
    prefs: jsonb('prefs').notNull().default({}),
  },
  (t) => [check('users_address_chk', isAddress(t.address))],
);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  freshUntil: ts('fresh_until'),
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
});

// ------------------------------------------------------------------- nodes

export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').unique(),
    pairingCode: text('pairing_code').unique(),
    nodeKey: text('node_key'),
    status: text('status').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    approvedAt: ts('approved_at'),
  },
  (t) => [
    check('enrollments_kind_chk', inList(t.kind, EnrollmentKind)),
    check('enrollments_status_chk', inList(t.status, EnrollmentStatus)),
    uniqueIndex('enrollments_pending_pairing_uq').on(t.pairingCode).where(sql`${t.status} = 'pending'`),
  ],
);

export const nodes = pgTable(
  'nodes',
  {
    id: id(),
    onchainId: bigint('onchain_id', { mode: 'bigint' }).unique(),
    owner: text('owner').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    nodeKey: text('node_key').notNull().unique(),
    nodePubkey: text('node_pubkey').notNull(),
    name: text('name').notNull(),
    engine: text('engine').notNull(),
    gpuModel: text('gpu_model'),
    gpuCount: integer('gpu_count'),
    vramGb: integer('vram_gb'),
    gpuClass: smallint('gpu_class').notNull(),
    ccCapable: boolean('cc_capable').notNull().default(false),
    lane: text('lane').notNull(),
    bindingSig: text('binding_sig'),
    bindingDeadline: bigint('binding_deadline', { mode: 'bigint' }),
    registered: boolean('registered').notNull().default(false),
    stakeSpdl: wei('stake_spdl').notNull().default('0'),
    stakePending: wei('stake_pending').notNull().default('0'),
    reputation: integer('reputation').notNull().default(1000),
    status: text('status').notNull(),
    suspendedReason: text('suspended_reason'),
    isHouse: boolean('is_house').notNull().default(false),
    agentVersion: text('agent_version'),
    benchmark: jsonb('benchmark'),
    models: jsonb('models').notNull().default([]),
    lastSeenAt: ts('last_seen_at'),
    lastProbeAt: ts('last_probe_at'),
    lastAttestAt: ts('last_attest_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('nodes_owner_chk', isAddress(t.owner)),
    check('nodes_node_key_chk', isAddress(t.nodeKey)),
    check('nodes_engine_chk', inList(t.engine, Engine)),
    check('nodes_lane_chk', inList(t.lane, Lane)),
    check('nodes_status_chk', inList(t.status, NodeStatus)),
    index('nodes_owner_idx').on(t.owner),
    index('nodes_status_idx').on(t.status),
  ],
);

export const nodeAttestations = pgTable(
  'node_attestations',
  {
    id: id(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    quoteHash: text('quote_hash'),
    bundle: jsonb('bundle'),
    verified: boolean('verified').notNull().default(false),
    reason: text('reason'),
    measurements: jsonb('measurements'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at'),
  },
  (t) => [
    // S1: a verified quote can be used once (replay protection that also holds under concurrency)
    uniqueIndex('node_attestations_quote_verified_uq').on(t.quoteHash).where(sql`${t.verified}`),
  ],
);

// ------------------------------------------------------- buyers & payments

export const buyers = pgTable(
  'buyers',
  {
    id: id(),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id),
    address: text('address').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [check('buyers_address_chk', isAddress(t.address))],
);

export const apiKeys = pgTable('api_keys', {
  id: id(),
  buyerId: uuid('buyer_id')
    .notNull()
    .references(() => buyers.id),
  name: text('name'),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  monthlyCapUsdgMicros: micros('monthly_cap_usdg_micros'),
});

export const buyerLedger = pgTable(
  'buyer_ledger',
  {
    id: id(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id),
    kind: text('kind').notNull(),
    usdgMicros: micros('usdg_micros').notNull(),
    jobId: uuid('job_id'),
    txHash: text('tx_hash'),
    logIndex: integer('log_index'),
    createdAt: createdAt(),
  },
  (t) => [
    check('buyer_ledger_kind_chk', inList(t.kind, BuyerLedgerKind)),
    uniqueIndex('buyer_ledger_tx_log_uq').on(t.txHash, t.logIndex),
    index('buyer_ledger_buyer_idx').on(t.buyerId, t.createdAt),
  ],
);

export const buyerBalances = pgTable(
  'buyer_balances',
  {
    buyerId: uuid('buyer_id')
      .primaryKey()
      .references(() => buyers.id),
    balanceUsdgMicros: micros('balance_usdg_micros').notNull().default(sql`0`),
    reservedUsdgMicros: micros('reserved_usdg_micros').notNull().default(sql`0`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('buyer_balances_reserved_chk', sql`${t.reservedUsdgMicros} >= 0`),
    check('buyer_balances_available_chk', sql`${t.balanceUsdgMicros} - ${t.reservedUsdgMicros} >= 0`),
  ],
);

export const x402Payments = pgTable(
  'x402_payments',
  {
    id: id(),
    paymentId: text('payment_id').notNull().unique(),
    payer: text('payer').notNull(),
    scheme: text('scheme').notNull(),
    capMicros: micros('cap_micros'),
    surchargeMicros: micros('surcharge_micros'),
    usedMicros: micros('used_micros').notNull().default(sql`0`),
    nonce: wei('nonce'),
    deadline: bigint('deadline', { mode: 'bigint' }),
    validAfter: bigint('valid_after', { mode: 'bigint' }),
    signature: text('signature'),
    permit: jsonb('permit'),
    status: text('status').notNull(),
    sessionTokenHash: text('session_token_hash').unique(),
    reservedMicros: micros('reserved_micros').notNull().default(sql`0`),
    settleTx: text('settle_tx'),
    failReason: text('fail_reason'),
    createdAt: createdAt(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    check('x402_payments_payer_chk', isAddress(t.payer)),
    check('x402_payments_scheme_chk', inList(t.scheme, X402Scheme)),
    check('x402_payments_status_chk', inList(t.status, X402Status)),
    index('x402_payments_status_deadline_idx').on(t.status, t.deadline),
    index('x402_payments_payer_status_idx').on(t.payer, t.status),
  ],
);

// -------------------------------------------------------- jobs & earnings

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id),
    nodeId: uuid('node_id').references(() => nodes.id),
    lane: text('lane'),
    model: text('model').notNull(),
    kind: text('kind').notNull(),
    units: numeric('units').notNull().default('0'),
    unitKind: text('unit_kind').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    buyerUsdgMicros: micros('buyer_usdg_micros').notNull().default(sql`0`),
    providerUsdgMicros: micros('provider_usdg_micros').notNull().default(sql`0`),
    payMode: text('pay_mode').notNull(),
    x402PaymentId: uuid('x402_payment_id').references(() => x402Payments.id),
    status: text('status').notNull(),
    error: text('error'),
    isCanary: boolean('is_canary').notNull().default(false),
    createdAt: createdAt(),
    dispatchedAt: ts('dispatched_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    check('jobs_lane_chk', inListOrNull(t.lane, Lane)),
    check('jobs_kind_chk', inList(t.kind, JobKind)),
    check('jobs_unit_kind_chk', inList(t.unitKind, UnitKind)),
    check('jobs_pay_mode_chk', inList(t.payMode, PayMode)),
    check('jobs_status_chk', inList(t.status, JobStatus)),
    index('jobs_buyer_created_idx').on(t.buyerId, t.createdAt.desc()),
    index('jobs_node_created_idx').on(t.nodeId, t.createdAt.desc()),
  ],
);

export const receipts = pgTable(
  'receipts',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    cose: bytea('cose').notNull(),
    payload: jsonb('payload').notNull(),
    attestationRef: text('attestation_ref'),
    verified: boolean('verified').notNull(),
    reason: text('reason'),
    recountTokens: integer('recount_tokens'),
    createdAt: createdAt(),
  },
  (t) => [index('receipts_node_idx').on(t.nodeId)],
);

/** Hypertable on ts (see drizzle/0001_timescale.sql). No primary key: Timescale unique indexes must include ts. */
export const earningEvents = pgTable(
  'earning_events',
  {
    ts: ts('ts').notNull(),
    nodeId: uuid('node_id').notNull(),
    owner: text('owner').notNull(),
    jobId: uuid('job_id'),
    kind: text('kind').notNull(),
    usdgMicros: micros('usdg_micros').notNull(),
    epoch: bigint('epoch', { mode: 'bigint' }),
  },
  (t) => [
    check('earning_events_owner_chk', isAddress(t.owner)),
    check('earning_events_kind_chk', inList(t.kind, EarningKind)),
    index('earning_events_owner_ts_idx').on(t.owner, t.ts.desc()),
    index('earning_events_epoch_idx').on(t.epoch),
  ],
);

export const rateCard = pgTable(
  'rate_card',
  {
    day: date('day').notNull(),
    gpuClass: smallint('gpu_class').notNull(),
    lane: text('lane').notNull(),
    unitKind: text('unit_kind').notNull(),
    providerUsdgMicrosPerUnit: micros('provider_usdg_micros_per_unit').notNull(),
    buyerUsdgMicrosPerUnit: micros('buyer_usdg_micros_per_unit').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.gpuClass, t.lane, t.unitKind] }),
    check('rate_card_lane_chk', inList(t.lane, Lane)),
    check('rate_card_unit_kind_chk', inList(t.unitKind, UnitKind)),
  ],
);

export const models = pgTable('models', {
  id: text('id').primaryKey(),
  family: text('family'),
  engineIds: jsonb('engine_ids'),
  hfTokenizer: text('hf_tokenizer'),
  kind: text('kind'),
  minVramGb: integer('min_vram_gb'),
  lanes: text('lanes').array(),
  enabled: boolean('enabled').notNull().default(true),
  unitKind: text('unit_kind'),
});

// -------------------------------------------------------- epochs & claims

export const epochs = pgTable(
  'epochs',
  {
    epoch: bigint('epoch', { mode: 'bigint' }).primaryKey(),
    root: text('root').notNull(),
    totalEarnedUsdgMicros: micros('total_earned_usdg_micros').notNull(),
    owners: integer('owners').notNull(),
    treePath: text('tree_path').notNull(),
    txHash: text('tx_hash'),
    status: text('status').notNull(),
    builtAt: ts('built_at').notNull().defaultNow(),
    postedAt: ts('posted_at'),
  },
  (t) => [check('epochs_status_chk', inList(t.status, EpochStatus))],
);

export const epochBalances = pgTable(
  'epoch_balances',
  {
    epoch: bigint('epoch', { mode: 'bigint' }).notNull(),
    owner: text('owner').notNull(),
    cumulativeUsdgMicros: micros('cumulative_usdg_micros').notNull(),
  },
  (t) => [primaryKey({ columns: [t.epoch, t.owner] }), check('epoch_balances_owner_chk', isAddress(t.owner))],
);

export const claims = pgTable(
  'claims',
  {
    id: id(),
    owner: text('owner').notNull(),
    epoch: bigint('epoch', { mode: 'bigint' }).notNull(),
    amountUsdgMicros: micros('amount_usdg_micros').notNull(),
    txHash: text('tx_hash').unique(),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    status: text('status').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('claims_owner_chk', isAddress(t.owner)),
    check('claims_status_chk', inList(t.status, ClaimStatus)),
    index('claims_owner_created_idx').on(t.owner, t.createdAt.desc()),
  ],
);

// ------------------------------------------------------------------ cards

export const cardProfiles = pgTable('card_profiles', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  emailEnc: text('email_enc'),
  aliasEnc: text('alias_enc'),
  createdAt: createdAt(),
});

export const cards = pgTable(
  'cards',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** izipay account scope the provider card id belongs to (`izipay:<mode>:<account>`). */
    providerScope: text('provider_scope').notNull().default(''),
    providerCardId: text('provider_card_id').unique(),
    clientCardRef: uuid('client_card_ref').notNull().unique().defaultRandom(),
    product: text('product').notNull(),
    last4: text('last4'),
    status: text('status').notNull(),
    balanceUsdCents: bigint('balance_usd_cents', { mode: 'bigint' }),
    finish: text('finish'),
    createdAt: createdAt(),
    issuedAt: ts('issued_at'),
    syncedAt: ts('synced_at'),
  },
  (t) => [
    check('cards_status_chk', inList(t.status, CardStatus)),
    uniqueIndex('cards_one_pending_per_product_uq')
      .on(t.userId, t.product)
      .where(sql`${t.status} = 'pending_payment'`),
  ],
);

export const cardOperations = pgTable(
  'card_operations',
  {
    id: id(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    amountUsdCents: bigint('amount_usd_cents', { mode: 'bigint' }),
    network: text('network'),
    invoice: jsonb('invoice'),
    fundingWallet: text('funding_wallet'),
    ipHash: text('ip_hash'),
    providerTxnId: text('provider_txn_id'),
    status: text('status').notNull(),
    leaseUntil: ts('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('card_operations_kind_chk', inList(t.kind, CardOpKind)),
    check('card_operations_network_chk', inListOrNull(t.network, CardNetwork)),
    check('card_operations_status_chk', inList(t.status, CardOpStatus)),
    check('card_operations_wallet_chk', isAddressOrNull(t.fundingWallet)),
    index('card_operations_status_lease_idx').on(t.status, t.leaseUntil),
  ],
);

export const cardTransactions = pgTable('card_transactions', {
  id: id(),
  cardId: uuid('card_id')
    .notNull()
    .references(() => cards.id),
  providerTxnId: text('provider_txn_id').notNull().unique(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  currency: text('currency'),
  merchant: text('merchant'),
  status: text('status'),
  occurredAt: ts('occurred_at'),
  raw: jsonb('raw'),
});

export const cardWebhookEvents = pgTable(
  'card_webhook_events',
  {
    id: id(),
    providerScope: text('provider_scope').notNull().default(''),
    providerEventId: text('provider_event_id').notNull(),
    /** Provider event time (`created`), when the event carries one. */
    eventAt: ts('event_at'),
    payloadHash: text('payload_hash').notNull(),
    type: text('type'),
    payload: jsonb('payload'),
    processedAt: ts('processed_at'),
    error: text('error'),
  },
  (t) => [uniqueIndex('card_webhook_events_uq').on(t.providerScope, t.providerEventId)],
);

export const relayOrders = pgTable(
  'relay_orders',
  {
    id: id(),
    cardOperationId: uuid('card_operation_id')
      .notNull()
      .references(() => cardOperations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    requestId: text('request_id').notNull().unique(),
    originAmountMicros: micros('origin_amount_micros'),
    destCurrency: text('dest_currency'),
    destChainId: bigint('dest_chain_id', { mode: 'bigint' }),
    destAddress: text('dest_address'),
    destAmount: text('dest_amount'),
    quote: jsonb('quote'),
    depositTx: text('deposit_tx'),
    status: text('status').notNull(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('relay_orders_status_chk', inList(t.status, RelayStatus))],
);

// ----------------------------------------------------------------- stocks

export const stockTokens = pgTable(
  'stock_tokens',
  {
    address: text('address').primaryKey(),
    symbol: text('symbol').notNull(),
    name: text('name'),
    decimals: integer('decimals').notNull(),
    poolFee: integer('pool_fee'),
    poolAddress: text('pool_address'),
    verifiedAt: ts('verified_at'),
    enabled: boolean('enabled').notNull().default(false),
  },
  (t) => [
    check('stock_tokens_address_chk', isAddress(t.address)),
    check('stock_tokens_pool_chk', isAddressOrNull(t.poolAddress)),
  ],
);

// -------------------------------------------------------------------- ops

export const kv = pgTable('kv', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const canaryResults = pgTable('canary_results', {
  id: id(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id),
  jobId: uuid('job_id').references(() => jobs.id),
  kind: text('kind'),
  expected: jsonb('expected'),
  observed: jsonb('observed'),
  pass: boolean('pass').notNull(),
  createdAt: createdAt(),
});

export const probeResults = pgTable('probe_results', {
  id: id(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => nodes.id),
  vramGb: integer('vram_gb'),
  tokPerSec: numeric('tok_per_sec'),
  classOk: boolean('class_ok').notNull(),
  details: jsonb('details'),
  createdAt: createdAt(),
});

export const slashCases = pgTable(
  'slash_cases',
  {
    id: id(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence'),
    evidenceHash: text('evidence_hash'),
    proposedBps: integer('proposed_bps'),
    status: text('status').notNull(),
    txHash: text('tx_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    check('slash_cases_status_chk', inList(t.status, SlashStatus)),
    uniqueIndex('slash_cases_open_uq').on(t.nodeId, t.reason).where(sql`${t.status} = 'open'`),
  ],
);

export const floorPayments = pgTable(
  'floor_payments',
  {
    epoch: bigint('epoch', { mode: 'bigint' }).notNull(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    usdgMicros: micros('usdg_micros').notNull(),
  },
  (t) => [primaryKey({ columns: [t.epoch, t.nodeId] })],
);

export const auditLog = pgTable('audit_log', {
  id: id(),
  actor: text('actor'),
  action: text('action').notNull(),
  subject: text('subject'),
  details: jsonb('details'),
  createdAt: createdAt(),
});
