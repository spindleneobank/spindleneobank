import { useState } from 'react';
import { CTA } from '../../components/CTA';
import { EmptyState } from '../../components/EmptyState';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { StatusPill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { env } from '../../config';
import { Boundary, RowTable } from '../shell/ui';
import { useModels, useRateCard } from './queries';

const base = `${env.apiUrl}/v1`;
const SNIPPETS = {
  curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer sk-spdl-YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"llama-3.1-8b-instruct","messages":[{"role":"user","content":"Hello"}]}'`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="sk-spdl-YOUR_KEY")
res = client.chat.completions.create(
    model="llama-3.1-8b-instruct",
    messages=[{"role": "user", "content": "Hello"}],
)
print(res.choices[0].message.content)`,
  node: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: "sk-spdl-YOUR_KEY" });
const res = await client.chat.completions.create({
  model: "llama-3.1-8b-instruct",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(res.choices[0].message.content);`,
} as const;
type Lang = keyof typeof SNIPPETS;
const LABEL: Record<Lang, string> = { curl: 'curl', python: 'OpenAI Python', node: 'OpenAI Node' };

export function Quickstart() {
  const [lang, setLang] = useState<Lang>('curl');
  const { toast } = useToast();
  return (
    <section className="sd-box dv-quick">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">QUICKSTART</span>
          <h2>Call the API</h2>
        </div>
        <div className="sd-seg" role="group" aria-label="Language">
          {(Object.keys(SNIPPETS) as Lang[]).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {LABEL[l]}
            </button>
          ))}
        </div>
      </div>
      <pre className="dv-code">
        <code>{SNIPPETS[lang]}</code>
      </pre>
      <div className="sd-actions-row">
        <CTA
          icon="copy"
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(SNIPPETS[lang])
              .then(() => toast('Snippet copied', 'ok'))
              .catch(() => toast('Copy failed. Select the snippet and copy it manually.', 'error'))
          }
        >
          Copy snippet
        </CTA>
        <CTA to="/developers" variant="ghost">
          Developer docs
        </CTA>
        <CTA to="/dashboard/chat" variant="ghost">
          Try it in Chat
        </CTA>
      </div>
    </section>
  );
}

export function RateCardTable() {
  const rate = useRateCard();
  const models = useModels();
  return (
    <section className="sd-box dv-rates">
      <div className="sd-box-top">
        <div>
          <span className="sd-eyebrow">PRICING</span>
          <h2>Models and rate card</h2>
        </div>
      </div>
      <Boundary query={models} title="Models" skeleton={<Skeleton height={140} />}>
        {(m) =>
          m.data.length === 0 ? (
            <EmptyState icon="stack" title="No models listed">
              No model has an online node right now.
            </EmptyState>
          ) : (
            <RowTable
              caption="Models and buyer prices"
              rows={m.data}
              rowKey={(r) => r.id}
              template="1.6fr 1fr 1fr 1fr 0.8fr"
              cols={[
                { key: 'id', header: 'Model', render: (r) => <strong>{r.id}</strong> },
                { key: 'lane', header: 'Lane', render: (r) => r.lanes.join(', ') },
                { key: 'unit', header: 'Unit', render: (r) => r.pricing.unitKind.replaceAll('_', ' ') },
                {
                  key: 'price',
                  header: 'Buyer price',
                  align: 'right',
                  render: (r) => <Money micros={r.pricing.buyerMicrosPerUnit} fractionDigits={4} />,
                },
                {
                  key: 'avail',
                  header: 'Status',
                  align: 'right',
                  render: (r) => (
                    <StatusPill tone={r.available ? 'ok' : 'warn'}>
                      {r.available ? 'Online' : 'Offline'}
                    </StatusPill>
                  ),
                },
              ]}
            />
          )
        }
      </Boundary>
      <Boundary query={rate} title="Rate card" skeleton={<Skeleton height={140} />}>
        {(rows) =>
          rows.length === 0 ? null : (
            <RowTable
              caption="Today's rate card by GPU class"
              rows={rows}
              rowKey={(r) => `${r.gpuClass}:${r.lane}:${r.unitKind}`}
              template="0.8fr 0.8fr 1fr 1fr"
              cols={[
                { key: 'class', header: 'GPU class', render: (r) => `Class ${r.gpuClass}` },
                { key: 'lane', header: 'Lane', render: (r) => r.lane },
                { key: 'unit', header: 'Unit', render: (r) => r.unitKind.replaceAll('_', ' ') },
                {
                  key: 'price',
                  header: 'Buyer price',
                  align: 'right',
                  render: (r) => <Money micros={r.buyerMicrosPerUnit} fractionDigits={4} />,
                },
              ]}
            />
          )
        }
      </Boundary>
    </section>
  );
}
