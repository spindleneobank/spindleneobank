import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { alertSettings, sendAlert } from './alerts';
import { closeRedis, getRedis } from './redis';

const saved = { ...alertSettings };
let sent: { url: string; body: string }[] = [];
const key = () => `test-${crypto.randomUUID()}`;

beforeEach(() => {
  sent = [];
  alertSettings.url = 'https://hooks.test/x';
  alertSettings.fetch = async (url, init) => {
    sent.push({ url, body: String(init.body) });
    return new Response('ok');
  };
});
afterEach(() => Object.assign(alertSettings, saved));
afterAll(closeRedis);

test('posts once per key per window', async () => {
  const k = key();
  expect(await sendAlert(k, 'critical', 'root mismatch', { epoch: '5' })).toBe(true);
  expect(await sendAlert(k, 'critical', 'root mismatch', { epoch: '5' })).toBe(false);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]?.body as string).text).toContain('root mismatch');
  await getRedis().del(`alert:${k}`);
  expect(await sendAlert(k, 'critical', 'root mismatch')).toBe(true);
});

test('without a webhook it only logs', async () => {
  alertSettings.url = '';
  expect(await sendAlert(key(), 'warning', 'x')).toBe(false);
  expect(sent).toHaveLength(0);
});

test('a failing webhook never throws into the caller', async () => {
  alertSettings.fetch = async () => {
    throw new Error('down');
  };
  expect(await sendAlert(key(), 'critical', 'x')).toBe(false);
  alertSettings.fetch = async () => new Response('no', { status: 500 });
  expect(await sendAlert(key(), 'critical', 'x')).toBe(false);
});
