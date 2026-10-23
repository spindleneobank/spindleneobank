import { useState } from 'react';
import { useMe } from '../../api/hooks';
import { useAuth } from '../../auth/useAuth';
import { CardFace, CardFinishPicker } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { chain } from '../../config';
import { useSavePrefs } from '../shell/queries';
import { Panel } from '../shell/ui';

const LS_KEYS = ['spindle:tab', 'spindle:card-finish', 'spindle:chat-history'];
const AFTER = [
  ['keep', 'Keep in wallet'],
  ['card', 'Fund my card'],
  ['stock', 'Swap to stock'],
] as const;

export default function SettingsTab() {
  const auth = useAuth();
  const me = useMe();
  const save = useSavePrefs();
  const { toast } = useToast();
  const [finishLocal, setFinishLocal] = useState<string | null>(null);

  const update = (prefs: Parameters<typeof save.mutate>[0]) =>
    save.mutate(prefs, { onError: () => toast('Could not save. Your change was reverted.', 'error') });

  return (
    <div className="sd-overview">
      <h1>Settings</h1>
      <Panel title="Wallet">
        <dl className="sd-kv sd-kv-col">
          <div>
            <dt>Address</dt>
            <dd>
              <code>{auth.session?.address ?? 'none'}</code>
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>
              {chain.name} ({chain.id})
            </dd>
          </div>
        </dl>
        <div className="sd-actions-row">
          <CTA variant="secondary" icon="logout" onClick={() => void auth.signOut()}>
            Sign out
          </CTA>
        </div>
      </Panel>
      <Panel title="Preferences">
        {me.isPending ? <Skeleton height={160} /> : null}
        {me.isError ? (
          <ErrorState
            title="Preferences unavailable"
            message={me.error.message}
            onRetry={() => void me.refetch()}
          />
        ) : null}
        {me.data ? (
          <>
            <fieldset className="sd-field">
              <legend>After a claim</legend>
              <div className="sd-seg" role="radiogroup" aria-label="After a claim">
                {AFTER.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={(me.data.prefs.afterClaim ?? 'keep') === v}
                    onClick={() => update({ afterClaim: v })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="sd-check">
              <input
                type="checkbox"
                checked={me.data.prefs.notifications ?? false}
                onChange={(e) => update({ notifications: e.target.checked })}
              />
              <span>Email me about claims and card activity</span>
            </label>
            <div className="sd-field">
              <span>Card finish preview</span>
              <div className="sd-finish">
                <CardFace finish={finishLocal ?? me.data.prefs.cardFinish ?? 'orchid'} decorative />
                <CardFinishPicker
                  value={finishLocal ?? me.data.prefs.cardFinish ?? 'orchid'}
                  onChange={(k) => {
                    setFinishLocal(k);
                    update({ cardFinish: k });
                  }}
                />
              </div>
            </div>
          </>
        ) : null}
        <div className="sd-actions-row">
          <CTA
            variant="ghost"
            icon=""
            onClick={() => {
              try {
                for (const k of LS_KEYS) localStorage.removeItem(k);
              } catch {
                // storage unavailable: nothing to clear
              }
              setFinishLocal(null);
              toast('Local UI settings cleared', 'ok');
            }}
          >
            Reset local UI settings
          </CTA>
        </div>
      </Panel>
    </div>
  );
}
