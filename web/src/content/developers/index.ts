// Content for /developers. Code snippets are the example files themselves, imported with ?raw.
import curlSh from '../../../../examples/curl.sh?raw';
import openaiNode from '../../../../examples/openai-node.mjs?raw';
import openaiPython from '../../../../examples/openai-python.py?raw';
import receiptLib from '../../../../examples/receipt-lib.ts?raw';
import verifyReceipt from '../../../../examples/verify-receipt.ts?raw';
import x402Client from '../../../../examples/x402-client.ts?raw';
import x402Lib from '../../../../examples/x402-lib.ts?raw';
import x402Session from '../../../../examples/x402-session.ts?raw';

export const EXAMPLE_DEFAULT_API = 'http://127.0.0.1:7200';

/** Example files as published in `app/examples/`. The default dev URL is swapped for the live API URL at render. */
export const EXAMPLES = {
  curl: { file: 'curl.sh', code: curlSh },
  node: { file: 'openai-node.mjs', code: openaiNode },
  python: { file: 'openai-python.py', code: openaiPython },
  x402Client: { file: 'x402-client.ts', code: x402Client },
  x402Lib: { file: 'x402-lib.ts', code: x402Lib },
  x402Session: { file: 'x402-session.ts', code: x402Session },
  verify: { file: 'verify-receipt.ts', code: verifyReceipt },
  receiptLib: { file: 'receipt-lib.ts', code: receiptLib },
} as const;

export const SECTIONS = [
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'models', label: 'Models and pricing' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'x402', label: 'x402 per-call payment' },
  { id: 'sessions', label: 'x402 sessions' },
  { id: 'receipts', label: 'Receipts and verification' },
  { id: 'limits', label: 'Limits and errors' },
  { id: 'openapi', label: 'OpenAPI' },
] as const;

export const QUICKSTART_STEPS = [
  { n: '01', title: 'Connect your wallet', body: 'Open the dashboard and sign in with your wallet.' },
  {
    n: '02',
    title: 'Deposit USDG',
    body: 'Dashboard, Developers tab: approve and deposit USDG into your buyer balance. A deposit counts after 12 blocks.',
  },
  {
    n: '03',
    title: 'Create an API key',
    body: 'Create a key in the same tab. It is shown once and looks like sk-spdl-...',
  },
  {
    n: '04',
    title: 'Call the API',
    body: 'Point any OpenAI SDK at the Spindle base URL and pass the key as the bearer token.',
  },
] as const;

export type Endpoint = {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  auth: string;
  request?: string;
  response: string;
  notes?: string[];
};

export const JOB_HEADERS = [
  ['X-Spindle-Lane', 'Request header on chat completions: `open` (default) or `sealed` (in testing).'],
  ['X-Spindle-Job-Id', 'Response header: the job id, also the receipt id.'],
  ['X-Spindle-Receipt', 'Response header: `/v1/receipts/<jobId>`.'],
  [
    'X-Spindle-Charge-Micros',
    'Response header (non-stream): the exact charge in USDG micros. Streams carry it in the final chunk.',
  ],
] as const;

export const ENDPOINTS: Endpoint[] = [
  {
    id: 'models',
    method: 'GET',
    path: '/v1/models',
    summary: 'Models that are enabled. `available` is true when at least one online node serves the model.',
    auth: 'none',
    response: `{ "object": "list", "data": [{
  "id": "llama-3.1-8b-instruct", "object": "model", "owned_by": "spindle",
  "lanes": ["open"], "kind": "chat", "available": true,
  "pricing": { "unitKind": "tokens_1m", "buyerMicrosPerUnit": "200000" }
}] }`,
  },
  {
    id: 'chat',
    method: 'POST',
    path: '/v1/chat/completions',
    summary:
      'OpenAI chat completions, streaming or not. Every response carries a `spindle` object with the job id, the exact charge and the receipt URL.',
    auth: 'API key, X-PAYMENT or X-Spindle-Session',
    request: `{ "model": "llama-3.1-8b-instruct", "stream": false, "max_tokens": 256,
  "messages": [{ "role": "user", "content": "Say hello in five words." }] }`,
    response: `{ "id": "chatcmpl-...", "object": "chat.completion", "model": "llama-3.1-8b-instruct",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Hello there, nice to meet you." }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 14, "completion_tokens": 8, "total_tokens": 22 },
  "spindle": { "jobId": "0b7e0f3e-...", "chargeMicros": "5", "receiptUrl": "/v1/receipts/0b7e0f3e-..." } }`,
    notes: [
      'Streaming (`"stream": true`) is standard SSE. The final chunk includes `usage` and `spindle: { jobId, chargeMicros, receiptUrl }`, then `data: [DONE]`.',
      'Accepted fields: model, messages, stream, max_tokens, temperature, top_p, stop, seed.',
    ],
  },
  {
    id: 'embeddings',
    method: 'POST',
    path: '/v1/embeddings',
    summary: 'OpenAI embeddings. `input` is a string or an array of strings.',
    auth: 'API key, X-PAYMENT or X-Spindle-Session',
    request: `{ "model": "bge-small-en", "input": ["hello", "world"] }`,
    response: `{ "object": "list", "model": "bge-small-en",
  "data": [{ "object": "embedding", "index": 0, "embedding": [0.012, -0.04, "..."] }],
  "usage": { "prompt_tokens": 2, "total_tokens": 2 },
  "spindle": { "jobId": "...", "chargeMicros": "1", "receiptUrl": "/v1/receipts/..." } }`,
  },
  {
    id: 'images',
    method: 'POST',
    path: '/v1/images/generations',
    summary:
      'Image generation. Served only when a connected node advertises the images capability; otherwise `503 NO_CAPACITY`.',
    auth: 'API key, X-PAYMENT or X-Spindle-Session',
    request: `{ "model": "sdxl", "prompt": "a lighthouse at dusk", "n": 1, "size": "1024x1024" }`,
    response: `{ "created": 1790000000, "data": [{ "b64_json": "..." }],
  "spindle": { "jobId": "...", "chargeMicros": "40000", "receiptUrl": "/v1/receipts/..." } }`,
  },
  {
    id: 'receipt',
    method: 'GET',
    path: '/v1/receipts/:jobId',
    summary: 'The node-signed receipt for a job. Public by job id, which is an unguessable uuid.',
    auth: 'none',
    response: `{ "jobId": "0b7e0f3e-...", "nodeId": "...", "onchainNodeId": "7", "nodeKey": "0x...20 bytes...",
  "lane": "open", "model": "llama-3.1-8b-instruct", "usage": { "p": 14, "c": 8 },
  "cose": "<base64 COSE_Sign1>", "payload": { "...decoded..." },
  "verified": true, "reason": null, "attestationRef": null, "epoch": 12 }`,
    notes: ['`epoch` is null until the job is included in an epoch (epochs close hourly).'],
  },
  {
    id: 'epoch-latest',
    method: 'GET',
    path: '/v1/epochs/latest',
    summary: 'The latest epoch and its Merkle root.',
    auth: 'none',
    response: `{ "epoch": 12, "root": "0x...", "totalEarned": "123456789",
  "postedAt": "2026-10-23T10:00:00Z", "txHash": "0x...", "claimableAt": "2026-10-23T11:00:00Z" }`,
  },
  {
    id: 'epoch-tree',
    method: 'GET',
    path: '/v1/epochs/:n/tree',
    summary:
      'The full Merkle tree of epoch n in OpenZeppelin StandardMerkleTree dump format. Immutable once posted.',
    auth: 'none',
    response: `{ "format": "standard-v1", "leafEncoding": ["address", "uint256"],
  "tree": ["0x...root...", "0x..."], "values": [{ "value": ["0xowner...", "4000000"], "treeIndex": 3 }] }`,
  },
];

export const X402_CHALLENGE = `{
  "x402Version": 2,
  "resource": { "url": "https://api.example/v1/chat/completions", "description": "Spindle inference", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:4663",
    "asset": "<USDG address>",
    "amount": "25000",
    "payTo": "<BuyerVault address>",
    "maxTimeoutSeconds": 300,
    "extra": {
      "assetTransferMethod": "permit2-witness",
      "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "spender": "<BuyerVault address>",
      "witnessType": "SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)",
      "paymentId": "0x...32 bytes...",
      "surcharge": "5000",
      "validAfter": "1790000000",
      "deadline": "1790003600",
      "nonce": "<random 248-bit uint256>",
      "priceBasis": { "unitKind": "tokens_1m", "buyerMicrosPerUnit": "200000", "maxTokens": 1024 }
    }
  }]
}`;

export const X402_TYPED_DATA = `domain:      { name: "Permit2", chainId: 4663, verifyingContract: <permit2> }
primaryType: PermitWitnessTransferFrom
message: {
  permitted: { token: <asset>, amount: <cap = accepts[0].amount> },
  spender:   <BuyerVault>,
  nonce:     <extra.nonce>,
  deadline:  <extra.deadline>,
  witness:   { paymentId, surcharge, validAfter }       // type SpindlePayment
}
types.SpindlePayment = [
  { name: "paymentId",  type: "bytes32" },
  { name: "surcharge",  type: "uint256" },
  { name: "validAfter", type: "uint256" }
]`;

export const X402_PAYMENT_HEADER = `X-PAYMENT: base64(JSON({
  "x402Version": 2, "scheme": "exact", "network": "eip155:4663",
  "payload": {
    "payer": "0x...", "paymentId": "0x...",
    "permit":  { "permitted": { "token": "0x...", "amount": "25000" }, "nonce": "...", "deadline": "..." },
    "witness": { "paymentId": "0x...", "surcharge": "5000", "validAfter": "..." },
    "signature": "0x..."
  }
}))

X-PAYMENT-RESPONSE: base64(JSON({ "paymentId": "0x...", "used": "9000", "surcharge": "5000", "settlement": "batched" }))`;

export const X402_NOTES = [
  'Cap semantics: the amount you sign is a cap (maximum job charge plus the surcharge). You pay the actual usage, never more than the cap.',
  'Surcharge: a small per-payment fee that covers settlement gas. It is paid once per payment or session and goes to the treasury.',
  'Settlement is batched: the keeper settles closed payments every 10 minutes, or as soon as 20 are waiting. Your signature is not spent until then.',
  'Exposure cap: Spindle limits the total unsettled caps per wallet (default 20 USDG). Above it you get a 402 until earlier payments settle.',
  'The signature deadline must be at least 30 minutes ahead so the batch has time to settle.',
  'Permit2 approval: USDG has no gasless approval, so approve USDG to Permit2 once from your wallet (a normal transaction, you pay gas). After that every payment is a signature.',
  'If x402 is paused you get a 402 that says to use an API key with a deposited balance.',
];

export const SESSION_STEPS = [
  [
    'Create',
    'POST /v1/x402/sessions { payer, capMicros, ttlSec } returns { sessionId, typedData, surchargeMicros, expiresAt }. Cap is at most 5 USDG, ttl at most 3600 seconds.',
  ],
  [
    'Open',
    'Sign typedData, then POST /v1/x402/sessions/:id/open { signature } returns { sessionToken, spendableMicros }. The token is shown once.',
  ],
  [
    'Use',
    'Send X-Spindle-Session: <token> on any buyer call. Each call reserves its maximum charge from the remaining cap and settles the actual charge. When the cap is used up you get 402 SESSION_EXHAUSTED.',
  ],
  [
    'Close',
    'POST /v1/x402/sessions/:id/close (or let it expire). GET /v1/x402/sessions/:id returns { status, usedMicros, spendableMicros, settleTx } with the same header, until status is settled.',
  ],
] as const;

export const SESSION_TRUST =
  'Spindle settles actual usage up to your signed cap. The signature authorises a maximum; it is never spent in full unless you use it in full.';

export const RECEIPT_STRUCTURE = `COSE_Sign1 (RFC 9052, CBOR tag 18), algorithm ES256K (-47)
protected header : { 1: -47, 4: kid = nodeKey (20-byte address of the node key) }
payload (CBOR)   : { v:1, jobId, nodeKey, model, modelDigest, kind, lane,
                     usage:{ p, c, n? }, inputDigest, outputDigest,
                     startedAt, finishedAt, agentVersion, attestation? }
signature        : secp256k1 compact r||s over sha256(Sig_structure)
Sig_structure    : ["Signature1", protected, h'', payload]`;

export const RECEIPT_STEPS = [
  'GET /v1/receipts/:jobId and base64-decode `cose`.',
  'Decode the COSE_Sign1. Check alg is -47 and that kid equals the receipt nodeKey.',
  'Verify the secp256k1 signature over sha256(Sig_structure) with the node public key (the example recovers it from the signature and matches its address to the signed kid, or takes NODE_PUBKEY).',
  'Compare the signed payload to the API view: jobId, nodeKey, model and usage.',
  'Find the job in an epoch: `epoch` on the receipt, then GET /v1/epochs/:epoch/tree. The leaf for the node owner is keccak256(keccak256(abi.encode(owner, cumulativeMicros))). Verify its proof against the tree root.',
  'Compare the tree root with SpindleClaims.roots(epoch) on chain. A matching root means the tree is the one the contract accepts claims against.',
];

export const DIGESTS = [
  [
    'inputDigest',
    'sha256 of the canonical JSON of your request. Hash your own request the same way to confirm the node ran what you sent.',
  ],
  [
    'outputDigest',
    'sha256 of the output: the UTF-8 text for chat, little-endian float32 bytes for embeddings, the image bytes for images.',
  ],
] as const;

export const RECEIPT_LIMIT =
  'A receipt proves that a registered node signed an attested run with these digests and this usage. It does not prove that the output is correct or good.';

export const ERROR_CODES = [
  ['VALIDATION', '400', 'The request body or query is invalid.'],
  ['UNAUTHENTICATED', '401', 'Missing or unknown API key, or session token.'],
  ['FORBIDDEN', '403', 'The key may not do this.'],
  ['NOT_FOUND', '404', 'Unknown job, epoch or session.'],
  ['CONFLICT', '409', 'The request conflicts with current state.'],
  ['PAYMENT_REQUIRED', '402', 'x402 challenge (see PAYMENT-REQUIRED), or x402 is paused.'],
  ['INSUFFICIENT_BALANCE', '402', 'Your deposited balance cannot cover the maximum charge of this request.'],
  ['SESSION_EXHAUSTED', '402', 'The x402 session has no spendable cap left for this request.'],
  ['RATE_LIMITED', '429', '60 requests per minute per key (or per wallet for x402). See Retry-After.'],
  ['NO_CAPACITY', '503', 'No online node can serve this model and lane right now. Nothing was charged.'],
  ['UPSTREAM_UNAVAILABLE', '502', 'The node failed or timed out. The reservation is released.'],
  ['INTERNAL', '500', 'Unexpected error.'],
] as const;

export const LIMITS = [
  ['Rate limit', '60 requests per minute per API key (x402: per wallet).'],
  [
    'max_tokens',
    'Defaults to 1024 and is capped at 8192. Your balance must cover the maximum charge: (prompt tokens + max_tokens) times the rate.',
  ],
  [
    'Sealed lane',
    'X-Spindle-Lane: sealed routes to attested nodes with encrypted prompts. It is in testing and may return 503 NO_CAPACITY or 404 for sealed keys.',
  ],
  ['Errors', 'OpenAI-compatible routes return { "error": { "message", "type", "code" } }.'],
] as const;
