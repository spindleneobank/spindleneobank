import type { NodeView } from '@spindle/shared/api';
import { useEffect, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ErrorState } from '../../components/ErrorState';
import { countdown, useNow } from '../shell/ui';
import { CodeBlock } from './Install';
import { useUpdateCommand } from './queries';

/** "Update node": issues a short-lived token and shows the re-install command (keeps the node key and volume). */
export function UpdateNode({ node }: { node: NodeView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="cp-link-btn"
        aria-label={`Update ${node.name}`}
        onClick={() => setOpen(true)}
      >
        Update node
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Update node">
        {open ? <UpdatePanel node={node} /> : null}
      </Dialog>
    </>
  );
}

function UpdatePanel({ node }: { node: NodeView }) {
  const [os, setOs] = useState<'sh' | 'ps'>('sh');
  const upd = useUpdateCommand();
  const now = useNow(1000);
  // one token per opening of the dialog
  useEffect(() => upd.mutate(node.id), []);
  const res = upd.data;
  const left = res ? countdown(res.expiresAt, now) : null;
  return (
    <div className="cp-wide">
      <p className="cp-hint">
        Run this on the machine where {node.name} runs. It downloads the latest Spindle agent, rebuilds the
        node image locally and replaces the container. The node keeps its identity and data.
      </p>
      <div className="sd-seg" role="group" aria-label="Shell">
        <button type="button" aria-pressed={os === 'sh'} onClick={() => setOs('sh')}>
          Linux / macOS
        </button>
        <button type="button" aria-pressed={os === 'ps'} onClick={() => setOs('ps')}>
          Windows
        </button>
      </div>
      {upd.isPending ? <p className="cp-hint">Generating…</p> : null}
      {upd.isError ? (
        <ErrorState
          title="Could not create an update command"
          message={upd.error.message}
          onRetry={() => upd.mutate(node.id)}
        />
      ) : null}
      {res ? (
        <>
          <CodeBlock
            label={os === 'ps' ? 'PowerShell' : 'Terminal'}
            code={os === 'ps' ? res.commands.powershell : res.commands.installer}
          />
          <p className="cp-expiry" data-expired={left ? undefined : 'true'} role="status">
            {left ? `This command expires in ${left}.` : 'This command has expired. Close and try again.'}
          </p>
        </>
      ) : null}
    </div>
  );
}
