import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { CTA } from '../../components/CTA';
import { PageHero, pageHead } from '../../components/marketing/F0n';
import {
  DIGESTS,
  ENDPOINTS,
  ERROR_CODES,
  EXAMPLE_DEFAULT_API,
  EXAMPLES,
  JOB_HEADERS,
  LIMITS,
  QUICKSTART_STEPS,
  RECEIPT_LIMIT,
  RECEIPT_STEPS,
  RECEIPT_STRUCTURE,
  SECTIONS,
  SESSION_STEPS,
  SESSION_TRUST,
  X402_CHALLENGE,
  X402_NOTES,
  X402_PAYMENT_HEADER,
  X402_TYPED_DATA,
} from '../../content/developers';
import '../../content/developers/developers.css';
import { env } from '../../env';

export const Route = createFileRoute('/(marketing)/developers')({
  head: () =>
    pageHead(
      'Developers',
      'Call Spindle with any OpenAI SDK, pay with an API key or x402, and verify signed receipts.',
      '/developers',
    ),
  component: Developers,
});

type Example = (typeof EXAMPLES)[keyof typeof EXAMPLES];

function Code({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="dev-code">
      <div className="dev-code-head">
        <span>{title}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${title}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A real example file from app/examples, with the dev API URL swapped for this deployment's. */
function ExampleFile({ example, open }: { example: Example; open?: boolean }) {
  const code = example.code.replaceAll(EXAMPLE_DEFAULT_API, env.apiUrl);
  return (
    <details className="dev-details" open={open}>
      <summary>examples/{example.file}</summary>
      <Code title={example.file} code={code} />
    </details>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="dev-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

type Model = {
  id: string;
  kind: string;
  lanes: string[];
  available: boolean;
  pricing: { unitKind: string; buyerMicrosPerUnit: string };
};
type Rate = { gpuClass: string; lane: string; unitKind: string; buyerMicrosPerUnit: string };

const usdg = (micros: string) => {
  const n = Number(micros) / 1e6;
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
};
const UNIT: Record<string, string> = {
  tokens_1m: 'per 1M tokens',
  image: 'per image',
  gpu_hour: 'per GPU hour',
};

function LivePricing() {
  const [state, setState] = useState<{ models: Model[]; rates: Rate[] } | 'loading' | 'offline'>('loading');
  useEffect(() => {
    if (env.mock) {
      setState('offline');
      return;
    }
    const ctl = new AbortController();
    Promise.all([
      fetch(`${env.apiUrl}/v1/models`, { signal: ctl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(r.status),
      ),
      fetch(`${env.apiUrl}/v1/rate-card`, { signal: ctl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(r.status),
      ),
    ])
      .then(([m, r]) => setState({ models: (m as { data: Model[] }).data ?? [], rates: r as Rate[] }))
      .catch(() => {
        if (!ctl.signal.aborted) setState('offline');
      });
    return () => ctl.abort();
  }, []);

  if (state === 'loading')
    return <p className="dev-note">Loading live models and prices from {env.apiUrl}/v1 ...</p>;
  if (state === 'offline')
    return (
      <p className="dev-callout">
        Live prices could not be loaded right now. They come from <code>GET /v1/models</code> and{' '}
        <code>GET /v1/rate-card</code>; call them directly for the current list.
      </p>
    );
  return (
    <>
      <div className="dev-table-wrap">
        <table className="dev-table">
          <caption className="sp-sr-only">Models</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Kind</th>
              <th scope="col">Lanes</th>
              <th scope="col">Price (USDG)</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {state.models.length === 0 ? (
              <tr>
                <td colSpan={5}>No models are listed yet.</td>
              </tr>
            ) : (
              state.models.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>{m.kind}</td>
                  <td>{m.lanes.join(', ')}</td>
                  <td>
                    {usdg(m.pricing.buyerMicrosPerUnit)} {UNIT[m.pricing.unitKind] ?? m.pricing.unitKind}
                  </td>
                  <td>{m.available ? 'available' : 'no node online'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <h3>Today's rate card</h3>
      <div className="dev-table-wrap">
        <table className="dev-table">
          <caption className="sp-sr-only">Rate card</caption>
          <thead>
            <tr>
              <th scope="col">GPU class</th>
              <th scope="col">Lane</th>
              <th scope="col">Price (USDG)</th>
            </tr>
          </thead>
          <tbody>
            {state.rates.length === 0 ? (
              <tr>
                <td colSpan={3}>No rates published yet.</td>
              </tr>
            ) : (
              state.rates.map((r) => (
                <tr key={`${r.gpuClass}-${r.lane}-${r.unitKind}`}>
                  <td>{r.gpuClass}</td>
                  <td>{r.lane}</td>
                  <td>
                    {usdg(r.buyerMicrosPerUnit)} {UNIT[r.unitKind] ?? r.unitKind}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Developers() {
  const base = `${env.apiUrl}/v1`;
  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="Build on Spindle"
        wide
        lead="An OpenAI-compatible API on verifiable GPU compute. Pay with an API key or per call with x402, and check every job against a signed receipt."
      >
        <div className="f0n-actions">
          <CTA to="/dashboard/developers" variant="primary">
            Open Developers tab
          </CTA>
          <CTA href={`${base}/openapi.json`} variant="secondary" icon="">
            openapi.json
          </CTA>
        </div>
      </PageHero>
      <div className="dev-body">
        <div className="sp-container dev-layout">
          <nav className="dev-toc" aria-label="On this page">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>
          <div className="dev-main">
            <Section id="quickstart" title="Quickstart">
              <ol className="dev-steps">
                {QUICKSTART_STEPS.map((s) => (
                  <li key={s.n}>
                    <small>{s.n}</small>
                    <b>{s.title}</b>
                    <span>{s.body}</span>
                  </li>
                ))}
              </ol>
              <p>
                The base URL is <code>{base}</code>. In the OpenAI SDKs set <code>base_url = "{base}"</code>{' '}
                (Python) or <code>baseURL</code> (Node) and use your <code>sk-spdl-...</code> key as the API
                key.
              </p>
              <ExampleFile example={EXAMPLES.curl} open />
              <ExampleFile example={EXAMPLES.node} />
              <ExampleFile example={EXAMPLES.python} />
              <p className="dev-note">
                All files live in <code>app/examples/</code> with a README; each prints a PASS line and exits
                non-zero on failure.
              </p>
            </Section>

            <Section id="models" title="Models and pricing">
              <p>
                Prices are read live from the API in your browser. Buyer prices include the 20% platform
                share; you pay the exact metered amount for each call.
              </p>
              <LivePricing />
            </Section>

            <Section id="endpoints" title="Endpoints">
              <p>
                Authenticate buyer calls with <code>Authorization: Bearer sk-spdl-...</code>, or pay per call
                with x402. Public routes need no authentication.
              </p>
              <div className="dev-table-wrap">
                <table className="dev-table">
                  <caption className="sp-sr-only">Spindle headers</caption>
                  <thead>
                    <tr>
                      <th scope="col">Header</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {JOB_HEADERS.map(([h, d]) => (
                      <tr key={h}>
                        <td>{h}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ENDPOINTS.map((e) => (
                <article className="dev-endpoint" key={e.id} id={`ep-${e.id}`}>
                  <h3>
                    <span className="dev-method">{e.method}</span>
                    {e.path}
                  </h3>
                  <p>{e.summary}</p>
                  <p className="dev-note">Auth: {e.auth}</p>
                  <div className={e.request ? 'dev-grid-2' : undefined}>
                    {e.request ? <Code title="request" code={e.request} /> : null}
                    <Code title="response" code={e.response} />
                  </div>
                  {e.notes?.length ? (
                    <ul>
                      {e.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </Section>

            <Section id="x402" title="x402 per-call payment">
              <p>
                No account and no key: send the request, receive a price, sign it with your wallet and retry.
                Payment uses Permit2 on USDG with a Spindle witness, on chain 4663.
              </p>
              <h3>1. The challenge</h3>
              <p>
                A request with no authentication gets <code>402</code>. The <code>PAYMENT-REQUIRED</code>{' '}
                header holds base64 of this JSON, and the body carries the same JSON.
              </p>
              <Code title="PAYMENT-REQUIRED (decoded)" code={X402_CHALLENGE} />
              <h3>2. Approve Permit2 once</h3>
              <p>
                Approve USDG to Permit2 (<code>0x000000000022D473030F116dDEE9F6B43aC78BA3</code>) from your
                wallet. It is a normal transaction, so you pay the gas, and it is needed once per wallet. See{' '}
                <code>ensurePermit2Allowance</code> in <code>x402-lib.ts</code> below.
              </p>
              <h3>3. Sign the SpindlePayment witness</h3>
              <Code title="EIP-712 typed data" code={X402_TYPED_DATA} />
              <h3>4. Retry with X-PAYMENT</h3>
              <Code title="headers" code={X402_PAYMENT_HEADER} />
              <ul>
                {X402_NOTES.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <ExampleFile example={EXAMPLES.x402Client} open />
              <ExampleFile example={EXAMPLES.x402Lib} />
            </Section>

            <Section id="sessions" title="x402 sessions">
              <p>
                For many calls, sign one cap and reuse it. A session has the same checks and the same Permit2
                approval as a single payment, and it pays the surcharge once.
              </p>
              <p className="dev-callout">{SESSION_TRUST}</p>
              <ol>
                {SESSION_STEPS.map(([t, d]) => (
                  <li key={t}>
                    <b>{t}.</b> {d}
                  </li>
                ))}
              </ol>
              <ExampleFile example={EXAMPLES.x402Session} />
            </Section>

            <Section id="receipts" title="Receipts and verification">
              <p>
                Each completed job has a receipt signed by the node that ran it. The response gives you the
                job id in <code>X-Spindle-Job-Id</code>.
              </p>
              <Code title="receipt structure" code={RECEIPT_STRUCTURE} />
              <div className="dev-table-wrap">
                <table className="dev-table">
                  <caption className="sp-sr-only">Digests</caption>
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIGESTS.map(([f, d]) => (
                      <tr key={f}>
                        <td>{f}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Verify it yourself</h3>
              <ol>
                {RECEIPT_STEPS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="dev-callout">{RECEIPT_LIMIT}</p>
              <ExampleFile example={EXAMPLES.verify} open />
              <ExampleFile example={EXAMPLES.receiptLib} />
            </Section>

            <Section id="limits" title="Limits and errors">
              <div className="dev-table-wrap">
                <table className="dev-table">
                  <caption className="sp-sr-only">Limits</caption>
                  <tbody>
                    {LIMITS.map(([k, v]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dev-table-wrap">
                <table className="dev-table">
                  <caption className="sp-sr-only">Error codes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">HTTP</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ERROR_CODES.map(([c, s, d]) => (
                      <tr key={c}>
                        <td>{c}</td>
                        <td>{s}</td>
                        <td>{d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section id="openapi" title="OpenAPI">
              <p>
                The machine-readable description of the public and buyer API is at{' '}
                <a href={`${base}/openapi.json`}>
                  <code>{base}/openapi.json</code>
                </a>
                .
              </p>
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
