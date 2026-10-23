/**
 * izipay mock (dev, CI, E2E). Mirrors izipay's business API as documented in docs/plan/card-flows.md:
 * signed requests, `{success,data}` envelope, BSC invoice on issue, TRON invoice on top-up, signed webhooks.
 * Run: `bun run dev/izipay-mock/server.ts` (listens on 8090; host port 7290 in compose).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { FAULTS, type Fault, invoice, MockState, type Network, publicCard, sha } from './state';
import { type WebhookConfig, Webhooks } from './webhooks';

export interface MockOptions {
  port?: number;
  apiKey: string;
  apiSecret: string;
  webhookUrl: string;
  webhookSecret: string;
  stepDelayMs?: number;
  otpDelayMs?: number;
  /** How long a `timeout` fault hangs before answering (default 30 s, longer than clients' 12 s timeout). */
  timeoutMs?: number;
}

const ISSUE_FEE_USD = 20;
const PAY_CURRENCIES: Record<string, Network> = {
  usdtbsc: 'bsc',
  usdttrc20: 'tron',
  usdterc20: 'bsc',
  usdtpoly: 'bsc',
};

/** hex HMAC-SHA256(`${ts}\n${METHOD}\n${pathWithQuery}\n${body}`), the same as pingapp `signRequest`. */
export const signRequest = (secret: string, timestamp: string, method: string, path: string, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}\n${method}\n${path}\n${body}`).digest('hex');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { success: true, data });
const fail = (status: number, code: string, message: string) =>
  json(status, { success: false, error: { code, message } });

export function createMock(opts: MockOptions) {
  const state = new MockState();
  const hookCfg: WebhookConfig = {
    url: opts.webhookUrl,
    secret: opts.webhookSecret,
    stepDelayMs: opts.stepDelayMs ?? 2000,
    otpDelayMs: opts.otpDelayMs ?? 3000,
  };
  const hooks = new Webhooks(hookCfg, state);

  function checkAuth(req: Request, path: string, body: string): Response | null {
    const auth = req.headers.get('authorization') ?? '';
    const key = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    const want = Buffer.from(opts.apiKey);
    if (key.length !== want.length || !timingSafeEqual(key, want)) {
      return fail(401, 'INVALID_API_KEY', 'Invalid or missing API key');
    }
    const ts = req.headers.get('x-timestamp') ?? '';
    const sig = req.headers.get('x-signature') ?? '';
    if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return fail(401, 'INVALID_TIMESTAMP', 'x-timestamp missing or outside the 5 minute window');
    }
    const expected = signRequest(opts.apiSecret, ts, req.method, path, body);
    if (
      !/^[a-f0-9]{64}$/i.test(sig) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(sig.toLowerCase()))
    ) {
      return fail(401, 'INVALID_SIGNATURE', 'Signature mismatch');
    }
    const now = Date.now();
    for (const [s, at] of state.seenSignatures) if (now - at > 305_000) state.seenSignatures.delete(s);
    if (state.seenSignatures.has(sig.toLowerCase())) {
      return fail(401, 'SIGNATURE_REPLAY', 'This signature was already used');
    }
    state.seenSignatures.set(sig.toLowerCase(), now);
    return null;
  }

  const parseBody = (raw: string): Record<string, unknown> | null => {
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN);

  function startConfirmFlow(paymentId: string, dup: boolean) {
    const p = state.payments.get(paymentId);
    if (!p) return;
    const card = state.cards.get(p.card_id);
    if (!card) return;
    p.status = 'paid';
    const ref = { card_id: card.card_id, client_card_ref: card.client_card_ref, payment_id: p.payment_id };
    if (p.kind === 'issue') {
      card.payment_status = 'paid';
      card.issue_status = 'paid_pending_issue';
      hooks.sequence([
        { delayMs: 0, type: 'card.paid', data: ref, dup },
        {
          delayMs: hookCfg.stepDelayMs,
          type: 'card.issued',
          before: () => {
            card.issue_status = 'issued';
            card.issued_at = new Date().toISOString();
          },
          data: ref,
          dup,
        },
      ]);
    } else {
      const credited = Math.max(0, Math.round((p.amount_usd * 0.97 - 1.7) * 100) / 100);
      let transactionId = '';
      hooks.sequence([
        {
          delayMs: 0,
          type: 'card.paid',
          data: { card_id: card.card_id, payment_id: p.payment_id, topup_id: p.topup_id },
          dup,
        },
        {
          delayMs: hookCfg.stepDelayMs,
          type: 'topup.completed',
          before: () => {
            card.pending_topup = Math.max(0, card.pending_topup - p.amount_usd);
            card.balance = Math.round((card.balance + credited) * 100) / 100;
            transactionId = state.addTx(card.card_id, {
              amount: credited,
              type: 'topup',
              status: 'success',
              currency: 'USD',
              is_credit: true,
              merchant: null,
            }).transaction_id;
          },
          // topup.completed carries only card_id + transaction_id (as live izipay does)
          data: () => ({ card_id: card.card_id, transaction_id: transactionId }),
          dup,
        },
      ]);
    }
  }

  async function route(req: Request, url: URL, raw: string, faults: Set<Fault>): Promise<Response> {
    const parts = url.pathname
      .replace(/^\/api\/v1/, '')
      .split('/')
      .filter(Boolean);
    const [a, b, c] = parts;
    const body = parseBody(raw);
    if (body === null) return fail(400, 'VALIDATION_ERROR', 'Body must be a JSON object');
    const m = req.method;

    if (m === 'GET' && a === 'balance' && !b) {
      return ok({
        balance_usd: 1000,
        pricing: {
          visa_issue_usd: '10',
          visa_us_issue_usd: '10',
          mastercard_issue_usd: String(ISSUE_FEE_USD),
        },
        limits: { rate_limit_per_min: 30, daily_card_limit: 10 },
      });
    }

    if (m === 'POST' && a === 'cards' && b === 'issue' && !c) {
      const email = body.cardholder_email;
      const ref = body.client_card_ref;
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) {
        return fail(400, 'VALIDATION_ERROR', 'cardholder_email is required');
      }
      if (typeof ref !== 'string' || !ref)
        return fail(400, 'VALIDATION_ERROR', 'client_card_ref is required');
      const payCurrency = typeof body.pay_currency === 'string' ? body.pay_currency : 'usdttrc20';
      const network = PAY_CURRENCIES[payCurrency];
      if (!network) return fail(400, 'INVALID_PAY_CURRENCY', `Unsupported pay_currency ${payCurrency}`);
      const cardType = typeof body.card_type === 'string' ? body.card_type : 'visa';
      const existingId = state.refs.get(ref);
      if (existingId) {
        // live izipay: a duplicate client_card_ref returns the card but NOT the original invoice
        const existing = state.cards.get(existingId);
        return ok({ card_id: existingId, issue_status: existing?.issue_status, client_card_ref: ref });
      }
      const card = state.newCard({
        ref,
        email,
        alias: typeof body.cardholder_alias === 'string' ? body.cardholder_alias : null,
        cardType,
      });
      const p = state.newPayment(card, 'issue', network, payCurrency, ISSUE_FEE_USD, ISSUE_FEE_USD + 0.35);
      return ok({
        card_id: card.card_id,
        issue_status: card.issue_status,
        client_card_ref: ref,
        ...(faults.has('no-invoice') ? {} : { payment: invoice(p) }),
      });
    }

    if (m === 'GET' && a === 'cards' && !b) {
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const all = [...state.cards.values()];
      return ok({
        cards: all.slice((page - 1) * limit, page * limit).map((x) => publicCard(x)),
        page,
        limit,
        total: all.length,
        total_pages: Math.max(1, Math.ceil(all.length / limit)),
      });
    }

    if (a === 'cards' && b) {
      const card = state.cards.get(b);
      if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

      if (m === 'GET' && !c) {
        const live = url.searchParams.get('live') === '1';
        const issued = card.issue_status === 'issued';
        return ok({
          ...publicCard(card),
          ...(live ? { balance_source: 'live' } : {}),
          card_number: issued ? `5258 47** **** ${card.last4}` : null,
          card: {
            last4: issued ? card.last4 : null,
            balance: card.balance,
            pending_topup: card.pending_topup,
            is_frozen: card.is_frozen,
            ...(live && issued ? { number: card.number, exp: card.exp, cvv: card.cvv } : {}),
          },
        });
      }

      if (m === 'GET' && c === 'transactions') {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const all = state.txs.get(card.card_id) ?? [];
        return ok({
          transactions: all.slice(offset, offset + limit),
          pagination: { limit, offset, total: all.length },
        });
      }

      if (m === 'POST' && c === 'topup') {
        if (card.issue_status !== 'issued') {
          return fail(409, 'CARD_NOT_READY', 'Card is not issued yet; wait for card.issued');
        }
        const amount = num(body.amount_usd ?? body.amount);
        if (!Number.isFinite(amount) || amount < 5 || amount > 10_000) {
          return fail(400, 'VALIDATION_ERROR', 'amount_usd must be between 5 and 10000');
        }
        // Live top-ups ignore the requested rail and always return a TRON invoice. Each POST creates a NEW top-up
        // (izipay ignores the idempotency key), which is the hazard clients must guard against.
        const p = state.newPayment(card, 'topup', 'tron', 'usdttrc20', amount, amount);
        return ok({
          card_id: card.card_id,
          topup_id: p.topup_id,
          card_type: card.card_type,
          fee_pct: 3,
          network_fee_usd: 1.7,
          ...(faults.has('no-invoice') ? {} : { payment: invoice(p) }),
        });
      }

      if (c === 'apple-pay-code') {
        if (card.card_type !== 'mastercard' || card.issue_status !== 'issued') {
          return fail(409, 'APPLE_PAY_UNSUPPORTED', 'Apple Pay codes need an issued mastercard');
        }
        if (m === 'POST') {
          const code = String(100_000 + (sha(`otp:${card.card_id}`).readUInt32BE(0) % 900_000));
          state.otpArmed.set(card.card_id, { expiresAt: Date.now() + 600_000, code: null });
          hooks.sequence([
            {
              delayMs: hookCfg.otpDelayMs,
              type: 'card.otp',
              data: { card_id: card.card_id, last4: card.last4, code, kind: 'apple_pay' },
              dup: faults.has('dup-webhook'),
            },
          ]);
          setTimeout(() => {
            const armed = state.otpArmed.get(card.card_id);
            if (armed) armed.code = code;
          }, hookCfg.otpDelayMs);
          return ok({ armed: true, expires_at: new Date(Date.now() + 600_000).toISOString() });
        }
        if (m === 'GET') {
          const armed = state.otpArmed.get(card.card_id);
          if (!armed || armed.expiresAt < Date.now()) return ok({ status: 'idle' });
          return ok(armed.code ? { status: 'delivered', code: armed.code } : { status: 'waiting' });
        }
      }
    }

    if (m === 'POST' && a === 'sandbox' && b === 'confirm' && !c) {
      const pid = body.payment_id;
      const p =
        typeof pid === 'string' || typeof pid === 'number' ? state.payments.get(String(pid)) : undefined;
      if (!p) return fail(404, 'NOT_FOUND', 'Payment not found');
      if (p.status === 'paid') return fail(409, 'ALREADY_PAID', 'Payment already confirmed');
      const requested = body.amount === undefined ? p.pay_amount : num(body.amount);
      if (!Number.isFinite(requested) || requested <= 0)
        return fail(400, 'VALIDATION_ERROR', 'Invalid amount');
      const amount = faults.has('partial') ? p.pay_amount / 2 : requested;
      p.paid_amount += amount;
      if (p.paid_amount + 1e-9 < p.pay_amount) {
        p.status = 'partially_paid';
        return ok({
          payment_id: p.payment_id,
          status: 'partially_paid',
          paid_amount: p.paid_amount,
          pay_amount: p.pay_amount,
        });
      }
      startConfirmFlow(p.payment_id, faults.has('dup-webhook'));
      return ok({
        payment_id: p.payment_id,
        status: 'paid',
        paid_amount: p.paid_amount,
        pay_amount: p.pay_amount,
      });
    }

    return fail(404, 'NOT_FOUND', "Resource doesn't exist");
  }

  async function admin(req: Request, url: URL, raw: string): Promise<Response> {
    if (req.method === 'POST' && url.pathname === '/__mock/reset') {
      state.reset();
      return ok({ reset: true });
    }
    if (url.pathname === '/__mock/faults') {
      if (req.method === 'POST') {
        const body = parseBody(raw);
        const list = Array.isArray(body?.faults) ? (body.faults as unknown[]) : null;
        if (!list || list.some((f) => !FAULTS.includes(f as Fault))) {
          return fail(400, 'VALIDATION_ERROR', `faults must be an array of ${FAULTS.join('|')}`);
        }
        state.stickyFaults = new Set(list as Fault[]);
      }
      return ok({ faults: [...state.stickyFaults] });
    }
    if (req.method === 'GET' && url.pathname === '/__mock/requests') return ok({ requests: state.requests });
    if (req.method === 'GET' && url.pathname === '/__mock/state') {
      return ok({ cards: [...state.cards.values()], payments: [...state.payments.values()] });
    }
    if (req.method === 'POST' && url.pathname === '/__mock/webhook-url') {
      const body = parseBody(raw);
      if (typeof body?.url !== 'string') return fail(400, 'VALIDATION_ERROR', 'url required');
      hooks.setUrl(body.url);
      return ok({ url: body.url });
    }
    return fail(404, 'NOT_FOUND', 'Unknown mock admin route');
  }

  const server = Bun.serve({
    port: opts.port ?? 8090,
    hostname: '0.0.0.0',
    async fetch(req) {
      const url = new URL(req.url);
      const raw = req.method === 'GET' ? '' : await req.text();
      if (url.pathname.startsWith('/__mock/')) return admin(req, url, raw);

      const faults = new Set<Fault>(state.stickyFaults);
      const header = req.headers.get('x-mock-fault');
      if (header && FAULTS.includes(header as Fault)) faults.add(header as Fault);

      state.requests.push({
        at: new Date().toISOString(),
        method: req.method,
        path: url.pathname,
        fault: [...faults][0] ?? null,
      });
      const authFail = checkAuth(req, url.pathname + url.search, raw);
      if (authFail) return authFail;

      if (faults.has('429')) return fail(429, 'RATE_LIMIT', 'Too many requests per minute');
      if (faults.has('500')) return fail(500, 'INTERNAL_ERROR', 'Server error');
      if (faults.has('timeout')) await new Promise((r) => setTimeout(r, opts.timeoutMs ?? 30_000));
      return route(req, url, raw, faults);
    },
  });

  return {
    server,
    state,
    hooks,
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

if (import.meta.main) {
  const apiKey = process.env.IZIPAY_API_KEY ?? '';
  const apiSecret = process.env.IZIPAY_API_SECRET ?? '';
  const webhookSecret = process.env.IZIPAY_WEBHOOK_SECRET ?? '';
  if (!apiKey || !apiSecret || !webhookSecret) {
    console.error('izipay-mock: IZIPAY_API_KEY, IZIPAY_API_SECRET and IZIPAY_WEBHOOK_SECRET must be set');
    process.exit(1);
  }
  const mock = createMock({
    port: Number(process.env.IZIPAY_MOCK_PORT ?? 8090),
    apiKey,
    apiSecret,
    webhookSecret,
    webhookUrl: process.env.IZIPAY_WEBHOOK_URL || 'http://api:8080/v1/webhooks/izipay',
    stepDelayMs: Number(process.env.IZIPAY_MOCK_STEP_DELAY_MS ?? 2000),
    otpDelayMs: Number(process.env.IZIPAY_MOCK_OTP_DELAY_MS ?? 3000),
  });
  console.log(`izipay-mock listening on ${mock.server.port}`);
}
