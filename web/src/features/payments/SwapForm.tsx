import { erc20Abi, swapRouter02Abi } from '@spindle/shared/abi';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';
import { ApiError } from '../../api/errors';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { formatMicros } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { TxButton } from '../../components/TxButton';
import { explorerTx } from '../../config';
import { useUsdgBalance } from '../card-funding/api';
import { formatUnitsTrim, parseAmount, reviveArgs } from '../card-funding/lib';
import { Boundary, useNow } from '../shell/ui';
import { useDebounced, useStockQuote, useStocks } from './queries';

export const STOCK_DISCLOSURE =
  'Stock Tokens are debt instruments with no shareholder rights; not available to US/UK/CA/CH persons.';

type Stock = { address: string; symbol: string; name: string; decimals: number; poolFee: number };

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

function Body({
  stocks,
  initialToken,
  initialAmount,
  locked,
  onSwapped,
}: {
  stocks: Stock[];
  initialToken?: string;
  initialAmount?: string;
  locked?: boolean;
  onSwapped?: (hash: `0x${string}`) => void;
}) {
  const qc = useQueryClient();
  const now = useNow();
  const bal = useUsdgBalance();
  const [tokenAddr, setTokenAddr] = useState(
    stocks.find((s) => s.address.toLowerCase() === initialToken?.toLowerCase())?.address ??
      stocks[0]?.address ??
      '',
  );
  const token = stocks.find((s) => s.address === tokenAddr);
  const [text, setText] = useState(initialAmount ?? '');
  const [ack, setAck] = useState(false);
  const [approvedFor, setApprovedFor] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: `0x${string}` } | null>(null);

  const micros = parseAmount(text, 6);
  const debounced = useDebounced(micros, 500);
  const insufficient = micros !== null && bal.data !== undefined && micros > bal.data;
  const settled = micros !== null && debounced === micros;
  const quoteQ = useStockQuote(
    token?.address,
    settled && !insufficient && !done && bal.connected ? debounced : null,
  );
  const q = quoteQ.data;
  useEffect(() => setAck(false), [q?.quotedAt]);

  const tokenBal = useReadContract({
    address: token?.address as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: bal.address ? [bal.address] : undefined,
    query: { enabled: !!token && !!bal.address },
  });

  const qKey = `${tokenAddr}:${debounced?.toString() ?? ''}`;
  const approved = !q?.approve || approvedFor === qKey;
  const expired = q ? Date.parse(q.expiresAt) <= now : false;
  const needAck = !!q?.warnImpact;
  const quoteErr = quoteQ.error instanceof ApiError ? quoteQ.error : null;

  if (done && token) {
    return (
      <div className="sd-done" role="status">
        <strong>
          Swap confirmed. You now hold{' '}
          {tokenBal.data === undefined
            ? '…'
            : `${formatUnitsTrim(tokenBal.data, token.decimals)} ${token.symbol}`}
        </strong>
        <a className="sp-tx-link" href={explorerTx(done.hash)} target="_blank" rel="noreferrer noopener">
          View transaction
        </a>
        {locked ? null : (
          <CTA
            variant="secondary"
            icon=""
            onClick={() => {
              setDone(null);
              setText('');
              setApprovedFor(null);
            }}
          >
            Swap again
          </CTA>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="sd-sub">
        Wallet USDG:{' '}
        <strong>
          {!bal.connected
            ? 'connect your wallet'
            : bal.data === undefined
              ? '…'
              : `${formatMicros(bal.data)} USDG`}
        </strong>
        {token && tokenBal.data !== undefined ? (
          <>
            {' · '}
            {token.symbol}: {formatUnitsTrim(tokenBal.data, token.decimals)}
          </>
        ) : null}
      </p>
      <fieldset className="sd-field">
        <legend>Stock Token</legend>
        <div className="sd-seg" role="radiogroup" aria-label="Stock Token">
          {stocks.map((s) => (
            <button
              key={s.address}
              type="button"
              role="radio"
              aria-checked={s.address === tokenAddr}
              disabled={locked && s.address !== tokenAddr}
              onClick={() => setTokenAddr(s.address)}
              title={s.name}
            >
              {s.symbol}
            </button>
          ))}
        </div>
        {token ? <small className="sd-sub">{token.name}</small> : null}
      </fieldset>
      <div className="sd-field">
        <label htmlFor="swap-amount">Spend (USDG)</label>
        <div className="sd-amount-row">
          <input
            id="swap-amount"
            className="sd-input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={text}
            readOnly={locked}
            onChange={(e) => setText(e.target.value)}
          />
          {!locked && bal.data !== undefined ? (
            <button
              type="button"
              className="sd-link"
              onClick={() => setText(formatUnitsTrim(bal.data ?? 0n, 6).replaceAll(',', ''))}
            >
              Max
            </button>
          ) : null}
        </div>
      </div>
      {text !== '' && micros === null ? (
        <p className="sd-warn">Enter an amount with up to 6 decimals.</p>
      ) : null}
      {!bal.connected ? <p className="sd-warn">Connect your wallet to get a quote.</p> : null}
      {insufficient ? (
        <p className="sd-warn" role="alert">
          Not enough USDG in your wallet. You have {formatMicros(bal.data ?? 0n)} USDG.
        </p>
      ) : null}

      {quoteQ.isFetching || (micros !== null && !settled && bal.connected && !insufficient) ? (
        <Skeleton height={96} />
      ) : null}
      {quoteQ.isError && !quoteQ.isFetching ? (
        <p className="sd-warn" role="alert">
          {quoteErr?.code === 'INSUFFICIENT_LIQUIDITY'
            ? 'Not enough liquidity for this size right now. Try a smaller amount or keep USDG.'
            : `Could not get a quote. ${quoteQ.error instanceof Error ? quoteQ.error.message : ''}`}{' '}
          <button type="button" className="sd-link" onClick={() => void quoteQ.refetch()}>
            Retry
          </button>
        </p>
      ) : null}

      {q && token && !quoteQ.isFetching ? (
        <div className="sd-quote">
          <dl className="sd-kv">
            <div>
              <dt>You receive (est.)</dt>
              <dd>
                {formatUnitsTrim(BigInt(q.amountOut), token.decimals)} {token.symbol}
              </dd>
            </div>
            <div>
              <dt>Minimum received</dt>
              <dd>
                {formatUnitsTrim(BigInt(q.minOut), token.decimals)} {token.symbol}
              </dd>
            </div>
            <div>
              <dt>Price impact</dt>
              <dd data-warn={q.warnImpact}>{pct(q.priceImpactBps)}</dd>
            </div>
            <div>
              <dt>Pool fee (separate)</dt>
              <dd>{pct(q.feeBps)}</dd>
            </div>
          </dl>
          {q.warnImpact ? (
            <div className="sd-warn" role="alert">
              <strong>High price impact.</strong> This size moves the pool price by more than 2%. Consider a
              smaller amount or keeping USDG.
              <label className="sd-check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand and want to swap anyway</span>
              </label>
            </div>
          ) : null}
          {expired ? (
            <div className="sd-warn" role="status">
              This quote expired before signing.{' '}
              <button type="button" className="sd-link" onClick={() => void quoteQ.refetch()}>
                Refresh quote
              </button>
            </div>
          ) : (
            <div className="sd-tx-row">
              {q.approve && !approved ? (
                <TxButton
                  label="1. Approve USDG"
                  request={{
                    address: q.approve.to as `0x${string}`,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: reviveArgs(erc20Abi, 'approve', q.approve.args),
                  }}
                  disabled={needAck && !ack}
                  onConfirmed={() => setApprovedFor(qKey)}
                />
              ) : null}
              <TxButton
                label={`${q.approve ? '2. ' : ''}Swap for ${token.symbol}`}
                request={{
                  address: q.swap.to as `0x${string}`,
                  abi: swapRouter02Abi,
                  functionName: q.swap.functionName,
                  args: reviveArgs(swapRouter02Abi, q.swap.functionName, q.swap.args),
                }}
                disabled={!approved || (needAck && !ack)}
                onConfirmed={(r) => {
                  setDone({ hash: r.transactionHash });
                  void qc.invalidateQueries({ queryKey: ['readContract'] });
                  void tokenBal.refetch();
                  void bal.refetch();
                  onSwapped?.(r.transactionHash);
                }}
              />
            </div>
          )}
        </div>
      ) : null}
      <p className="sd-sub sd-disclosure">{STOCK_DISCLOSURE}</p>
    </>
  );
}

export function SwapForm(props: {
  initialToken?: string;
  initialAmount?: string;
  locked?: boolean;
  onSwapped?: (hash: `0x${string}`) => void;
}) {
  const stocks = useStocks();
  return (
    <Boundary query={stocks} title="Stock Tokens" skeleton={<Skeleton height={220} />}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState icon="swap" title="No Stock Tokens available">
            No Stock Tokens are enabled right now. Your USDG stays safely in your wallet.
          </EmptyState>
        ) : (
          <Body stocks={list} {...props} />
        )
      }
    </Boundary>
  );
}
