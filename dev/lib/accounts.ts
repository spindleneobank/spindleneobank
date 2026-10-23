import { mnemonicToAccount } from 'viem/accounts';

/** anvil's default mnemonic. DEV ONLY: these keys are public; never use on a real chain. */
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

export const account = (index: number) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });

export const ROLES = {
  deployer: 0, // also admin and house owner
  keeper: 1,
  guardian: 2, // guardian + slasher + treasury
  firstUser: 3,
  lastUser: 9,
} as const;

/** Private key of an anvil account as 0x hex (HD key of the default mnemonic). */
export function privateKey(index: number): `0x${string}` {
  const key = account(index).getHdKey().privateKey;
  if (!key) throw new Error('no private key');
  return `0x${Buffer.from(key).toString('hex')}`;
}

export const ALL_ACCOUNTS = Array.from({ length: 10 }, (_, i) => account(i));
