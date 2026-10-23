import { describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateKey } from '../src/key';

const tmp = () => mkdtemp(join(tmpdir(), 'spindle-key-'));

describe('node key', () => {
  test('creates with mode 0600 and reloads the same key', async () => {
    const dir = await tmp();
    const a = await loadOrCreateKey(dir);
    const st = await stat(join(dir, 'node-key.json'));
    expect(st.mode & 0o777).toBe(0o600);
    const file = JSON.parse(await readFile(join(dir, 'node-key.json'), 'utf8'));
    expect(Object.keys(file).sort()).toEqual(['address', 'createdAt', 'privateKey', 'publicKey']);
    expect(file.address).toBe(a.address);
    expect(a.publicKey.startsWith('0x04')).toBe(true);
    const b = await loadOrCreateKey(dir);
    expect(b.address).toBe(a.address);
    expect(b.privateKey).toBe(a.privateKey);
  });

  test('refuses group/world readable key file', async () => {
    const dir = await tmp();
    await loadOrCreateKey(dir);
    await chmod(join(dir, 'node-key.json'), 0o644);
    await expect(loadOrCreateKey(dir)).rejects.toThrow(/readable by group/);
  });

  test('rejects corrupt file', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'node-key.json'), '{"privateKey":"nope"}', { mode: 0o600 });
    await expect(loadOrCreateKey(dir)).rejects.toThrow(/invalid privateKey/);
  });

  test('private key is not serialized by JSON.stringify', async () => {
    const k = await loadOrCreateKey(await tmp());
    expect(JSON.stringify(k)).not.toContain(k.privateKey);
  });
});
