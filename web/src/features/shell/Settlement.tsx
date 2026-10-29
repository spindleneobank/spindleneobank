import { Money } from '../../components/Money';
import { countdown, useNow } from './ui';
import type { useSummary } from './queries';

type Summary = NonNullable<ReturnType<typeof useSummary>['data']>;

const CLAIM_DELAY_MS = 3_600_000;
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

/** When each part of the earnings becomes claimable: now, after the claim delay, after the next root. */
export function settlementStages(s: Summary, now: number) {
  const unlockAt = s.claimableAt ? Date.parse(s.claimableAt) : null;
  const rootAt = s.nextRootAt ? Date.parse(s.nextRootAt) : null;
  const stages: { key: string; label: string; micros: string; when: string }[] = [
    { key: 'claimable', label: 'Claimable now', micros: s.claimableMicros, when: 'Ready to claim to your wallet' },
  ];
  if (BigInt(s.unlockingMicros) > 0n) {
    const left = s.claimableAt ? countdown(s.claimableAt, now) : null;
    stages.push({
      key: 'unlocking',
      label: 'Unlocking',
      micros: s.unlockingMicros,
      when:
        unlockAt && left
          ? `In a posted root · claimable at ${clock(unlockAt)} (in ${left})`
          : 'In a posted root · claimable any moment',
    });
  }
  if (BigInt(s.awaitingRootMicros) > 0n) {
    const left = s.nextRootAt ? countdown(s.nextRootAt, now) : null;
    stages.push({
      key: 'awaiting',
      label: 'Waiting for next root',
      micros: s.awaitingRootMicros,
      when:
        rootAt && left
          ? `Next root at ${clock(rootAt)} (in ${left}) · claimable from ${clock(rootAt + CLAIM_DELAY_MS)}`
          : 'Root is being posted now · claimable about 1h after it lands',
    });
  }
  return stages;
}

/** Claimable / unlocking / waiting-for-root rows with live countdowns. */
export function SettlementStages({ s, compact }: { s: Summary; compact?: boolean }) {
  const now = useNow();
  return (
    <ul className="sd-stages" data-compact={compact || undefined}>
      {settlementStages(s, now).map((st) => (
        <li key={st.key} data-stage={st.key}>
          <i aria-hidden="true" />
          <span className="sd-stage-label">{st.label}</span>
          <strong>
            <Money micros={st.micros} exact />
          </strong>
          <small>{st.when}</small>
        </li>
      ))}
    </ul>
  );
}
