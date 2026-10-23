import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { Boundary, fmtTime, RowTable } from '../shell/ui';
import { useApiKeys, useCreateKey, useRevokeKey } from './queries';

type KeyRow = NonNullable<ReturnType<typeof useApiKeys>['data']>[number];

/** The key lives only in this component's state while the dialog is open; closing clears it. */
function RevealDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const { toast } = useToast();
  return (
    <Dialog open={secret !== null} onClose={onClose} title="Your new API key">
      <p className="dv-warn" role="alert">
        This key is shown once. Copy it now and store it somewhere safe. We keep only a hash, so it cannot be
        recovered.
      </p>
      <code className="sd-address" data-testid="new-key">
        {secret}
      </code>
      <div className="sd-actions-row">
        <CTA
          icon="copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(secret ?? '')
              .then(() => toast('Key copied', 'ok'))
              .catch(() => toast('Copy failed. Select the key and copy it manually.', 'error'))
          }
        >
          Copy key
        </CTA>
        <CTA variant="secondary" icon="" onClick={onClose}>
          I have saved it
        </CTA>
      </div>
    </Dialog>
  );
}

export function ApiKeys() {
  const keys = useApiKeys();
  const auth = useAuth();
  const { toast } = useToast();
  const create = useCreateKey(auth.withReauth);
  const revoke = useRevokeKey();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<KeyRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    const n = name.trim();
    if (!n) return setFormError('Give the key a name.');
    if (n.length > 64) return setFormError('Name must be 64 characters or fewer.');
    setFormError(null);
    create.mutate(n, {
      onSuccess: (r) => {
        setSecret(r.key);
        setName('');
      },
      onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not create the key.'),
    });
  };

  return (
    <section className="sd-box dv-keys">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">OPENAI-COMPATIBLE</span>
          <h2>API keys</h2>
        </div>
      </div>
      <form
        className="dv-inline"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="dv-input">
          <span className="sd-label">Key name</span>
          <input
            value={name}
            maxLength={64}
            placeholder="e.g. production backend"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!formError}
          />
        </label>
        <CTA type="submit" icon="" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create key'}
        </CTA>
      </form>
      {formError ? (
        <p className="dv-error" role="alert">
          {formError}
        </p>
      ) : null}
      <Boundary query={keys} title="API keys" skeleton={<Skeleton height={120} />}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon="code" title="No API keys yet">
              Create a key to call the OpenAI-compatible API with your credit balance.
            </EmptyState>
          ) : (
            <RowTable
              caption="API keys"
              rows={list}
              rowKey={(k) => k.id}
              template="1.2fr 1.3fr 1fr 1fr 110px"
              cols={[
                { key: 'name', header: 'Name', render: (k) => <strong>{k.name || 'Unnamed'}</strong> },
                { key: 'prefix', header: 'Key', render: (k) => <code>{k.prefix}…</code> },
                { key: 'created', header: 'Created', render: (k) => fmtTime(k.createdAt) },
                {
                  key: 'used',
                  header: 'Last used',
                  render: (k) => (k.lastUsedAt ? fmtTime(k.lastUsedAt) : 'Never'),
                },
                {
                  key: 'state',
                  header: 'Status',
                  align: 'right',
                  render: (k) =>
                    k.revokedAt ? (
                      <StatusPill tone="danger">Revoked</StatusPill>
                    ) : (
                      <span className="dv-key-actions">
                        <StatusPill tone="ok">Active</StatusPill>
                        <button type="button" className="sd-link" onClick={() => setConfirm(k)}>
                          Revoke
                        </button>
                      </span>
                    ),
                },
              ]}
            />
          )
        }
      </Boundary>
      <RevealDialog secret={secret} onClose={() => setSecret(null)} />
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title="Revoke this key?">
        <p>
          <strong>{confirm?.name}</strong> ({confirm?.prefix}…) will stop working immediately. This cannot be
          undone.
        </p>
        <div className="sd-actions-row">
          <CTA
            icon=""
            disabled={revoke.isPending}
            onClick={() =>
              confirm &&
              revoke.mutate(confirm.id, {
                onSuccess: () => {
                  toast('Key revoked', 'ok');
                  setConfirm(null);
                },
                onError: () => toast('Could not revoke the key. Try again.', 'error'),
              })
            }
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke key'}
          </CTA>
          <CTA variant="secondary" icon="" onClick={() => setConfirm(null)}>
            Cancel
          </CTA>
        </div>
      </Dialog>
    </section>
  );
}
