import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { PixelIcon } from '../../PixelIcon';
import { ButtonPrimary, ButtonSecondary } from './Buttons';
import { NavLink } from './Header';
import { LogoSpotlight } from './LogoSpotlight';
import { CTA_LABEL, FOOTER_COLS, SOCIALS } from './nav-data';

/** Port of spindle.js coming(): native <dialog>, closes on backdrop / close button / Esc, restores focus. */
export function ComingDialog({
  what,
  onClose,
}: {
  what: (typeof SOCIALS)[number] | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (what && !d.open) {
      last.current = document.activeElement;
      d.showModal();
    } else if (!what && d.open) d.close();
  }, [what]);
  const close = () => {
    ref.current?.close();
    onClose();
    (last.current as HTMLElement | null)?.focus?.();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click only; Esc is handled by onCancel
    <dialog
      ref={ref}
      className="sx-dialog"
      aria-label="Coming soon"
      onClick={(e) => e.target === ref.current && close()}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <button type="button" className="sx-dialog-x" aria-label="Close dialog" onClick={close}>
        <PixelIcon name="close" size={18} />
      </button>
      {what ? (
        <div className="sx-coming">
          <span className="sx-coming-sym">
            <PixelIcon name={what.key} size={34} />
          </span>
          <span className="sp-eyebrow">SPINDLE / {what.name.toUpperCase()}</span>
          <h2>Coming soon.</h2>
          <p>Our next connection is taking shape.</p>
          <button type="button" className="sx-coming-b" onClick={close}>
            Keep exploring <PixelIcon name="arrow" size={18} />
          </button>
        </div>
      ) : null}
    </dialog>
  );
}

export function SocialButton({
  s,
  box,
  onOpen,
}: {
  s: (typeof SOCIALS)[number];
  box?: boolean;
  onOpen: (s: (typeof SOCIALS)[number]) => void;
}) {
  return (
    <a
      href={`#${s.key}`}
      className={box ? 'sx-sbox' : 'sx-sico'}
      data-sp-social={s.key}
      aria-label={s.label}
      onClick={(e) => {
        e.preventDefault();
        onOpen(s);
      }}
    >
      <PixelIcon name={s.key} size={18} />
    </a>
  );
}

const MLink = motion.create(Link);
function FooterLink({ to, label }: { to: string; label: string }) {
  const [path, hash] = to.split('#');
  return (
    <MLink
      to={path || '/'}
      hash={hash}
      className="sx-fl"
      initial={false}
      animate={{ opacity: 0.5 }}
      whileHover={{ opacity: 1 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.6 }}
    >
      <p>{label}</p>
    </MLink>
  );
}

function Edge({ at }: { at: 't' | 'b' }) {
  return (
    <div className={`sx-edge sx-edge-${at}`} aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

export function Footer() {
  const [what, setWhat] = useState<(typeof SOCIALS)[number] | null>(null);
  const year = new Date().getUTCFullYear();
  return (
    <footer className="sx-footer">
      <div className="sx-wrap sx-band">
        <div className="sx-cont sx-band-c">
          <div className="sx-band-bg" aria-hidden="true">
            <img src="/assets/pixel/constellation-field.svg" alt="" />
          </div>
          <div className="sx-band-h">
            <h2>Your compute. Your payout.</h2>
          </div>
          <div className="sx-band-r">
            <p>
              Explore how Spindle connects GPU supply, verifiable AI work and a choice of payout routes on
              Robinhood Chain.
            </p>
            <div className="sx-band-btns">
              <ButtonPrimary to="/dashboard" light lg>
                {CTA_LABEL}
              </ButtonPrimary>
              <ButtonSecondary to="/compute-lanes">Explore lanes</ButtonSecondary>
            </div>
          </div>
        </div>
      </div>
      <div className="sx-wrap">
        <Edge at="t" />
        <div className="sx-cont sx-nav">
          <div className="sx-nav-l">
            <div>
              <NavLink to="/" className="sx-logo" aria-label="Spindle home">
                <img src="/assets/brand/wordmark.svg" alt="Spindle" width={108} height={32} />
              </NavLink>
              <p>GPU compute, signed receipts and payout choice. Built on Robinhood Chain.</p>
            </div>
            <div className="sx-conn">
              <span>Connect</span>
              <div className="sx-soc">
                {SOCIALS.map((s) => (
                  <SocialButton key={s.key} s={s} box onOpen={setWhat} />
                ))}
              </div>
            </div>
          </div>
          <div className="sx-nav-r">
            {FOOTER_COLS.map((c) => (
              <div className="sx-col" key={c.title}>
                <h3>{c.title}</h3>
                {c.items.map((i) => (
                  <FooterLink key={i.label + i.to} to={i.to} label={i.label} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sx-wrap">
        <Edge at="t" />
        <div className="sx-cont sx-spot">
          <div className="sx-spot-in">
            <LogoSpotlight />
          </div>
        </div>
        <Edge at="b" />
      </div>
      <div className="sx-wrap">
        <div className="sx-cont sx-legal">
          <p>
            {`© ${year} `}
            <NavLink to="/">Spindle</NavLink>
            {' Compute. Verify. Choose.'}
          </p>
          <div className="sx-legal-s">
            {[SOCIALS[2], SOCIALS[0], SOCIALS[1]].map((s) => (
              <SocialButton key={s.key} s={s} onOpen={setWhat} />
            ))}
          </div>
        </div>
      </div>
      <ComingDialog what={what} onClose={() => setWhat(null)} />
    </footer>
  );
}
