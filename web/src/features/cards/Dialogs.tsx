import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { CardFace, CardFinishPicker } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { formatCents } from '../../components/Money';
import { StatusPill } from '../../components/StatusPill';
import { countdown, useNow } from '../shell/ui';
import { EMAIL_RE, friendlyError, parseDollars, validateTopup } from './logic';
import { armApplePay, pollApplePay, revealCard, useCardPricing, useCreateCard, useTopup } from './queries';

/* ---------------- create ---------------- */

export function CreateCardDialog({
  open,
  onClose,
  defaultFinish,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultFinish: string;
  onCreated: (opId: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Create your virtual card">
      {open ? <CreateForm defaultFinish={defaultFinish} onCreated={onCreated} onClose={onClose} /> : null}
    </Dialog>
  );
}

function CreateForm({
  defaultFinish,
  onCreated,
  onClose,
}: {
  defaultFinish: string;
  onCreated: (opId: string) => void;
  onClose: () => void;
}) {
  const pricing = useCardPricing();
  const create = useCreateCard();
  const [email, setEmail] = useState('');
  const [alias, setAlias] = useState('');
  const [finish, setFinish] = useState(defaultFinish);
  const [product, setProduct] = useState('');
  const [touched, setTouched] = useState(false);
  const products = pricing.data?.products.filter((p) => p.available) ?? [];
  const chosen = products.find((p) => p.id === product) ?? products[0];
  const emailBad = !EMAIL_RE.test(email.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailBad || !chosen) return;
    create.mutate(
      { product: chosen.id, email: email.trim(), alias: alias.trim() || undefined, finish },
      {
        onSuccess: (r) => {
          onClose();
          onCreated(r.operation.id);
        },
      },
    );
  };

  if (pricing.isPending) return <p>Loading pricing…</p>;
  if (pricing.isError || !pricing.data) {
    return (
      <div role="alert">
        <p>Pricing is unavailable right now.</p>
        <CTA variant="secondary" icon="" onClick={() => void pricing.refetch()}>
          Try again
        </CTA>
      </div>
    );
  }
  if (!chosen) return <p role="status">No card product is available for issue right now.</p>;
  return (
    <form className="cd-form" onSubmit={submit} noValidate>
      <div className="cd-preview">
        <CardFace finish={finish} decorative />
      </div>
      <label className="cd-field">
        <span>Card</span>
        <select value={chosen.id} onChange={(e) => setProduct(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="cd-field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && emailBad}
          aria-describedby="cd-email-help"
          placeholder="you@example.com"
        />
        <small id="cd-email-help" className={touched && emailBad ? 'cd-bad' : ''}>
          {touched && emailBad
            ? 'Enter a valid email address.'
            : 'izipay sends card notices and Apple Pay codes here; stored encrypted.'}
        </small>
      </label>
      <label className="cd-field">
        <span>Alias (optional)</span>
        <input
          maxLength={64}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="e.g. Cloud bills"
        />
      </label>
      <div className="cd-field">
        <span>Finish</span>
        <CardFinishPicker value={finish} onChange={setFinish} />
      </div>
      <p className="cd-fee">
        Issue fee <strong>${formatCents(chosen.issueFeeUsdCents)}</strong>, paid in USDG through Relay.
        Top-ups come after the card is issued.
      </p>
      {create.isError ? (
        <p className="cd-error" role="alert">
          {friendlyError(create.error)}
        </p>
      ) : null}
      <div className="sd-actions-row">
        <CTA icon="" disabled={create.isPending} type="submit">
          {create.isPending ? 'Creating…' : 'Create card'}
        </CTA>
        <CTA variant="ghost" icon="" onClick={onClose}>
          Cancel
        </CTA>
      </div>
    </form>
  );
}

/* ---------------- top-up ---------------- */

export function TopupDialog({
  cardId,
  onClose,
  onCreated,
}: {
  cardId: string | null;
  onClose: () => void;
  onCreated: (opId: string) => void;
}) {
  return (
    <Dialog open={!!cardId} onClose={onClose} title="Top up your card">
      {cardId ? <TopupForm cardId={cardId} onClose={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function TopupForm({
  cardId,
  onClose,
  onCreated,
}: {
  cardId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const pricing = useCardPricing();
  const topup = useTopup(cardId);
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  if (pricing.isPending) return <p>Loading pricing…</p>;
  if (pricing.isError || !pricing.data) {
    return (
      <div role="alert">
        <p>Pricing is unavailable right now.</p>
        <CTA variant="secondary" icon="" onClick={() => void pricing.refetch()}>
          Try again
        </CTA>
      </div>
    );
  }
  const p = pricing.data;
  const err = validateTopup(amount, p.minTopupCents, p.maxTopupCents);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const cents = parseDollars(amount);
    if (err || cents === null) return;
    topup.mutate(cents.toString(), {
      onSuccess: (r) => {
        onClose();
        onCreated(r.operation.id);
      },
    });
  };
  return (
    <form className="cd-form" onSubmit={submit} noValidate>
      <label className="cd-field">
        <span>Amount (USD)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!err}
          aria-describedby="cd-amt-help"
          placeholder={`${formatCents(p.minTopupCents)} to ${formatCents(
            BigInt(p.maxTopupCents) < 1_000_000n ? p.maxTopupCents : '1000000',
          )}`}
        />
        <small id="cd-amt-help" className={touched && err ? 'cd-bad' : ''}>
          {touched && err ? err : p.topupFeeNote}
        </small>
      </label>
      <p className="cd-fee">Card must be issued. Top-ups arrive in about 1 to 3 min after the bridge.</p>
      {topup.isError ? (
        <p className="cd-error" role="alert">
          {friendlyError(topup.error)}
        </p>
      ) : null}
      <div className="sd-actions-row">
        <CTA icon="" type="submit" disabled={topup.isPending}>
          {topup.isPending ? 'Creating invoice…' : 'Continue'}
        </CTA>
        <CTA variant="ghost" icon="" onClick={onClose}>
          Cancel
        </CTA>
      </div>
    </form>
  );
}

/* ---------------- reveal ---------------- */

const REVEAL_MS = 60_000;

export function RevealDialog({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!cardId} onClose={onClose} title="Card details">
      {/* Mounted only while open, so the details live in this subtree's state and nowhere else. */}
      {cardId ? <RevealBody cardId={cardId} onClose={onClose} /> : null}
    </Dialog>
  );
}

type Revealed = { number: string; exp: string; cvv: string; holder: string };
const groups = (n: string) =>
  n
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim();

export function RevealBody({
  cardId,
  onClose,
  reveal = revealCard,
}: {
  cardId: string;
  onClose: () => void;
  reveal?: typeof revealCard;
}) {
  const auth = useAuth();
  const [data, setData] = useState<Revealed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(REVEAL_MS / 1000);
  const started = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let live = true;
    auth
      .withReauth(() => reveal(cardId))
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(friendlyError(e));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    const hide = () => document.hidden && close.current();
    document.addEventListener('visibilitychange', hide);
    const end = Date.now() + REVEAL_MS;
    const t = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      if (s <= 0) close.current();
      else setLeft(s);
    }, 1000);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      clearInterval(t);
    };
  }, [data]);

  if (error) {
    return (
      <div role="alert" className="cd-form">
        <p className="cd-error">{error}</p>
        <div className="sd-actions-row">
          <CTA variant="secondary" icon="" onClick={onClose}>
            Close
          </CTA>
        </div>
      </div>
    );
  }
  if (!data) return <p role="status">Confirm with your wallet to show the details…</p>;
  const rows: [string, string, string][] = [
    ['Card number', groups(data.number), data.number],
    ['Expires', data.exp, data.exp],
    ['CVV', data.cvv, data.cvv],
    ['Cardholder', data.holder, data.holder],
  ];
  return (
    <div className="cd-reveal" data-testid="reveal">
      {rows.map(([label, shown, raw]) => (
        <div key={label} className="cd-reveal-row">
          <div>
            <small>{label}</small>
            <code>{shown}</code>
          </div>
          <CopyButton value={raw} label={label} />
        </div>
      ))}
      <small className="cd-fee">Hides automatically in {left}s, or when you leave this tab.</small>
      <div className="sd-actions-row">
        <CTA variant="secondary" icon="" onClick={onClose}>
          Hide
        </CTA>
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="sd-link"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ---------------- Apple Pay ---------------- */

type Apple = Awaited<ReturnType<typeof pollApplePay>>;

export function ApplePayDialog({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!cardId} onClose={onClose} title="Add to Apple Pay">
      {cardId ? <ApplePayBody cardId={cardId} onClose={onClose} /> : null}
    </Dialog>
  );
}

function ApplePayBody({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const auth = useAuth();
  const now = useNow(1000);
  const [state, setState] = useState<'idle' | 'arming' | 'polling'>('idle');
  const [apple, setApple] = useState<Apple | null>(null);
  const [armedUntil, setArmedUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resume an already-armed window (e.g. dialog reopened); never arms by itself.
  useEffect(() => {
    let live = true;
    pollApplePay(cardId)
      .then((a) => {
        if (live && (a.status === 'armed' || a.status === 'code')) {
          setApple(a);
          setArmedUntil(a.expiresAt);
          setState('polling');
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId]);

  useEffect(() => {
    if (state !== 'polling') return;
    let live = true;
    const tick = () =>
      pollApplePay(cardId)
        .then((a) => live && setApple(a))
        .catch((e) => live && setError(friendlyError(e)));
    const t = setInterval(tick, 5000);
    void tick();
    return () => {
      live = false;
      clearInterval(t);
      setApple(null);
    };
  }, [state, cardId]);

  const arm = async () => {
    setError(null);
    setState('arming');
    try {
      const r = await auth.withReauth(() => armApplePay(cardId));
      setArmedUntil(r.armedUntil);
      setState('polling');
    } catch (e) {
      setError(friendlyError(e));
      setState('idle');
    }
  };

  const status = apple?.status;
  const expiresAt = apple?.expiresAt ?? armedUntil;
  const left = expiresAt ? countdown(expiresAt, now) : null;
  const timedOut = state === 'polling' && !!expiresAt && Date.parse(expiresAt) <= now && status !== 'code';
  return (
    <div className="cd-form">
      {state === 'idle' || state === 'arming' ? (
        <>
          <ol className="cd-howto">
            <li>Press the button below. It opens a 10 minute window.</li>
            <li>On your iPhone, open Wallet and add this card. Choose to verify by email.</li>
            <li>Your code shows up here as soon as it arrives.</li>
          </ol>
          <p className="cd-fee">
            Only one card can be activated at a time. Do not start a second one during the window.
          </p>
          <div className="sd-actions-row">
            <CTA icon="" disabled={state === 'arming'} onClick={() => void arm()}>
              {state === 'arming' ? 'Confirm in wallet…' : 'Start activation'}
            </CTA>
          </div>
        </>
      ) : status === 'busy' ? (
        <div role="status">
          <StatusPill tone="warn">Busy</StatusPill>
          <p>Another activation is in progress. Try again in a few minutes.</p>
        </div>
      ) : status === 'code' && apple?.code ? (
        <div role="status" className="cd-otp">
          <small>Your Apple Pay verification code</small>
          <code data-testid="otp">{apple.code}</code>
          <small>Enter it in Wallet. {left ? `Window closes in ${left}.` : ''}</small>
        </div>
      ) : status === 'expired' || timedOut ? (
        <div role="status">
          <StatusPill tone="neutral">Expired</StatusPill>
          <p>The activation window ended without a code. Start again when you are ready to add the card.</p>
          <CTA variant="secondary" icon="" onClick={() => setState('idle')}>
            Start over
          </CTA>
        </div>
      ) : (
        <div role="status">
          <StatusPill tone="info">Waiting for the code</StatusPill>
          <p>Add the card in Wallet on your iPhone now. Window closes in {left ?? '…'}.</p>
        </div>
      )}
      {error ? (
        <p className="cd-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sd-actions-row">
        <CTA variant="ghost" icon="" onClick={onClose}>
          Close
        </CTA>
      </div>
    </div>
  );
}
