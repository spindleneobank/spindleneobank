import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { CardFace, CardFinishPicker } from '../../components/CardFace';
import { CTA } from '../../components/CTA';
import { Dialog } from '../../components/Dialog';
import { formatCents } from '../../components/Money';
import { StatusPill } from '../../components/StatusPill';
import { useNow } from '../shell/ui';
import { EMAIL_RE, friendlyError, parseDollars, validateTopup } from './logic';
import { pollApplePay, revealCard, useCardPricing, useCreateCard, useTopup } from './queries';

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
  onCreated: (opId: string, cardId: string) => void;
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
  onCreated: (opId: string, cardId: string) => void;
  onClose: () => void;
}) {
  const pricing = useCardPricing();
  const create = useCreateCard();
  const [email, setEmail] = useState('');
  const [holderName, setHolderName] = useState('');
  const [finish, setFinish] = useState(defaultFinish);
  const [product, setProduct] = useState('');
  const [touched, setTouched] = useState(false);
  const products = pricing.data?.products.filter((p) => p.available) ?? [];
  const chosen = products.find((p) => p.id === product) ?? products[0];
  const emailBad = !EMAIL_RE.test(email.trim());
  const holder = holderName.trim();
  const holderBad = holder.length < 2 || !/\p{L}/u.test(holder);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailBad || holderBad || !chosen) return;
    create.mutate(
      { product: chosen.id, email: email.trim(), cardholderName: holder, finish },
      {
        onSuccess: (r) => {
          onClose();
          onCreated(r.operation.id, r.card.id);
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
        <span>Cardholder name</span>
        <input
          required
          maxLength={64}
          autoComplete="name"
          value={holderName}
          onChange={(e) => setHolderName(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && holderBad}
          aria-describedby="cd-holder-help"
          placeholder="e.g. Alex Morgan"
        />
        <small id="cd-holder-help" className={touched && holderBad ? 'cd-bad' : ''}>
          {touched && holderBad
            ? 'Enter the cardholder name.'
            : 'The name izipay shows for this card; stored encrypted.'}
        </small>
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
  onCreated: (opId: string, cardId: string) => void;
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
  onCreated: (id: string, cardId: string) => void;
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
        onCreated(r.operation.id, cardId);
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
  // One request per mount even under StrictMode's double effect; each effect run attaches its own listener.
  const request = useRef<Promise<Revealed> | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    request.current ??= auth.withReauth(() => reveal(cardId));
    request.current
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

/** Same cadence as pingapp's dialog: codes arrive at any time, so check while open and on return from Wallet. */
const POLL_MS = 4000;

type Delivered = { code: string; receivedAt: string; deadline: number };

export function ApplePayDialog({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!cardId} onClose={onClose} title="Add to Apple Pay">
      {cardId ? <ApplePayBody cardId={cardId} onClose={onClose} /> : null}
    </Dialog>
  );
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ApplePayBody({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const now = useNow(1000);
  const [delivered, setDelivered] = useState<Delivered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    try {
      const a = await pollApplePay(cardId);
      if (!mounted.current) return;
      setError(null);
      // The deadline comes from the server's remaining seconds, so a skewed device clock cannot hide a valid
      // code or keep an expired one on screen.
      setDelivered(
        a.status === 'delivered'
          ? { code: a.code, receivedAt: a.receivedAt, deadline: Date.now() + a.expiresInSec * 1000 }
          : null,
      );
    } catch (e) {
      if (mounted.current) setError(friendlyError(e));
    }
  }, [cardId]);

  useEffect(() => {
    mounted.current = true;
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    const visible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [poll]);

  const live = delivered && delivered.deadline > now ? delivered : null;
  return (
    <div className="cd-form">
      {live ? (
        <div role="status" className="cd-otp" aria-live="polite">
          <small>Your Apple Pay verification code</small>
          <code data-testid="otp">{live.code}</code>
          <small data-testid="otp-countdown">Expires in {mmss(live.deadline - now)}.</small>
          <CopyButton value={live.code} label="code" />
          <small>Wallet asked again? The newer code replaces this one as soon as it arrives.</small>
        </div>
      ) : (
        <>
          <ol className="cd-howto">
            <li>On your iPhone, open Wallet and add this card. Choose to verify by email.</li>
            <li>
              Your code shows up here as soon as it arrives. Codes received in the last 10 minutes show too.
            </li>
          </ol>
          <div role="status">
            <StatusPill tone="info">Waiting for the code</StatusPill>
          </div>
        </>
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
