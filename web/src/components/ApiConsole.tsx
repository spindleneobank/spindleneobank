import { useEffect, useRef, useState } from 'react';

const STAGES = [
  {
    name: 'Request accepted',
    status: '01 / REQUEST',
    detail: 'POST /v1/chat/completions',
    output: 'X-Spindle-Lane: sealed',
  },
  {
    name: 'Eligible GPU selected',
    status: '02 / ROUTE',
    detail: 'Attestation checked for the sealed lane.',
    output: 'Encrypted prompts → eligible compute',
  },
  {
    name: 'Work recorded',
    status: '03 / RECEIPT',
    detail: 'The node signs a COSE receipt for the job.',
    output: 'receipt.cose → verification → USDG ledger',
  },
  {
    name: 'Epoch recorded',
    status: '04 / CLAIM',
    detail: 'Verified work enters the hourly Merkle root.',
    output: 'USDG · Stock Tokens · Virtual Card',
  },
] as const;

/** Illustrative request-to-receipt choreography (port of api-console.js). No network or account requests. */
export function ApiConsole() {
  const [step, setStep] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    let visible = false;
    const stop = () => {
      clearInterval(timer);
      timer = 0;
    };
    const play = () => {
      stop();
      if (visible && !document.hidden)
        timer = window.setInterval(() => setStep((s) => (s + 1) % STAGES.length), 2400);
    };
    const io = new IntersectionObserver(
      (entries) => {
        visible = !!entries[0]?.isIntersecting;
        play();
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    document.addEventListener('visibilitychange', play);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', play);
    };
  }, []);
  const s = STAGES[step] ?? STAGES[0];
  return (
    <section
      ref={ref}
      className="sp-api-console"
      aria-label="Illustrative Spindle API request and receipt flow"
      data-step={step}
    >
      <header>
        <span>SPINDLE / API FLOW</span>
        <small>SPEC PREVIEW</small>
      </header>
      <div className="sp-api-request">
        <span>POST</span>
        <code>/v1/chat/completions</code>
      </div>
      <div className="sp-api-state">
        <small>{s.status}</small>
        <strong>{s.name}</strong>
        <p>{s.detail}</p>
      </div>
      <div className="sp-api-output">
        <span>{s.output}</span>
      </div>
      <div className="sp-api-track" aria-hidden="true">
        {STAGES.map((st, i) => (
          <i key={st.status} className={i <= step ? 'on' : ''} />
        ))}
      </div>
    </section>
  );
}
