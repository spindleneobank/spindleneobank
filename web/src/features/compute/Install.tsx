import { useState } from 'react';
import { CTA } from '../../components/CTA';
import { ErrorState } from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { countdown, useNow } from '../shell/ui';
import { type EngineId, engineAllowed, type NodeOsId } from './format';
import { useEnroll } from './queries';

const OS: [NodeOsId, string][] = [
  ['linux', 'Linux'],
  ['windows', 'Windows (WSL2)'],
  ['macos', 'macOS'],
];

export function CodeBlock({ label, code }: { label: string; code: string }) {
  const { toast } = useToast();
  return (
    <div className="cp-code">
      <div className="cp-code-top">
        <span>{label}</span>
        <CTA
          variant="ghost"
          icon="copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(code)
              .then(() => toast(`${label} command copied`, 'ok'))
              .catch(() => toast('Copy failed. Select the text and copy it manually.', 'error'))
          }
        >
          Copy
        </CTA>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function InstallPanel() {
  const [os, setOs] = useState<NodeOsId>('linux');
  const [engine, setEngine] = useState<EngineId>('ollama');
  const [name, setName] = useState('');
  const enroll = useEnroll();
  const now = useNow(1000);
  const res = enroll.data;
  const left = res ? countdown(res.expiresAt, now) : null;

  const pickOs = (v: NodeOsId) => {
    setOs(v);
    if (!engineAllowed(v, engine)) setEngine('ollama');
    enroll.reset();
  };
  const pickEngine = (v: EngineId) => {
    setEngine(v);
    enroll.reset();
  };
  const generate = () => enroll.mutate({ os, engine, ...(name.trim() ? { name: name.trim() } : {}) });

  return (
    <section className="sd-box sd-flat cp-install" aria-labelledby="cp-install-h">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">STEP 1</span>
          <h2 id="cp-install-h">Install the node</h2>
        </div>
      </div>
      <div className="cp-controls">
        <div className="cp-ctl">
          <span className="cp-ctl-label" id="cp-os">
            Operating system
          </span>
          <div className="sd-seg" role="group" aria-labelledby="cp-os">
            {OS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={os === id} onClick={() => pickOs(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="cp-ctl">
          <span className="cp-ctl-label" id="cp-engine">
            Inference engine
          </span>
          <div className="sd-seg" role="group" aria-labelledby="cp-engine">
            <button type="button" aria-pressed={engine === 'ollama'} onClick={() => pickEngine('ollama')}>
              Ollama
            </button>
            <button
              type="button"
              aria-pressed={engine === 'vllm'}
              disabled={!engineAllowed(os, 'vllm')}
              onClick={() => pickEngine('vllm')}
            >
              vLLM
            </button>
          </div>
          {!engineAllowed(os, 'vllm') ? (
            <small className="cp-hint">vLLM: NVIDIA 24 GB+ only</small>
          ) : (
            <small className="cp-hint">vLLM needs an NVIDIA GPU with 24 GB+.</small>
          )}
        </div>
        <label className="cp-ctl cp-name">
          <span className="cp-ctl-label">Node name (optional)</span>
          <input
            type="text"
            maxLength={64}
            placeholder="garage-rig"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <p className="cp-note" role="note">
        The command downloads the Spindle node agent from this server and builds the node image on your own
        machine. The first build also downloads the official {engine === 'vllm' ? 'vLLM' : 'Ollama'} base
        image (about 2 GB or more) from Docker Hub, which takes a few minutes. Requires Docker.
      </p>
      {os === 'macos' ? (
        <p className="cp-note" role="note">
          Install the Ollama app first. Spindle uses its GPU (Metal) from the container.
        </p>
      ) : null}
      {os === 'windows' ? (
        <p className="cp-note" role="note">
          Run this in PowerShell with Docker Desktop (WSL2 backend). For GPUs, install the current NVIDIA
          Windows driver.
        </p>
      ) : null}

      {enroll.isError ? (
        <ErrorState title="Could not create a command" message={enroll.error.message} onRetry={generate} />
      ) : null}
      {res ? (
        <div className="cp-cmds">
          <CodeBlock
            label={os === 'windows' ? 'PowerShell' : 'Terminal'}
            code={os === 'windows' ? res.commands.powershell : res.commands.installer}
          />
          <p className="cp-expiry" data-expired={left ? undefined : 'true'} role="status">
            {left
              ? `This command works once and expires in ${left}.`
              : 'This command has expired. Generate a new one.'}
          </p>
        </div>
      ) : null}
      <div className="sd-actions-row">
        <CTA icon={res ? 'loader' : 'terminal'} onClick={generate} disabled={enroll.isPending}>
          {enroll.isPending ? 'Generating…' : res ? 'Regenerate command' : 'Generate command'}
        </CTA>
      </div>
      <p className="cp-hint">
        After it starts, the node appears below within a few seconds. Nodes must be registered on-chain before
        they receive jobs.
      </p>
    </section>
  );
}
