import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
const boolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(String(defaultValue) as 'true' | 'false')
    .transform((value) => value === 'true');
const positiveInt = (defaultValue: number) => z.coerce.number().int().positive().default(defaultValue);
const nonnegativeInt = (defaultValue: number) => z.coerce.number().int().nonnegative().default(defaultValue);
const intString = (defaultValue: string) => z.string().regex(/^\d+$/).default(defaultValue);
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, 'lowercase 0x address')
  .optional()
  .or(z.literal('').transform(() => undefined));
const addressList = csv.pipe(z.array(z.string().regex(/^0x[0-9a-f]{40}$/)));
const hexKey32 = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/);
const optionalHexKey32 = z.union([hexKey32, z.literal('')]).default('');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ROLE: z.enum(['api', 'worker', 'migrate']).default('api'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).default('postgres://spindle:spindle@localhost:7232/spindle'),
  TEST_DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().min(1).default('redis://localhost:7279'),

  PUBLIC_API_URL: z.string().default('http://localhost:7200'),
  PUBLIC_APP_URL: z.string().default('http://localhost:7000'),
  CORS_ORIGINS: csv,
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SECURE: boolean(false),
  SIWE_ALLOWED_DOMAINS: csv,

  /** Chain the app talks to: 4663 in prod, 31337 on the local anvil fork. */
  CHAIN_ID: z.coerce.number().int().positive().default(4663),
  /** Real chain used for Relay quotes; stays 4663 even when CHAIN_ID is the dev fork. */
  RELAY_ORIGIN_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  RPC_URLS: csv,
  ALCHEMY_API_KEYS: csv,
  PUBLIC_RPC_URL: z.string().default('https://rpc.mainnet.chain.robinhood.com'),
  USDG_ADDRESS: address,
  PERMIT2_ADDRESS: address,
  SPDL_ADDRESS: address,
  REGISTRY_ADDRESS: address,
  STAKING_ADDRESS: address,
  CLAIMS_ADDRESS: address,
  VAULT_ADDRESS: address,
  ERC8004_IDENTITY_ADDRESS: address,
  UNISWAP_V3_FACTORY: address,
  UNISWAP_V3_QUOTER: address,
  UNISWAP_V3_ROUTER: address,
  TREASURY_ADDRESS: address,
  HOUSE_OWNER_ADDRESS: address,
  KEEPER_PRIVATE_KEY: optionalHexKey32,
  DEPLOY_BLOCK: nonnegativeInt(0),
  LOG_CHUNK: positiveInt(5000),

  RELAY_API_URL: z.string().default('https://api.relay.link'),
  RELAY_API_KEY: z.string().default(''),
  RELAY_MODE: z.enum(['live', 'stub']).default('live'),
  RELAY_STUB_ADDRESS: address,
  IZIPAY_MODE: z.enum(['mock', 'live']).default('mock'),
  IZIPAY_LIVE_WRITES: boolean(false),
  IZIPAY_RATE_BUDGET_PER_MIN: positiveInt(30),
  IZIPAY_BASE_URL: z.string().default(''),
  IZIPAY_API_KEY: z.string().default(''),
  IZIPAY_API_SECRET: z.string().default(''),
  IZIPAY_WEBHOOK_SECRET: z.string().default(''),
  IZIPAY_ACCOUNT_REF: z.string().default('primary'),
  IZIPAY_WEBHOOK_URL: z.string().default(''),
  CARD_DATA_ENC_KEY: optionalHexKey32,

  /** Largest gap between a pool's spot price and its 30-minute TWAP at which a swap is still quoted, in bps. */
  STOCK_MAX_TWAP_DEVIATION_BPS: positiveInt(500),
  EPOCH_SECONDS: positiveInt(3600),
  CLAIM_MIN_USDG_MICROS: intString('10000000'),
  X402_ENABLED: boolean(true),
  X402_MIN_SURCHARGE_MICROS: intString('5000'),
  X402_MAX_UNSETTLED_MICROS: intString('20000000'),
  /** Unsettled x402 exposure across all payers: per-payer limits alone can be farmed with fresh addresses. */
  X402_MAX_GLOBAL_UNSETTLED_MICROS: intString('500000000'),
  X402_MAX_OPENS_PER_IP_DAY: positiveInt(500),
  /** Unsettled credit for a wallet that has settled nothing yet. About what it costs to fund a fresh address. */
  X402_NEW_PAYER_CREDIT_MICROS: intString('50000'),
  /** Extra credit per settled micro, in bps. Keep it well below 10000: a default must never beat paying. */
  X402_CREDIT_PER_SETTLED_BPS: z.coerce.number().int().min(0).max(10_000).default(2500),
  X402_MAX_NEW_PAYERS_PER_IP_DAY: positiveInt(5),
  KEEPER_MIN_ETH_WEI: intString('3000000000000000'),
  KEEPER_CRITICAL_ETH_WEI: intString('1500000000000000'),
  TREES_DIR: z.string().default('data/trees'),
  TOKENIZER_CACHE_DIR: z.string().default('data/tokenizers'),
  ADMIN_ADDRESSES: addressList,
  JOB_TIMEOUT_MS: positiveInt(120000),
  /** Where `bun run node:dist` wrote the node installers and docker build contexts that the API serves. */
  NODE_DIST_DIR: z.string().default('data/node-dist'),
  /** Optional comma-separated model list added as `--models` to the generated install command (dev: the smallest model). */
  NODE_MODELS: z.string().optional(),
  MIN_AGENT_VERSION: z.string().default('0.1.0'),
  CANARY_RATE_BPS: nonnegativeInt(200),
  /** Private JSONL prompt corpus, kept outside the repo. Required for a production worker. */
  CANARY_CORPUS_PATH: z.string().default(''),
  /** Share of paid open-lane jobs re-run on the house node and compared, in basis points. */
  SHADOW_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
  /** false: shadow results are stored for review but have no effect on the node. */
  SHADOW_ENFORCE: boolean(true),
  /** Minimum embedding cosine between a node's chat answer and the house node's. */
  SHADOW_CHAT_COSINE_MIN: z.coerce.number().min(0).max(1).default(0.65),
  SHADOW_EMBED_MODEL: z.string().default('nomic-embed-text'),
  SEALED_LANE_ENABLED: boolean(false),
  /** Availability floor start (YYYY-MM-DD, UTC). Empty = floor disabled. */
  FLOOR_START_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Total floor budget per epoch at day 0, USDG micros (placeholder, owner approval needed). */
  FLOOR_EPOCH_BUDGET_MICROS: intString('2000000'),
  /** Max floor payment per node per epoch, USDG micros. */
  FLOOR_NODE_CAP_MICROS: intString('20000'),
  FLOOR_DAYS: positiveInt(90),
});

export type Env = z.infer<typeof envSchema>;

const SECRET_KEYS = [
  'KEEPER_PRIVATE_KEY',
  'RELAY_API_KEY',
  'IZIPAY_API_KEY',
  'IZIPAY_API_SECRET',
  'IZIPAY_WEBHOOK_SECRET',
  'CARD_DATA_ENC_KEY',
  'ALCHEMY_API_KEYS',
] as const;

type SecretKey = (typeof SECRET_KEYS)[number];
export type Secrets = Readonly<Pick<Env, SecretKey>>;
export type Config = Readonly<Omit<Env, SecretKey>>;

export class ConfigError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Invalid backend configuration: ${variables.join(', ')}`);
  }
}

/** Parses env and splits secrets from config. Throws ConfigError carrying variable names only. */
export function loadConfig(env: Record<string, string | undefined>): { config: Config; secrets: Secrets } {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError([...new Set(result.error.issues.map((i) => String(i.path[0] ?? 'environment')))]);
  }
  const parsed = result.data;
  const secrets = {} as Record<string, unknown>;
  const rest: Record<string, unknown> = { ...parsed };
  for (const key of SECRET_KEYS) {
    secrets[key] = parsed[key];
    delete rest[key];
  }
  return { config: Object.freeze(rest) as Config, secrets: Object.freeze(secrets) as Secrets };
}

function loadOrExit() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const loaded = loadOrExit();
export const config: Config = loaded.config;
export const secrets: Secrets = loaded.secrets;
