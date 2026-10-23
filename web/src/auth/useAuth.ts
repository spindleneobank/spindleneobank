import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createSiweMessage } from 'viem/siwe';
import { useAccount, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { withReauth as retryWithReauth } from '../api/client';
import { endpoints } from '../api/endpoints';
import { qk, setSession, useSession } from '../api/hooks';
import { chain } from '../config';
import { openConnect, REAUTH_STATEMENT } from '../wallet/appkit';

export type AuthStatus = 'loading' | 'error' | 'signed-out' | 'signed-in' | 'mismatch';

export function useAuth() {
  const queryClient = useQueryClient();
  const session = useSession();
  const account = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const me = session.data ?? null;
  const address = account.isConnected ? account.address : undefined;

  const signOut = useCallback(async () => {
    await endpoints.auth.logout();
    await setSession(queryClient, null);
    if (account.isConnected) await disconnectAsync();
  }, [account.isConnected, disconnectAsync, queryClient]);

  const signIn = useCallback(() => {
    void openConnect();
  }, []);

  const reauth = useCallback(async () => {
    if (!me || !address || address.toLowerCase() !== me.address.toLowerCase()) {
      throw new Error('Connect the wallet linked to your Spindle session before confirming.');
    }
    if (account.chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
    const { nonce } = await endpoints.auth.nonce();
    const message = createSiweMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      version: '1',
      chainId: chain.id,
      nonce,
      issuedAt: new Date(),
      statement: REAUTH_STATEMENT,
    });
    const signature = await signMessageAsync({ message });
    await endpoints.auth.reauth(message, signature);
    await queryClient.invalidateQueries({ queryKey: qk.session });
  }, [account.chainId, address, me, queryClient, signMessageAsync, switchChainAsync]);

  const withReauth = useCallback(<T>(fn: () => Promise<T>) => retryWithReauth(fn, reauth), [reauth]);

  const status: AuthStatus = session.isPending
    ? 'loading'
    : session.isError
      ? 'error'
      : !me
        ? 'signed-out'
        : address && address.toLowerCase() !== me.address.toLowerCase()
          ? 'mismatch'
          : 'signed-in';

  return {
    status,
    session: me,
    error: session.error instanceof Error ? session.error : null,
    address,
    retrySession: async () => {
      await session.refetch();
    },
    signIn,
    signOut,
    reauth,
    withReauth,
  };
}
