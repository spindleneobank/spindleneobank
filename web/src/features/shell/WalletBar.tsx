import { useAccount, useSwitchChain } from 'wagmi';
import { CTA } from '../../components/CTA';
import { useToast } from '../../components/Toast';
import { chain } from '../../config';

/** Wrong-chain banner: wallet actions stay blocked until the wallet is on Robinhood Chain (4663). */
export function useWrongChain() {
  const { isConnected, chainId } = useAccount();
  return isConnected && chainId !== undefined && chainId !== chain.id;
}

export function WrongChainBanner() {
  const wrong = useWrongChain();
  const { switchChainAsync, isPending } = useSwitchChain();
  const { toast } = useToast();
  if (!wrong) return null;
  return (
    <div className="sd-banner" role="alert">
      <span>Your wallet is on the wrong network. Wallet actions are paused until you switch.</span>
      <CTA
        variant="secondary"
        icon=""
        disabled={isPending}
        onClick={() =>
          void switchChainAsync({ chainId: chain.id }).catch(() =>
            toast('Could not switch network. Switch to Robinhood Chain in your wallet.', 'error'),
          )
        }
      >
        Switch to Robinhood Chain
      </CTA>
    </div>
  );
}

/** Chain status for the crumb bar: ok on 4663, warning otherwise. */
export function ChainStatus() {
  const wrong = useWrongChain();
  return (
    <span className={`sd-chain${wrong ? ' is-wrong' : ''}`}>
      {wrong ? 'Wrong network' : 'Robinhood chain'}
    </span>
  );
}
