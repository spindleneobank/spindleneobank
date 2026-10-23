import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../lib/http';
import { OpenAIError } from '../../shared/api/common';
import {
  GetModelsRes,
  PostChatCompletionsReq,
  PostChatCompletionsRes,
  PostEmbeddingsReq,
  PostEmbeddingsRes,
  PostImagesGenerationsReq,
  PostImagesGenerationsRes,
} from '../../shared/api/openai';
import {
  GetEpochsLatestRes,
  GetEpochsRes,
  GetEpochTreeRes,
  GetRateCardRes,
  ReceiptView,
} from '../../shared/api/public';
import {
  GetX402SessionRes,
  PostX402SessionCloseRes,
  PostX402SessionOpenReq,
  PostX402SessionOpenRes,
  PostX402SessionsReq,
  PostX402SessionsRes,
} from '../../shared/api/x402';

/** OpenAPI 3.1 document for the public + buyer API, generated from the shared zod schemas. */
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  content: { 'application/json': { schema } },
  required: true,
});
const err = json(OpenAIError, 'Error');
const buyerSecurity = [{ apiKey: [] }, { x402Payment: [] }, { x402Session: [] }];
const lane = {
  'X-Spindle-Lane': z.enum(['open', 'sealed']).optional().openapi({ description: 'Defaults to open.' }),
};
const jobHeaders = {
  'X-Spindle-Job-Id': { description: 'Job id', schema: { type: 'string' as const } },
  'X-Spindle-Receipt': { description: 'Relative receipt URL', schema: { type: 'string' as const } },
  'X-Spindle-Charge-Micros': {
    description: 'Exact charge in USDG micros',
    schema: { type: 'string' as const },
  },
};

export function buildOpenApiDocument(version = '1') {
  const doc = new OpenAPIHono();
  const r = doc.openAPIRegistry;
  r.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Authorization: Bearer sk-spdl-... (prepaid balance)',
  });
  r.registerComponent('securitySchemes', 'x402Payment', {
    type: 'apiKey',
    in: 'header',
    name: 'X-PAYMENT',
    description: 'x402 exact: base64 payment payload for a PAYMENT-REQUIRED challenge',
  });
  r.registerComponent('securitySchemes', 'x402Session', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Spindle-Session',
    description: 'x402 session token',
  });
  const challenge = {
    description:
      'x402 payment required (header PAYMENT-REQUIRED carries base64 of the same JSON) or insufficient balance',
    content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
  };
  const buyerResponses = (ok: z.ZodType) => ({
    200: { ...json(ok, 'OK'), headers: jobHeaders },
    400: err,
    402: challenge,
    429: err,
    503: err,
  });
  const reg = (method: 'get' | 'post', path: string, summary: string, extra: Record<string, unknown>) =>
    r.registerPath({ method, path, summary, ...extra } as Parameters<typeof r.registerPath>[0]);

  reg('get', '/v1/models', 'List models', {
    tags: ['Buyer'],
    responses: { 200: json(GetModelsRes, 'Models') },
  });
  reg('post', '/v1/chat/completions', 'Chat completion (stream or not)', {
    tags: ['Buyer'],
    security: buyerSecurity,
    request: { headers: z.object(lane), body: body(PostChatCompletionsReq) },
    responses: buyerResponses(PostChatCompletionsRes),
  });
  reg('post', '/v1/embeddings', 'Embeddings', {
    tags: ['Buyer'],
    security: buyerSecurity,
    request: { body: body(PostEmbeddingsReq) },
    responses: buyerResponses(PostEmbeddingsRes),
  });
  reg('post', '/v1/images/generations', 'Image generation (capacity dependent)', {
    tags: ['Buyer'],
    security: buyerSecurity,
    request: { body: body(PostImagesGenerationsReq) },
    responses: buyerResponses(PostImagesGenerationsRes),
  });
  reg('get', '/v1/rate-card', "Today's rate card", {
    tags: ['Public'],
    responses: { 200: json(GetRateCardRes, 'Rate card') },
  });
  reg('get', '/v1/receipts/{jobId}', 'Signed job receipt', {
    tags: ['Public'],
    request: { params: z.object({ jobId: z.string().uuid() }) },
    responses: { 200: json(ReceiptView, 'Receipt'), 404: err },
  });
  reg('get', '/v1/epochs', 'List epochs', {
    tags: ['Public'],
    responses: { 200: json(GetEpochsRes, 'Epochs, newest first') },
  });
  reg('get', '/v1/epochs/latest', 'Latest epoch', {
    tags: ['Public'],
    responses: { 200: json(GetEpochsLatestRes, 'Latest epoch') },
  });
  reg('get', '/v1/epochs/{epoch}/tree', 'Epoch Merkle tree (StandardMerkleTree dump)', {
    tags: ['Public'],
    request: { params: z.object({ epoch: z.string().regex(/^\d+$/) }) },
    responses: { 200: json(GetEpochTreeRes, 'Tree'), 404: err },
  });
  reg('post', '/v1/x402/sessions', 'Create an x402 session (returns Permit2 typed data to sign)', {
    tags: ['x402'],
    request: { body: body(PostX402SessionsReq) },
    responses: { 200: json(PostX402SessionsRes, 'Session'), 400: err },
  });
  const idParam = z.object({ id: z.string() });
  reg('post', '/v1/x402/sessions/{id}/open', 'Open a session with the signature', {
    tags: ['x402'],
    request: { params: idParam, body: body(PostX402SessionOpenReq) },
    responses: { 200: json(PostX402SessionOpenRes, 'Session token'), 400: err },
  });
  reg('get', '/v1/x402/sessions/{id}', 'Session status', {
    tags: ['x402'],
    security: [{ x402Session: [] }],
    request: { params: idParam },
    responses: { 200: json(GetX402SessionRes, 'Status'), 401: err },
  });
  reg('post', '/v1/x402/sessions/{id}/close', 'Close a session', {
    tags: ['x402'],
    security: [{ x402Session: [] }],
    request: { params: idParam },
    responses: { 200: json(PostX402SessionCloseRes, 'Closing'), 401: err },
  });

  return doc.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Spindle API',
      version,
      description: 'OpenAI-compatible inference API with signed receipts.',
    },
    servers: [{ url: '/' }],
  });
}

export default function openapiRoutes(app: Hono<Env>): void {
  let cached: ReturnType<typeof buildOpenApiDocument> | undefined;
  app.get('/v1/openapi.json', (c) => {
    cached ??= buildOpenApiDocument();
    c.header('cache-control', 'public, max-age=300');
    return c.json(cached);
  });
}
