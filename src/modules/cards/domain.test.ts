import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  advanceStatus,
  decimal,
  decimalToUnits,
  normalizeInvoice,
  otpFromEvent,
  parseProviderJson,
  sanitizeEvent,
  signRequest,
  verifyWebhook,
} from './domain';
import {
  assertProductionSafe,
  assertRelayModeSafe,
  cardSettings,
  decryptCardData,
  encryptCardData,
} from './settings';

describe('domain', () => {
  test('signRequest matches the documented HMAC input', () => {
    const want = createHmac('sha256', 's').update('1\nPOST\n/api/v1/cards/issue\n{"a":1}').digest('hex');
    expect(signRequest('s', '1', 'POST', '/api/v1/cards/issue', '{"a":1}')).toBe(want);
  });

  test('verifyWebhook is HMAC of the raw body and rejects malformed signatures', () => {
    const body = Buffer.from('{"id":"e1"}');
    const sig = createHmac('sha256', 'k').update(body).digest('hex');
    expect(verifyWebhook('k', body, sig)).toBe(true);
    expect(verifyWebhook('k', body, sig.replace(/.$/, '0'))).toBe(false);
    expect(verifyWebhook('k', body, 'zz')).toBe(false);
    expect(verifyWebhook('', body, sig)).toBe(false);
  });

  test('parseProviderJson keeps number lexemes exact', () => {
    const v = parseProviderJson('{"pay_amount":20.350000000000000001,"n":5}') as Record<string, string>;
    expect(v.pay_amount).toBe('20.350000000000000001');
    expect(decimal(v.n)).toBe('5');
  });

  test('decimalToUnits scales by destination decimals and rounds extra digits up', () => {
    expect(decimalToUnits('20.35', 18)).toBe(20_350_000_000_000_000_000n);
    expect(decimalToUnits('50.69', 6)).toBe(50_690_000n);
    expect(decimalToUnits('1.0000001', 6)).toBe(1_000_001n);
  });

  test('normalizeInvoice accepts provider aliases and rejects a different rail', () => {
    const inv = normalizeInvoice(
      {
        payment: {
          pay_address: 'TX',
          pay_amount: '10.5',
          pay_currency: 'USDT-TRC20',
          network: 'TRC20',
          payment_id: 7,
          expires_at: '2030-01-01T00:00:00Z',
          invoice_url: 'https://evil.example/x',
        },
      },
      'tron',
    );
    expect(inv.payAddress).toBe('TX');
    expect(inv.url).toBeNull();
    expect(inv.paymentId).toBe('7');
    expect(() =>
      normalizeInvoice({ payment: { pay_address: '0x1', pay_amount: '1', pay_currency: 'usdtbsc' } }, 'tron'),
    ).toThrow();
  });

  test('sanitizeEvent keeps ids only; OTP codes never reach the stored payload', () => {
    const raw = {
      id: 'e1',
      type: 'card.otp',
      data: { card_id: 'c1', code: '123456', last4: '4242', kind: 'apple_pay' },
    };
    const e = sanitizeEvent(raw);
    expect(JSON.stringify(e)).not.toContain('123456');
    expect(otpFromEvent(raw)).toEqual({ cardId: 'c1', code: '123456' });
  });

  test('advanceStatus: completion is sticky, review is not downgraded by stale states', () => {
    expect(advanceStatus('completed', 'failed')).toBe('completed');
    expect(advanceStatus('review', 'awaiting_payment')).toBe('review');
    expect(advanceStatus('review', 'processing')).toBe('processing');
    expect(advanceStatus('processing', 'awaiting_payment')).toBe('processing');
    expect(advanceStatus('failed', 'review')).toBe('failed');
  });
});

describe('settings', () => {
  test('AES-GCM is bound to the associated data context', () => {
    Object.assign(cardSettings, { encKey: 'ab'.repeat(32) });
    const blob = encryptCardData('a@b.co', 'spindle:card-profile:u1');
    expect(decryptCardData(blob, 'spindle:card-profile:u1')).toBe('a@b.co');
    expect(() => decryptCardData(blob, 'spindle:card-profile:u2')).toThrow();
    expect(blob).not.toContain('a@b.co');
  });

  test('Relay stub mode is refused in production', () => {
    const prev = { relayMode: cardSettings.relayMode, nodeEnv: cardSettings.nodeEnv };
    try {
      Object.assign(cardSettings, { relayMode: 'stub', nodeEnv: 'production' });
      expect(() => assertRelayModeSafe()).toThrow(/stub/);
      Object.assign(cardSettings, { nodeEnv: 'development' });
      expect(() => assertRelayModeSafe()).not.toThrow();
    } finally {
      Object.assign(cardSettings, prev);
    }
  });

  test('production refuses IZIPAY_MODE=mock and RELAY_MODE=stub (fail fast)', () => {
    const prev = {
      mode: cardSettings.mode,
      relayMode: cardSettings.relayMode,
      nodeEnv: cardSettings.nodeEnv,
    };
    try {
      Object.assign(cardSettings, { nodeEnv: 'production', mode: 'mock', relayMode: 'live' });
      expect(() => assertProductionSafe()).toThrow(/mock/);
      Object.assign(cardSettings, { mode: 'live', relayMode: 'stub' });
      expect(() => assertProductionSafe()).toThrow(/stub/);
      Object.assign(cardSettings, { mode: 'live', relayMode: 'live' });
      expect(() => assertProductionSafe()).not.toThrow();
    } finally {
      Object.assign(cardSettings, prev);
    }
  });
});
