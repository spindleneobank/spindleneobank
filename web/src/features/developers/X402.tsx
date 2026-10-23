import { maxUint256 } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { TxButton } from '../../components/TxButton';
import { env } from '../../config';
import { Boundary } from '../shell/ui';
import { erc20Abi } from './abi';
import { useBuyer } from './queries';

export function X402Panel() {
  const buyer = useBuyer();
  const { address } = useAccount();
  const allowance = useReadContract({
    address: env.addresses.usdg,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, env.addresses.permit2] : undefined,
    query: { enabled: !!address },
  });
  // In mock mode there is no chain to read, so show the step to review the UI.
  const needsPermit2 = allowance.data === 0n || (env.mock && allowance.data === undefined);
  return (
    <section className="sd-box dv-x402">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">PAY PER CALL</span>
          <h2>x402 payments</h2>
        </div>
      </div>
      <Boundary query={buyer} title="x402 status" skeleton={<Skeleton height={100} />}>
        {(b) => (
          <>
            <div className="dv-x402-head">
              <StatusPill tone={b.x402.enabled ? 'ok' : 'warn'}>
                {b.x402.enabled ? 'Available' : 'Unavailable'}
              </StatusPill>
              <span>
                Surcharge per settlement <Money micros={b.x402.currentSurchargeMicros} fractionDigits={4} />
                <small>
                  {' '}
                  (minimum <Money micros={b.x402.minSurchargeMicros} fractionDigits={4} />)
                </small>
              </span>
            </div>
            {b.x402.enabled ? null : (
              <p className="dv-warn" role="status">
                x402 temporarily unavailable — use an API key with credit balance.
              </p>
            )}
          </>
        )}
      </Boundary>
      <ul className="dv-list">
        <li>
          <strong>Exact.</strong> Each request signs a cap (maximum charge plus surcharge). You are charged
          the actual usage, never more than the cap. The surcharge covers on-chain settlement gas.
        </li>
        <li>
          <strong>Session.</strong> Sign once for a spending cap and time limit, then make many calls with a
          session token. The surcharge is charged once per session.
        </li>
        <li>No credit balance is needed; the payment is a signed Permit2 transfer settled in batches.</li>
      </ul>
      {needsPermit2 ? (
        <div className="dv-permit">
          <p>
            One-time setup: x402 payments move USDG through Permit2. Approving the maximum amount lets Permit2
            pull USDG only for payments you sign; each payment is capped by your signature. You can revoke it
            any time from your wallet.
          </p>
          <TxButton
            label="Approve USDG for Permit2 (max)"
            variant="secondary"
            disabled={!address}
            request={{
              address: env.addresses.usdg,
              abi: erc20Abi,
              functionName: 'approve',
              args: [env.addresses.permit2, maxUint256],
            }}
            onConfirmed={() => void allowance.refetch()}
          />
        </div>
      ) : null}
    </section>
  );
}
