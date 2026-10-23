import { Link, useLocation } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { FADE } from '../motion/framer';
import { ButtonPrimary } from './Buttons';
import { COMPANY_A, COMPANY_B, CTA_LABEL, NAV_LINKS, SOLUTIONS, type SubItem } from './nav-data';

const CHEV = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path d='M6 11H8V13H10V15H12V17H14V19H18V17H20V15H22V13H24V11H26' fill='none' stroke='black' stroke-width='3' stroke-linecap='square'/></svg>\")";
const ARROW = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path d='M3 16H27M19 8L27 16L19 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='square'/></svg>\")";
const SPRING_MENU = { type: 'spring', bounce: 0, duration: 0.4 } as const;
const SPRING = { type: 'spring', bounce: 0, duration: 0.6 } as const;

/** `to` may carry a #hash (TanStack Link takes it separately). */
export function NavLink({ to, className, onClick, children, ...rest }: { to: string; className?: string; onClick?: () => void; children: ReactNode } & Record<string, unknown>) {
  const [path, hash] = to.split('#');
  return (
    <Link to={path || '/'} hash={hash} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}

function SubLink({ it, onGo }: { it: SubItem; onGo: () => void }) {
  return (
    <NavLink to={it.to} className="sx-dd-item" onClick={onGo}>
      <div className="sx-dd-t">{it.title}</div>
      <div className="sx-dd-d">{it.desc}</div>
    </NavLink>
  );
}

function Trigger({ label, open, id, onEnter, onLeave, onToggle, btnRef }: { label: string; open: boolean; id: string; onEnter: () => void; onLeave: () => void; onToggle: () => void; btnRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <motion.button
      ref={btnRef}
      type="button"
      className="sx-link"
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls={id}
      animate={{ backgroundColor: open ? 'rgba(17, 15, 21, 0.08)' : 'rgba(30, 21, 30, 0)' }}
      whileHover={{ backgroundColor: 'rgba(17, 15, 21, 0.08)' }}
      transition={SPRING}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={onToggle}
    >
      <span className="sx-t">{label}</span>
      <i className="sx-chev" style={{ '--sx-chev': CHEV } as CSSProperties} />
    </motion.button>
  );
}

function MobileSection({ title, items, onGo }: { title: string; items: SubItem[]; onGo: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sx-m-row">
      <button type="button" className="sx-m-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <p>{title}</p>
        <motion.svg viewBox="0 0 16 16" animate={{ rotate: open ? 180 : 0 }} transition={SPRING}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="#fff" strokeWidth="1.5" />
        </motion.svg>
      </button>
      <motion.div className="sx-m-sub" initial={false} animate={{ height: open ? 'auto' : 0 }} transition={SPRING}>
        <div className="sx-m-sub-in">
          {items.map((it) => (
            <NavLink key={it.title} to={it.to} className="sx-dd-item sx-m-item" onClick={onGo}>
              <div className="sx-dd-t">{it.title}</div>
              <div className="sx-dd-d">{it.desc}</div>
            </NavLink>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function Header() {
  const [menu, setMenu] = useState<'sol' | 'co' | null>(null);
  const [mobile, setMobile] = useState(false);
  const [vh, setVh] = useState(659);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solRef = useRef<HTMLButtonElement>(null);
  const coRef = useRef<HTMLButtonElement>(null);
  const [solX, setSolX] = useState(382);
  const loc = useLocation({ select: (l) => l.pathname });

  const open = useCallback((m: 'sol' | 'co') => {
    if (timer.current) clearTimeout(timer.current);
    const b = (m === 'sol' ? solRef : coRef).current;
    if (b && m === 'sol') {
      const r = b.getBoundingClientRect();
      setSolX(r.left + r.width / 2);
    }
    setMenu(m);
  }, []);
  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMenu(null), 150);
  }, []);
  const stay = () => timer.current && clearTimeout(timer.current);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close menus on route change
  useEffect(() => {
    setMenu(null);
    setMobile(false);
  }, [loc]);
  useEffect(() => {
    const f = () => setVh(window.innerHeight);
    f();
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setMobile(false);
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    document.documentElement.style.overflow = mobile ? 'clip' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [mobile]);

  return (
    <div className="sx-hfix">
      <header className="sx-header" data-open={mobile || undefined}>
        <motion.div className="sx-hmain" initial={false} animate={{ height: mobile ? vh : 'auto' }} transition={SPRING_MENU} style={{ overflow: mobile ? 'auto' : undefined }}>
          <div className="sx-hnav">
            <NavLink to="/" className="sx-logo" aria-label="Spindle home">
              <img src="/assets/brand/wordmark.svg" alt="Spindle" width={108} height={32} />
            </NavLink>
            <nav className="sx-links" aria-label="Primary">
              <NavLink to={NAV_LINKS.product.to} className="sx-link">
                <p>{NAV_LINKS.product.label}</p>
              </NavLink>
              <Trigger label="Solutions" id="sx-dd-sol" open={menu === 'sol'} btnRef={solRef} onEnter={() => open('sol')} onLeave={close} onToggle={() => (menu === 'sol' ? setMenu(null) : open('sol'))} />
              <NavLink to={NAV_LINKS.flows.to} className="sx-link">
                <p>{NAV_LINKS.flows.label}</p>
              </NavLink>
              <NavLink to={NAV_LINKS.compute.to} className="sx-link">
                <p>{NAV_LINKS.compute.label}</p>
              </NavLink>
              <Trigger label="Company" id="sx-dd-co" open={menu === 'co'} btnRef={coRef} onEnter={() => open('co')} onLeave={close} onToggle={() => (menu === 'co' ? setMenu(null) : open('co'))} />
            </nav>
            <div className="sx-hcta">
              <ButtonPrimary to="/dashboard">{CTA_LABEL}</ButtonPrimary>
              <motion.button type="button" className="sx-ham" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile} aria-controls="sx-mnav" onClick={() => setMobile((m) => !m)}>
                <span className="sx-ham-i">
                  <motion.b animate={{ y: mobile ? 7 : 0, rotate: mobile ? 45 : 0 }} transition={SPRING_MENU} />
                  <motion.b animate={{ opacity: mobile ? 0 : 1 }} transition={SPRING_MENU} />
                  <motion.b animate={{ y: mobile ? -7 : 0, rotate: mobile ? -45 : 0 }} transition={SPRING_MENU} />
                </span>
              </motion.button>
            </div>
          </div>
          <motion.nav
            id="sx-mnav"
            className="sx-mnav"
            aria-label="Mobile"
            initial={false}
            animate={mobile ? { opacity: 1, scaleY: 1, y: 0 } : { opacity: 0, scaleY: 1.72, y: 160 }}
            transition={SPRING_MENU}
            style={{ transformOrigin: 'top', visibility: mobile ? 'visible' : 'hidden' }}
          >
            <NavLink to={NAV_LINKS.product.to} className="sx-m-link sx-m-row" onClick={() => setMobile(false)}>
              <p>{NAV_LINKS.product.label}</p>
            </NavLink>
            <MobileSection title="Solutions" items={SOLUTIONS} onGo={() => setMobile(false)} />
            <NavLink to={NAV_LINKS.flows.to} className="sx-m-link sx-m-row" onClick={() => setMobile(false)}>
              <p>{NAV_LINKS.flows.label}</p>
            </NavLink>
            <NavLink to={NAV_LINKS.compute.to} className="sx-m-link sx-m-row" onClick={() => setMobile(false)}>
              <p>{NAV_LINKS.compute.label}</p>
            </NavLink>
            <MobileSection title="Company" items={[...COMPANY_A, ...COMPANY_B]} onGo={() => setMobile(false)} />
          </motion.nav>
        </motion.div>
      </header>
      <AnimatePresence>
        {menu === 'sol' ? (
          <motion.div key="sol" id="sx-dd-sol" className="sx-dd sx-dd-sol" style={{ left: solX - 110 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} onPointerEnter={stay} onPointerLeave={close}>
            <div className="sx-dd-items">
              {SOLUTIONS.map((it) => (
                <SubLink key={it.title} it={it} onGo={() => setMenu(null)} />
              ))}
            </div>
          </motion.div>
        ) : null}
        {menu === 'co' ? (
          <motion.div key="co" id="sx-dd-co" className="sx-dd sx-dd-co" style={{ left: 'calc(50% - 341px)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} onPointerEnter={stay} onPointerLeave={close}>
            {[COMPANY_A, COMPANY_B].map((col, i) => (
              <div className="sx-dd-col" key={i === 0 ? 'a' : 'b'}>
                <p className="sx-dd-label">company</p>
                <div className="sx-dd-items">
                  {col.map((it) => (
                    <SubLink key={it.title} it={it} onGo={() => setMenu(null)} />
                  ))}
                </div>
              </div>
            ))}
            <div className="sx-dd-promo">
              <div className="sx-dd-card">
                <img src="/assets/slots/dTLES0F4nNDafzvBD2nSnrYpg.svg" alt="" />
                <p>What&apos;s New</p>
              </div>
              <NavLink to="/changelog" className="sx-dd-more" onClick={() => setMenu(null)}>
                <p>Learn More</p>
                <i className="sx-arrow" style={{ '--sx-arrow': ARROW } as CSSProperties} />
              </NavLink>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
