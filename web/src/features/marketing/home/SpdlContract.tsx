import { useState } from 'react';
import { env } from '../../../env';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * $SPDL contract address under the hero buttons. Renders nothing until VITE_SPDL_ADDRESS is set (Vercel public
 * env, read at build time), so the homepage needs a redeploy after the variable changes.
 */
export function SpdlContract() {
  const address = env.addresses.spdl;
  const [copied, setCopied] = useState(false);
  if (!address) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked: the address stays selectable
    }
  };

  return (
    <div className="hm-ca" data-spdl-ca="">
      <span className="hm-ca-label">$SPDL contract</span>
      <code className="hm-ca-addr" title={address}>
        <span className="hm-ca-full">{address}</span>
        <span className="hm-ca-short" aria-hidden="true">
          {short(address)}
        </span>
      </code>
      <button
        type="button"
        className="hm-ca-btn"
        onClick={() => void copy()}
        aria-label={copied ? 'Contract address copied' : 'Copy contract address'}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        className="hm-ca-btn"
        href={`${env.explorerUrl}/token/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View the $SPDL contract on the explorer"
      >
        Explorer
      </a>
      <span className="hm-ca-live" aria-live="polite">
        {copied ? 'Contract address copied' : ''}
      </span>
    </div>
  );
}
