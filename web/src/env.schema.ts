import { z } from 'zod';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x address');
const url = z.string().url();

/** Zod-validated `import.meta.env`. Also imported by vite.config.ts so an invalid build fails early. */
export const envSchema = z.object({
  VITE_API_URL: url,
  VITE_APP_URL: url,
  VITE_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  VITE_RPC_URL: url,
  VITE_REOWN_PROJECT_ID: z.string().min(1),
  VITE_EXPLORER_URL: url,
  VITE_USDG_ADDRESS: address,
  VITE_PERMIT2_ADDRESS: address,
  VITE_REGISTRY_ADDRESS: address,
  VITE_STAKING_ADDRESS: address,
  VITE_CLAIMS_ADDRESS: address,
  VITE_VAULT_ADDRESS: address,
  VITE_SPDL_ADDRESS: address,
  VITE_NODE_IMAGE: z.string().min(1),
  VITE_API_MOCK: z.enum(['0', '1']).default('0'),
});

export type RawEnv = z.input<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>) {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid frontend environment:\n${issues}`);
  }
  const e = parsed.data;
  return {
    apiUrl: e.VITE_API_URL.replace(/\/$/, ''),
    appUrl: e.VITE_APP_URL.replace(/\/$/, ''),
    chainId: e.VITE_CHAIN_ID,
    rpcUrl: e.VITE_RPC_URL,
    reownProjectId: e.VITE_REOWN_PROJECT_ID,
    explorerUrl: e.VITE_EXPLORER_URL.replace(/\/$/, ''),
    addresses: {
      usdg: e.VITE_USDG_ADDRESS.toLowerCase() as `0x${string}`,
      permit2: e.VITE_PERMIT2_ADDRESS.toLowerCase() as `0x${string}`,
      registry: e.VITE_REGISTRY_ADDRESS.toLowerCase() as `0x${string}`,
      staking: e.VITE_STAKING_ADDRESS.toLowerCase() as `0x${string}`,
      claims: e.VITE_CLAIMS_ADDRESS.toLowerCase() as `0x${string}`,
      vault: e.VITE_VAULT_ADDRESS.toLowerCase() as `0x${string}`,
      spdl: e.VITE_SPDL_ADDRESS.toLowerCase() as `0x${string}`,
    },
    nodeImage: e.VITE_NODE_IMAGE,
    mock: e.VITE_API_MOCK === '1',
  };
}
