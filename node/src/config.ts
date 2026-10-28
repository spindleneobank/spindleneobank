import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform(
    (v) => v === true || (typeof v === 'string' && ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())),
  );

const EnvSchema = z.object({
  SPINDLE_API_URL: z
    .string()
    .url()
    .refine((u) => /^wss?:\/\//.test(u), 'must be a ws:// or wss:// URL'),
  SPINDLE_TOKEN: z.string().min(1).optional(),
  SPINDLE_DATA_DIR: z.string().default('/data'),
  SPINDLE_ENGINE: z.enum(['ollama', 'vllm']).default('ollama'),
  SPINDLE_ENGINE_URL: z.string().url().optional(),
  SPINDLE_VLLM_MODEL: z.string().optional(),
  SPINDLE_MODELS: z.string().optional(),
  /** Upper bound on the context window an Ollama node serves (RAM grows with it). */
  SPINDLE_NUM_CTX: z.coerce.number().int().min(512).default(8192),
  /** Inference threads for Ollama; default follows the container's CPU quota (see cpu.ts). */
  SPINDLE_NUM_THREAD: z.coerce.number().int().min(1).optional(),
  SPINDLE_NAME: z.string().optional(),
  SPINDLE_DEV_LAZY: bool,
  SPINDLE_DEV_FAKE_GPU: z
    .string()
    .regex(/^.+:\d+$/, 'expected "<GPU name>:<vramMb>", e.g. "RTX 4090:24576"')
    .optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface Config {
  apiUrl: string;
  token?: string;
  dataDir: string;
  engine: 'ollama' | 'vllm';
  engineUrl: string;
  vllmModel?: string;
  models?: string[];
  numCtx: number;
  numThread?: number;
  name?: string;
  devLazy: boolean;
  devFakeGpu?: { name: string; vramMb: number };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/** localhost, loopback, or a bare compose service name (no dots). */
export function isDevHost(apiUrl: string): boolean {
  const host = new URL(apiUrl).hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    (!host.includes('.') && !host.includes(':'))
  );
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  const engine = e.SPINDLE_ENGINE;
  let devFakeGpu: Config['devFakeGpu'];
  if (e.SPINDLE_DEV_FAKE_GPU) {
    const i = e.SPINDLE_DEV_FAKE_GPU.lastIndexOf(':');
    devFakeGpu = {
      name: e.SPINDLE_DEV_FAKE_GPU.slice(0, i).trim(),
      vramMb: Number(e.SPINDLE_DEV_FAKE_GPU.slice(i + 1)),
    };
  }
  if ((e.SPINDLE_DEV_LAZY || devFakeGpu) && !isDevHost(e.SPINDLE_API_URL)) {
    throw new Error(
      'SPINDLE_DEV_LAZY / SPINDLE_DEV_FAKE_GPU are refused unless SPINDLE_API_URL points at localhost or a compose service name',
    );
  }
  if (engine === 'vllm' && !e.SPINDLE_VLLM_MODEL) {
    throw new Error('invalid configuration: SPINDLE_VLLM_MODEL is required when SPINDLE_ENGINE=vllm');
  }
  return {
    apiUrl: e.SPINDLE_API_URL,
    token: e.SPINDLE_TOKEN,
    dataDir: e.SPINDLE_DATA_DIR,
    engine,
    engineUrl:
      e.SPINDLE_ENGINE_URL ?? (engine === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8000'),
    vllmModel: e.SPINDLE_VLLM_MODEL,
    models: e.SPINDLE_MODELS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    numCtx: e.SPINDLE_NUM_CTX,
    numThread: e.SPINDLE_NUM_THREAD,
    name: e.SPINDLE_NAME,
    devLazy: e.SPINDLE_DEV_LAZY,
    devFakeGpu,
    logLevel: e.LOG_LEVEL,
  };
}
