import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Address, Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export interface NodeKey {
  privateKey: Hex;
  address: Address;
  /** uncompressed public key, 0x04... */
  publicKey: Hex;
  createdAt: string;
  account: PrivateKeyAccount;
}

export const KEY_FILE = 'node-key.json';

function toNodeKey(privateKey: Hex, createdAt: string): NodeKey {
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address, publicKey: account.publicKey, createdAt, account };
}

/** The key never appears in logs or JSON output: keep it non-enumerable-safe via toJSON. */
function hide(k: NodeKey): NodeKey {
  Object.defineProperty(k, 'toJSON', { value: () => ({ address: k.address }), enumerable: false });
  return k;
}

export async function loadOrCreateKey(dir: string): Promise<NodeKey> {
  const file = join(dir, KEY_FILE);
  let existing = false;
  try {
    const st = await stat(file);
    existing = st.isFile();
    if (existing && (st.mode & 0o077) !== 0) {
      throw new Error(
        `${file} is readable by group/others (mode ${(st.mode & 0o777).toString(8)}); run: chmod 600 ${file}`,
      );
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (existing) {
    const j = JSON.parse(await readFile(file, 'utf8')) as { privateKey?: string; createdAt?: string };
    if (!j.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(j.privateKey))
      throw new Error(`${file}: invalid privateKey`);
    return hide(toNodeKey(j.privateKey as Hex, j.createdAt ?? new Date(0).toISOString()));
  }
  await mkdir(dir, { recursive: true });
  const key = toNodeKey(generatePrivateKey(), new Date().toISOString());
  const body = JSON.stringify(
    { privateKey: key.privateKey, address: key.address, publicKey: key.publicKey, createdAt: key.createdAt },
    null,
    2,
  );
  await writeFile(file, body, { mode: 0o600, flag: 'wx' });
  await chmod(file, 0o600);
  return hide(key);
}
