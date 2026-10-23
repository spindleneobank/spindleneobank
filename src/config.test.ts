import { expect, test } from 'bun:test';
import { ConfigError, loadConfig } from './config';

test('defaults load', () => {
  const { config, secrets } = loadConfig({});
  expect(config.PORT).toBe(8080);
  expect(config.CHAIN_ID).toBe(4663);
  expect(config.EPOCH_SECONDS).toBe(3600);
  expect(config.ROLE).toBe('api');
  expect('KEEPER_PRIVATE_KEY' in config).toBe(false);
  expect(secrets.ALCHEMY_API_KEYS).toEqual([]);
});

test('invalid values report names only', () => {
  const bad = 'SUPERSECRETVALUE';
  try {
    loadConfig({ PORT: bad, USDG_ADDRESS: '0xABC', ROLE: 'x' });
    throw new Error('should fail');
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    const msg = (e as Error).message;
    expect(msg).toContain('PORT');
    expect(msg).toContain('USDG_ADDRESS');
    expect(msg).toContain('ROLE');
    expect(msg).not.toContain(bad);
    expect(msg).not.toContain('0xABC');
  }
});

test('csv and booleans', () => {
  const { config } = loadConfig({ CORS_ORIGINS: 'a, b,,c', COOKIE_SECURE: 'true' });
  expect(config.CORS_ORIGINS).toEqual(['a', 'b', 'c']);
  expect(config.COOKIE_SECURE).toBe(true);
});
