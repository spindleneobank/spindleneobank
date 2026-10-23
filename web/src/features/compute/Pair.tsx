import { useState } from 'react';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { isPairCode, normalizePairCode } from './format';
import { usePair } from './queries';

export function PairForm({
  initial = '',
  onPaired,
  inputId,
}: {
  initial?: string;
  inputId: string;
  onPaired: (nodeId: string, name: string) => void;
}) {
  const [code, setCode] = useState(normalizePairCode(initial));
  const pair = usePair();
  const { toast } = useToast();
  const valid = isPairCode(code);
  const submit = () =>
    pair.mutate(code, {
      onSuccess: ({ node }) => {
        toast(`Paired ${node.name}`, 'ok');
        setCode('');
        onPaired(node.id, node.name);
      },
    });
  return (
    <form
      className="cp-pair-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !pair.isPending) submit();
      }}
    >
      <label htmlFor={inputId} className="cp-ctl-label">
        Pairing code shown by the node
      </label>
      <div className="cp-pair-row">
        <input
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          value={code}
          onChange={(e) => {
            pair.reset();
            setCode(normalizePairCode(e.target.value));
          }}
        />
        <CTA icon="check" type="submit" disabled={!valid || pair.isPending}>
          {pair.isPending ? 'Approving…' : 'Approve'}
        </CTA>
      </div>
      {pair.isError ? (
        <p className="cp-error" role="alert">
          {pair.error.message}
        </p>
      ) : null}
    </form>
  );
}

export function PairBox({ onPaired }: { onPaired: (id: string, name: string) => void }) {
  return (
    <section className="sd-box sd-flat cp-pair" aria-labelledby="cp-pair-h">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">STEP 2</span>
          <h2 id="cp-pair-h">Enter pairing code</h2>
        </div>
      </div>
      <p className="cp-hint">
        Started a node without a token? It prints a short code. Approve it here to attach the node to your
        account.
      </p>
      <PairForm inputId="cp-pair-code" onPaired={onPaired} />
    </section>
  );
}

export function PairDialog({
  code,
  onClose,
  onPaired,
}: {
  code: string | null;
  onClose: () => void;
  onPaired: (id: string, name: string) => void;
}) {
  return (
    <Dialog open={code !== null} onClose={onClose} title="Approve this node?">
      <div className="cp-wide">
        {code !== null ? (
          <>
            <p className="cp-hint">
              A node asked to join your account with this code. Only approve it if you started that node
              yourself.
            </p>
            <PairForm
              inputId="cp-pair-dialog-code"
              initial={code}
              onPaired={(id, name) => {
                onPaired(id, name);
                onClose();
              }}
            />
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
