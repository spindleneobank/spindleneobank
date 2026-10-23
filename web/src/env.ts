import { parseEnv } from './env.schema';

/** Validated at module load; a bad value throws at build (vite.config.ts) and at runtime. */
export const env = parseEnv(import.meta.env as Record<string, unknown>);
