/**
 * Push alerts for things a person must act on, sent to `ALERT_WEBHOOK_URL` (Slack and Discord accept the same
 * `text`/`content` body). Everything is also logged, and a failed send never affects the caller. One alert per key
 * per hour, so a retrying job cannot flood the channel.
 */
import { config } from '../config';
import { logger } from './logger';
import { getRedis } from './redis';

export const alertSettings = {
  url: config.ALERT_WEBHOOK_URL,
  repeatSec: 3600,
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

export type AlertLevel = 'warning' | 'critical';

/** `key` decides what counts as the same alert. Details must not hold secrets or buyer content. */
export async function sendAlert(
  key: string,
  level: AlertLevel,
  message: string,
  details: Record<string, unknown> = {},
): Promise<boolean> {
  const line = { alert: key, ...details };
  if (level === 'critical') logger.error(line, message);
  else logger.warn(line, message);
  if (!alertSettings.url) return false;
  try {
    const first = await getRedis().set(`alert:${key}`, '1', 'EX', alertSettings.repeatSec, 'NX');
    if (first !== 'OK') return false;
    const text = `[spindle ${level}] ${message}\n${JSON.stringify(details)}`;
    const res = await alertSettings.fetch(alertSettings.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    return true;
  } catch (err) {
    logger.error({ err: String(err), alert: key }, 'could not deliver alert');
    return false;
  }
}
