import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createSIWEConfig } from '@reown/appkit-siwe';
import { SIWE_STATEMENT_LOGIN, SIWE_STATEMENT_REAUTH } from '@spindle/shared/api';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { createSiweMessage } from 'viem/siwe';
import { WagmiProvider } from 'wagmi';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/errors';
import { setSession } from '../api/hooks';
import { chain, env } from '../config';

export const SIGN_IN_STATEMENT = SIWE_STATEMENT_LOGIN;
export const REAUTH_STATEMENT = SIWE_STATEMENT_REAUTH;

let activeQueryClient: QueryClient | undefined;

function QueryClientBridge() {
  const queryClient = useQueryClient();
  useEffect(() => {
    activeQueryClient = queryClient;
    return () => {
      if (activeQueryClient === queryClient) activeQueryClient = undefined;
    };
  }, [queryClient]);
  return null;
}

export const wagmiAdapter = new WagmiAdapter({
  networks: [chain],
  projectId: env.reownProjectId,
  ssr: true,
});

export const siweConfig = createSIWEConfig({
  getMessageParams: async () => ({
    domain: window.location.host,
    uri: window.location.origin,
    chains: [chain.id],
    statement: SIGN_IN_STATEMENT,
  }),
  createMessage: (args) =>
    createSiweMessage({
      domain: args.domain,
      address: args.address.split(':').at(-1) as `0x${string}`,
      uri: args.uri,
      version: '1',
      // the app runs on one chain; the wallet's active network does not change who signs, and txs are gated by the wrong-chain banner
      chainId: chain.id,
      nonce: args.nonce,
      statement: args.statement ?? SIGN_IN_STATEMENT,
      issuedAt: args.iat ? new Date(args.iat) : new Date(),
    }),
  getNonce: async () => (await endpoints.auth.nonce()).nonce,
  verifyMessage: async ({ message, signature }) => {
    try {
      await endpoints.auth.verify(message, signature);
      const session = await endpoints.auth.session();
      if (activeQueryClient) await setSession(activeQueryClient, session);
      return true;
    } catch {
      return false;
    }
  },
  getSession: async () => {
    try {
      const session = await endpoints.auth.session();
      if (activeQueryClient) await setSession(activeQueryClient, session);
      return { address: session.address, chainId: session.chainId };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED' && activeQueryClient) {
        await setSession(activeQueryClient, null);
      }
      return null;
    }
  },
  signOut: async () => {
    try {
      await endpoints.auth.logout();
      if (activeQueryClient) await setSession(activeQueryClient, null);
      return true;
    } catch {
      return false;
    }
  },
  signOutOnDisconnect: true,
  signOutOnAccountChange: false,
  signOutOnNetworkChange: false,
});

const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: [chain],
  defaultNetwork: chain,
  projectId: env.reownProjectId,
  siweConfig,
  metadata: {
    name: 'Spindle',
    description: 'Compute payouts, verified',
    url: env.appUrl,
    icons: [`${env.appUrl}/assets/brand/mark.svg`],
  },
  features: { email: false, socials: false, onramp: false, swaps: false, analytics: false },
  themeMode: 'dark',
  themeVariables: { '--w3m-accent': '#d37f59', '--w3m-border-radius-master': '2px' },
  allowUnsupportedChain: false,
  enableWalletConnect: true,
  enableInjected: true,
  enableEIP6963: true,
  enableCoinbase: true,
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
    '18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1', // Rabby
    'd0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8', // Coinbase Wallet
    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
  ],
});

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientBridge />
      {children}
    </WagmiProvider>
  );
}

export const openConnect = () => modal.open();
export const openAccount = () => modal.open({ view: 'Account' });
