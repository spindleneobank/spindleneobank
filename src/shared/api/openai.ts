import { z } from 'zod';
import { JobKind, Lane, UnitKind } from '../enums';
import { MicrosString } from '../money';

/** OpenAI-compatible buyer API. */

export const HEADER_JOB_ID = 'X-Spindle-Job-Id';
export const HEADER_RECEIPT = 'X-Spindle-Receipt';
export const HEADER_CHARGE_MICROS = 'X-Spindle-Charge-Micros';
export const HEADER_LANE = 'X-Spindle-Lane';
export const MAX_TOKENS_DEFAULT = 1024;
export const MAX_TOKENS_CAP = 8192;
/** A larger batch would not fit in one node frame (`src/lib/limits.ts`). */
export const MAX_EMBEDDING_INPUTS = 48;

export const SpindleMeta = z.object({
  jobId: z.string(),
  chargeMicros: MicrosString,
  receiptUrl: z.string(),
  /** x402 only: base64 X-PAYMENT-RESPONSE (streams cannot send it as a header). */
  paymentResponse: z.string().optional(),
});
export type SpindleMeta = z.infer<typeof SpindleMeta>;

export const GetModelsReq = z.void();
export const ModelListItem = z.object({
  id: z.string(),
  object: z.literal('model'),
  owned_by: z.literal('spindle'),
  lanes: z.array(z.enum(Lane)),
  kind: z.enum(JobKind),
  available: z.boolean(),
  /** Largest context window (tokens) served by an online node for this model; absent in older replies. */
  context_length: z.number().int().nonnegative().optional(),
  /** A sealed-lane request for this model would find a node right now; absent in older replies. */
  sealed_available: z.boolean().optional(),
  pricing: z.object({ unitKind: z.enum(UnitKind), buyerMicrosPerUnit: MicrosString }),
});
export const GetModelsRes = z.object({ object: z.literal('list'), data: z.array(ModelListItem) });

const ContentPart = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
]);
export const ChatMessage = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(ContentPart)]).nullable(),
  name: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const PostChatCompletionsReq = z.object({
  model: z.string(),
  messages: z.array(ChatMessage).min(1),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive().max(MAX_TOKENS_CAP).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
  seed: z.number().int().optional(),
});
export type PostChatCompletionsReq = z.infer<typeof PostChatCompletionsReq>;

const Usage = z.object({
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  total_tokens: z.number().int(),
});

export const PostChatCompletionsRes = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int(),
      message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
        reasoning: z.string().optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: Usage,
  spindle: SpindleMeta,
});

/** One SSE `data:` payload; the final chunk carries `usage` and `spindle`. */
export const ChatCompletionChunk = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int(),
      delta: z.object({
        role: z.string().optional(),
        content: z.string().optional(),
        reasoning: z.string().optional(),
      }),
      finish_reason: z.string().nullable(),
    }),
  ),
  usage: Usage.optional(),
  spindle: SpindleMeta.optional(),
});

export const PostEmbeddingsReq = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string()).min(1).max(MAX_EMBEDDING_INPUTS)]),
});
export const PostEmbeddingsRes = z.object({
  object: z.literal('list'),
  data: z.array(
    z.object({ object: z.literal('embedding'), index: z.number().int(), embedding: z.array(z.number()) }),
  ),
  model: z.string(),
  usage: z.object({ prompt_tokens: z.number().int(), total_tokens: z.number().int() }),
  spindle: SpindleMeta,
});

export const PostImagesGenerationsReq = z.object({
  model: z.string(),
  prompt: z.string().min(1),
  n: z.number().int().min(1).max(4).optional(),
  size: z.string().optional(),
});
export const PostImagesGenerationsRes = z.object({
  created: z.number().int(),
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().optional() })),
  spindle: SpindleMeta,
});
