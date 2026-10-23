import { PageHead } from '../shell/ui';
import { BalanceDeposit } from './Deposit';
import './developers.css';
import { ApiKeys } from './Keys';
import { Ledger } from './Ledger';
import { Quickstart, RateCardTable } from './Quickstart';
import { Usage } from './Usage';
import { X402Panel } from './X402';

export default function DevelopersTab() {
  return (
    <div className="sd-overview dv">
      <PageHead eyebrow="BUILD ON SPINDLE" line1="Your keys." line2="Verified compute, on demand.">
        Prepaid balance or pay per call with x402. <br />
        OpenAI-compatible, receipts for every job.
      </PageHead>
      <div className="dv-grid">
        <BalanceDeposit />
        <ApiKeys />
        <Usage />
        <Ledger />
        <X402Panel />
        <Quickstart />
        <RateCardTable />
      </div>
    </div>
  );
}
